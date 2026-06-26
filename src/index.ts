#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { loadConfig, type Config } from './config.js';
import { createLogger, createAuditWriter } from './logger.js';
import { connectActual } from './actual/client.js';
import { AiProvider } from './ai/provider.js';
import { runOnce } from './pipeline.js';
import { runLoop, type LoopController } from './scheduler.js';

interface Cli {
  command: 'run' | 'loop';
  configPath: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Cli {
  const args = argv.slice(2);
  let command: 'run' | 'loop' | undefined;
  let configPath = './config.yaml';
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === 'run' || a === 'loop') command = a;
    else if (a === '--config' || a === '-c') configPath = args[++i];
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else throw new Error(`unknown argument: ${a}`);
  }
  return { command: command ?? 'run', configPath, dryRun };
}

function printHelp(): void {
  process.stdout.write(
    [
      'actual-ai-categorizer — AI auto-categorization for Actual Budget',
      '',
      'Usage:',
      '  actual-ai-categorizer run  [--config <path>] [--dry-run]   Run one cycle and exit',
      '  actual-ai-categorizer loop [--config <path>] [--dry-run]   Run on the configured interval',
      '',
      'Defaults: --config ./config.yaml',
      '',
      'Secrets (passwords, API keys) are read from environment variables referenced',
      'as ${VAR} in the config file.',
      '',
    ].join('\n'),
  );
}

function readReferenceSheet(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv);
  const config: Config = loadConfig(cli.configPath);
  if (cli.dryRun) config.dry_run = true;

  const logger = createLogger(config.logging.level);
  const audit = createAuditWriter(config.logging.audit_file);

  const referenceSheet = readReferenceSheet(config.category_reference_path);
  if (!referenceSheet) {
    logger.warn(
      `no category reference sheet at ${config.category_reference_path}; ` +
        'proceeding with category names only',
    );
  }

  const provider = new AiProvider({
    baseUrl: config.ai.base_url,
    apiKey: config.ai.api_key,
    model: config.ai.model,
    temperature: config.ai.temperature,
    requestTimeoutMs: config.ai.request_timeout_s * 1000,
    maxRetries: config.ai.max_retries,
    constrainedOutput: config.ai.constrained_output,
  });

  logger.info(`connecting to Actual at ${config.actual.server_url}`);
  const session = await connectActual({
    serverUrl: config.actual.server_url,
    password: config.actual.password,
    syncId: config.actual.sync_id,
    encryptionPassword: config.actual.encryption_password || undefined,
    dataDir: config.actual.data_dir,
  });

  const deps = { api: session, provider, config, referenceSheet, logger, audit };

  try {
    if (cli.command === 'loop') {
      const controller: LoopController = { stopped: false };
      const stop = () => {
        logger.info('shutdown requested; finishing current cycle...');
        controller.stopped = true;
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      await runLoop(
        () => runOnce(deps).then(() => undefined),
        config.scheduler.polling_minutes,
        logger,
        controller,
      );
    } else {
      await runOnce(deps);
    }
  } finally {
    await session.shutdown();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`fatal: ${err?.stack ?? err}`);
  process.exit(1);
});
