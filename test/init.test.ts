import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scaffoldConfig } from '../src/init.js';

let root: string;
let templateDir: string;
let targetDir: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'aac-init-'));
  templateDir = path.join(root, 'pkg');
  targetDir = path.join(root, 'install');
  mkdirSync(templateDir, { recursive: true });
  writeFileSync(path.join(templateDir, 'config.example.yaml'), 'example: config\n');
  writeFileSync(path.join(templateDir, 'categories.example.md'), '# categories\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scaffoldConfig', () => {
  it('creates config.yaml and categories.md from the templates', () => {
    const res = scaffoldConfig({ templateDir, targetDir, force: false });
    expect(res.created).toEqual([
      path.join(targetDir, 'config.yaml'),
      path.join(targetDir, 'categories.md'),
    ]);
    expect(res.skipped).toEqual([]);
    expect(readFileSync(path.join(targetDir, 'config.yaml'), 'utf8')).toBe('example: config\n');
    expect(readFileSync(path.join(targetDir, 'categories.md'), 'utf8')).toBe('# categories\n');
  });

  it('does not overwrite existing files by default', () => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(targetDir, 'config.yaml'), 'MINE\n');
    const res = scaffoldConfig({ templateDir, targetDir, force: false });
    expect(res.created).toEqual([path.join(targetDir, 'categories.md')]);
    expect(res.skipped).toEqual([path.join(targetDir, 'config.yaml')]);
    // preserved, not clobbered
    expect(readFileSync(path.join(targetDir, 'config.yaml'), 'utf8')).toBe('MINE\n');
  });

  it('overwrites when force is set', () => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(targetDir, 'config.yaml'), 'MINE\n');
    const res = scaffoldConfig({ templateDir, targetDir, force: true });
    expect(res.created).toContain(path.join(targetDir, 'config.yaml'));
    expect(readFileSync(path.join(targetDir, 'config.yaml'), 'utf8')).toBe('example: config\n');
  });

  it('creates the target directory if missing', () => {
    const nested = path.join(targetDir, 'deep', 'nested');
    const res = scaffoldConfig({ templateDir, targetDir: nested, force: false });
    expect(res.created).toHaveLength(2);
  });
});
