import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli.js';

const argv = (...args: string[]) => ['node', 'index.js', ...args];

describe('parseArgs', () => {
  it('defaults to the run command with ./config.yaml', () => {
    expect(parseArgs(argv())).toMatchObject({
      command: 'run',
      configPath: './config.yaml',
      dryRun: false,
    });
  });

  it('parses loop with an explicit config path', () => {
    expect(parseArgs(argv('loop', '--config', 'prod.yaml'))).toMatchObject({
      command: 'loop',
      configPath: 'prod.yaml',
    });
  });

  it('parses the dry-run flag', () => {
    expect(parseArgs(argv('run', '--dry-run'))).toMatchObject({
      command: 'run',
      dryRun: true,
    });
  });

  it('parses init with --dir and --force', () => {
    expect(parseArgs(argv('init', '--dir', '/etc/app', '--force'))).toMatchObject({
      command: 'init',
      initDir: '/etc/app',
      force: true,
    });
  });

  it('defaults init dir to "." ', () => {
    expect(parseArgs(argv('init'))).toMatchObject({ command: 'init', initDir: '.' });
  });

  it('returns the help sentinel for --help', () => {
    expect(parseArgs(argv('--help'))).toBe('help');
  });

  it('throws on an unknown argument', () => {
    expect(() => parseArgs(argv('frobnicate'))).toThrowError(/unknown argument/);
  });

  it('throws when a flag is missing its value', () => {
    expect(() => parseArgs(argv('run', '--config'))).toThrowError(/requires a value/);
  });
});
