import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from './logger.js';

/** (template filename in the package) -> (filename created in the target dir). */
const SCAFFOLD: ReadonlyArray<readonly [string, string]> = [
  ['config.example.yaml', 'config.yaml'],
  ['categories.example.md', 'categories.md'],
];

export interface ScaffoldOptions {
  /** Directory containing the *.example.* templates (the package root). */
  templateDir: string;
  /** Directory to scaffold into. */
  targetDir: string;
  /** Overwrite files that already exist. */
  force: boolean;
}

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
}

/**
 * Copy the config + category-sheet templates into `targetDir`. Idempotent:
 * existing files are left untouched unless `force` is set. Returns the absolute
 * paths that were created vs skipped.
 */
export function scaffoldConfig(opts: ScaffoldOptions): ScaffoldResult {
  mkdirSync(opts.targetDir, { recursive: true });
  const created: string[] = [];
  const skipped: string[] = [];

  for (const [template, dest] of SCAFFOLD) {
    const target = path.join(opts.targetDir, dest);
    if (existsSync(target) && !opts.force) {
      skipped.push(target);
      continue;
    }
    copyFileSync(path.join(opts.templateDir, template), target);
    created.push(target);
  }

  return { created, skipped };
}

/** Scaffold config and print next-step guidance. */
export function runInit(opts: ScaffoldOptions, logger: Logger): ScaffoldResult {
  const result = scaffoldConfig(opts);
  for (const f of result.created) logger.info(`created ${f}`);
  for (const f of result.skipped) logger.info(`exists, left unchanged: ${f}`);

  const configPath = path.join(opts.targetDir, 'config.yaml');
  logger.info(
    [
      '',
      'Next steps:',
      `  1. Edit ${configPath}:`,
      '       actual.server_url, actual.sync_id, ai.base_url, ai.model',
      '  2. Set the secret env vars referenced as ${VAR} in the config:',
      '       ACTUAL_PASSWORD (and optionally ACTUAL_E2E_PASSWORD, AI_API_KEY)',
      `  3. Try it safely:  actual-ai-categorizer run --config ${configPath} --dry-run`,
      '',
    ].join('\n'),
  );
  return result;
}
