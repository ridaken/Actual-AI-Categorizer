import { describe, it, expect } from 'vitest';
import { interpolateEnv, parseConfig } from '../src/config.js';

const minimal = {
  actual: {
    server_url: 'https://actual.example.com',
    password: '${ACTUAL_PASSWORD}',
    sync_id: 'sync-123',
  },
  ai: {
    base_url: 'http://localhost:8080/v1',
    model: 'local-model',
  },
};

describe('interpolateEnv', () => {
  it('replaces ${VAR} with env value in nested strings', () => {
    const out = interpolateEnv(
      { a: '${FOO}', b: ['x', '${BAR}'], c: 1 },
      { FOO: 'foo', BAR: 'bar' } as NodeJS.ProcessEnv,
    );
    expect(out).toEqual({ a: 'foo', b: ['x', 'bar'], c: 1 });
  });

  it('resolves unset variables to empty string', () => {
    expect(interpolateEnv('${MISSING}', {} as NodeJS.ProcessEnv)).toBe('');
  });
});

describe('parseConfig', () => {
  it('applies defaults and interpolates secrets', () => {
    const cfg = parseConfig(minimal, { ACTUAL_PASSWORD: 's3cret' } as NodeJS.ProcessEnv);
    expect(cfg.actual.password).toBe('s3cret');
    expect(cfg.categorization.confidence_threshold).toBe(0.6);
    expect(cfg.scheduler.mode).toBe('once');
    expect(cfg.dry_run).toBe(false);
  });

  it('rejects an empty required password', () => {
    expect(() =>
      parseConfig(minimal, {} as NodeJS.ProcessEnv),
    ).toThrowError(/password/i);
  });

  it('rejects an invalid server url', () => {
    const bad = { ...minimal, actual: { ...minimal.actual, server_url: 'not-a-url' } };
    expect(() => parseConfig(bad, { ACTUAL_PASSWORD: 'x' } as NodeJS.ProcessEnv)).toThrow();
  });
});
