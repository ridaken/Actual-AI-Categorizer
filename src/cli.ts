export type Command = 'run' | 'loop' | 'init';

export interface Cli {
  command: Command;
  configPath: string;
  dryRun: boolean;
  /** Target directory for `init` (defaults to the current directory). */
  initDir: string;
  /** Overwrite existing files during `init`. */
  force: boolean;
}

export const HELP = [
  'actual-ai-categorizer — AI auto-categorization for Actual Budget',
  '',
  'Usage:',
  '  actual-ai-categorizer init [--dir <path>] [--force]        Scaffold config.yaml + categories.md',
  '  actual-ai-categorizer run  [--config <path>] [--dry-run]   Run one cycle and exit',
  '  actual-ai-categorizer loop [--config <path>] [--dry-run]   Run on the configured interval',
  '',
  'Defaults: --config ./config.yaml, init --dir .',
  '',
  'Secrets (passwords, API keys) are read from environment variables referenced',
  'as ${VAR} in the config file.',
  '',
].join('\n');

/**
 * Parse process argv into a Cli. Throws on unknown arguments so mistakes are
 * surfaced rather than silently ignored. Returns a sentinel for `--help`.
 */
export function parseArgs(argv: string[]): Cli | 'help' {
  const args = argv.slice(2);
  let command: Command | undefined;
  let configPath = './config.yaml';
  let dryRun = false;
  let initDir = '.';
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === 'run' || a === 'loop' || a === 'init') command = a;
    else if (a === '--config' || a === '-c') configPath = required(args, ++i, a);
    else if (a === '--dir' || a === '-d') initDir = required(args, ++i, a);
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--force' || a === '-f') force = true;
    else if (a === '--help' || a === '-h') return 'help';
    else throw new Error(`unknown argument: ${a}`);
  }

  return { command: command ?? 'run', configPath, dryRun, initDir, force };
}

function required(args: string[], i: number, flag: string): string {
  const v = args[i];
  if (v === undefined) throw new Error(`${flag} requires a value`);
  return v;
}
