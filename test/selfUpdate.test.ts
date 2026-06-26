import { describe, it, expect } from 'vitest';
import {
  performSelfUpdate,
  UPDATE_SENTINEL,
  type SelfUpdateConfig,
  type SelfUpdateDeps,
} from '../src/selfUpdate.js';
import { silentLogger } from './helpers.js';

const REEXEC = new Error('__REEXEC__');

/** Fake command runner: returns the first map value whose `cmd args` prefix matches. */
function fakeRun(map: Array<[string, string | Error]>) {
  const calls: string[] = [];
  const run = (cmd: string, args: string[]): string => {
    const key = `${cmd} ${args.join(' ')}`;
    calls.push(key);
    for (const [prefix, val] of map) {
      if (key.startsWith(prefix)) {
        if (val instanceof Error) throw val;
        return val;
      }
    }
    return '';
  };
  return { run, calls };
}

function deps(
  run: (cmd: string, args: string[]) => string,
  env: NodeJS.ProcessEnv = {},
): SelfUpdateDeps & { reexecCount: () => number } {
  let reexecCalls = 0;
  return {
    run,
    env,
    logger: silentLogger(),
    reexec: (() => {
      reexecCalls++;
      throw REEXEC;
    }) as () => never,
    reexecCount: () => reexecCalls,
  };
}

const cfg = (over: Partial<SelfUpdateConfig> = {}): SelfUpdateConfig => ({
  enabled: true,
  ref: 'latest-release',
  installDeps: true,
  build: true,
  restart: true,
  repoDir: '/repo',
  ...over,
});

const REPO = '/repo';

/** Common map for "an update from v0.1.0 (old) to v0.1.1 (new) is available". */
function updateAvailableMap(opts: { clean?: boolean; lockChanged?: boolean } = {}) {
  return [
    ['git rev-parse --is-inside-work-tree', 'true'],
    ['git fetch', ''],
    ['git rev-parse HEAD', 'oldsha'],
    ['git tag -l', 'v0.1.1\nv0.1.0'],
    ['git rev-parse v0.1.1^{commit}', 'newsha'],
    ['git status --porcelain', opts.clean === false ? ' M src/x.ts' : ''],
    [
      'git diff --name-only oldsha newsha -- package-lock.json',
      opts.lockChanged ? 'package-lock.json' : '',
    ],
  ] as Array<[string, string | Error]>;
}

describe('performSelfUpdate', () => {
  it('does nothing when disabled', () => {
    const { run, calls } = fakeRun([]);
    performSelfUpdate(cfg({ enabled: false }), deps(run));
    expect(calls).toHaveLength(0);
  });

  it('skips one check after a restart and clears the sentinel', () => {
    const { run, calls } = fakeRun([]);
    const env = { [UPDATE_SENTINEL]: '1' } as NodeJS.ProcessEnv;
    performSelfUpdate(cfg(), deps(run, env));
    expect(calls).toHaveLength(0);
    expect(env[UPDATE_SENTINEL]).toBeUndefined();
  });

  it('does not update or restart when already at the latest release', () => {
    const { run, calls } = fakeRun([
      ['git rev-parse --is-inside-work-tree', 'true'],
      ['git fetch', ''],
      ['git rev-parse HEAD', 'samesha'],
      ['git tag -l', 'v0.1.1'],
      ['git rev-parse v0.1.1^{commit}', 'samesha'],
    ]);
    const d = deps(run);
    performSelfUpdate(cfg(), d);
    expect(calls.some((c) => c.startsWith('git checkout'))).toBe(false);
    expect(d.reexecCount()).toBe(0);
  });

  it('checks out, builds, and re-execs when a newer release exists', () => {
    const { run, calls } = fakeRun(updateAvailableMap());
    const d = deps(run);
    expect(() => performSelfUpdate(cfg(), d)).toThrow('__REEXEC__');
    expect(calls).toContain('git -c advice.detachedHead=false checkout --quiet v0.1.1');
    expect(calls).toContain('npm run build');
    expect(calls.some((c) => c.startsWith('npm ci'))).toBe(false); // lockfile unchanged
    expect(d.reexecCount()).toBe(1);
  });

  it('runs npm ci when the lockfile changed', () => {
    const { run, calls } = fakeRun(updateAvailableMap({ lockChanged: true }));
    expect(() => performSelfUpdate(cfg(), deps(run))).toThrow('__REEXEC__');
    expect(calls).toContain('npm ci');
  });

  it('does not re-exec when restart is disabled', () => {
    const { run } = fakeRun(updateAvailableMap());
    const d = deps(run);
    performSelfUpdate(cfg({ restart: false }), d);
    expect(d.reexecCount()).toBe(0);
  });

  it('skips when the working tree is dirty', () => {
    const { run, calls } = fakeRun(updateAvailableMap({ clean: false }));
    const d = deps(run);
    performSelfUpdate(cfg(), d);
    expect(calls.some((c) => c.startsWith('git checkout'))).toBe(false);
    expect(d.reexecCount()).toBe(0);
  });

  it('skips when there are no release tags', () => {
    const { run, calls } = fakeRun([
      ['git rev-parse --is-inside-work-tree', 'true'],
      ['git fetch', ''],
      ['git rev-parse HEAD', 'oldsha'],
      ['git tag -l', ''],
    ]);
    performSelfUpdate(cfg(), deps(run));
    expect(calls.some((c) => c.startsWith('git checkout'))).toBe(false);
  });

  it('continues (no throw) when git is unavailable', () => {
    const { run } = fakeRun([
      ['git rev-parse --is-inside-work-tree', 'true'],
      ['git fetch', new Error('network down')],
    ]);
    const d = deps(run);
    expect(() => performSelfUpdate(cfg(), d)).not.toThrow();
    expect(d.reexecCount()).toBe(0);
  });

  it('rolls back and does not restart when the build fails', () => {
    const map = updateAvailableMap();
    map.push(['npm run build', new Error('tsc failed')]);
    const { run, calls } = fakeRun(map);
    const d = deps(run);
    performSelfUpdate(cfg(), d);
    // rolled back to the previous HEAD
    expect(calls).toContain('git -c advice.detachedHead=false checkout --quiet oldsha');
    expect(d.reexecCount()).toBe(0);
  });

  it('tracks a branch when ref is not latest-release', () => {
    const { run, calls } = fakeRun([
      ['git rev-parse --is-inside-work-tree', 'true'],
      ['git fetch', ''],
      ['git rev-parse HEAD', 'oldsha'],
      ['git rev-parse origin/main', 'newsha'],
      ['git status --porcelain', ''],
      ['git diff --name-only', ''],
    ]);
    const d = deps(run);
    expect(() => performSelfUpdate(cfg({ ref: 'main' }), d)).toThrow('__REEXEC__');
    expect(calls).toContain('git checkout --quiet main');
    expect(calls).toContain('git merge --ff-only --quiet origin/main');
  });
});
