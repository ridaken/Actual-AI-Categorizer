import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Logger } from './logger.js';

/**
 * Set on the re-exec'd child so it doesn't immediately try to update again
 * (which would loop). Cleared after the first cycle so later loop iterations
 * still check for newer versions.
 */
export const UPDATE_SENTINEL = 'ACTUAL_AI_CATEGORIZER_SELF_UPDATED';

export interface SelfUpdateConfig {
  enabled: boolean;
  /** 'latest-release' (newest v*.*.* tag) or a branch name to track. */
  ref: string;
  installDeps: boolean;
  build: boolean;
  restart: boolean;
  repoDir: string;
}

export interface SelfUpdateDeps {
  /** Run a command in the repo dir; returns stdout, throws on non-zero exit. */
  run: (cmd: string, args: string[]) => string;
  /** Re-exec the current process into the updated code. Never returns. */
  reexec: () => never;
  env: NodeJS.ProcessEnv;
  logger: Logger;
}

interface Target {
  label: string;
  commit: string;
  checkout: () => void;
}

/**
 * Check for and apply an update before a run. Self-contained and fail-safe:
 * any failure is logged and the run continues on the current version. If an
 * update is applied and `restart` is set, the process re-execs into the new
 * code (so this very run uses it) and this function does not return.
 *
 * Must be called BEFORE connecting to Actual, so re-exec never races an open
 * budget session.
 */
export function performSelfUpdate(cfg: SelfUpdateConfig, deps: SelfUpdateDeps): void {
  const { logger, env } = deps;
  if (!cfg.enabled) return;

  // Just restarted into the new version: skip this one check, then re-enable.
  if (env[UPDATE_SENTINEL] === '1') {
    logger.debug('self-update: running freshly updated version; skipping check');
    delete env[UPDATE_SENTINEL];
    return;
  }

  let updated = false;
  try {
    if (!isGitRepo(deps)) {
      logger.warn(`self-update: ${cfg.repoDir} is not a git repository; skipping`);
      return;
    }

    deps.run('git', ['fetch', '--tags', '--prune', '--quiet', 'origin']);
    const oldHead = git(deps, ['rev-parse', 'HEAD']);
    const target = resolveTarget(cfg, deps);
    if (!target) return; // resolveTarget already logged the reason

    if (target.commit === oldHead) {
      logger.info(`self-update: already up to date (${target.label})`);
      return;
    }
    if (!isCleanTree(deps)) {
      logger.warn('self-update: working tree has uncommitted changes; skipping update');
      return;
    }

    logger.info(`self-update: updating to ${target.label}`);
    target.checkout();
    updated = true;

    try {
      if (cfg.installDeps && lockfileChanged(deps, oldHead, target.commit)) {
        logger.info('self-update: dependencies changed; running npm ci');
        deps.run('npm', ['ci']);
      }
      if (cfg.build) {
        logger.info('self-update: building');
        deps.run('npm', ['run', 'build']);
      }
    } catch (postErr) {
      logger.error(
        `self-update: post-update step failed (${String(postErr)}); rolling back to ${oldHead.slice(0, 8)}`,
      );
      rollback(deps, oldHead, cfg);
      return;
    }
  } catch (err) {
    logger.warn(`self-update: check failed (${String(err)}); continuing with current version`);
    return;
  }

  if (updated && cfg.restart) {
    logger.info('self-update: restarting into the updated version');
    deps.reexec(); // never returns
  }
}

function git(deps: SelfUpdateDeps, args: string[]): string {
  return deps.run('git', args).trim();
}

function isGitRepo(deps: SelfUpdateDeps): boolean {
  try {
    return git(deps, ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

function isCleanTree(deps: SelfUpdateDeps): boolean {
  return git(deps, ['status', '--porcelain']) === '';
}

function lockfileChanged(deps: SelfUpdateDeps, from: string, to: string): boolean {
  try {
    return git(deps, ['diff', '--name-only', from, to, '--', 'package-lock.json']) !== '';
  } catch {
    return true; // can't tell => reinstall to be safe
  }
}

function resolveTarget(cfg: SelfUpdateConfig, deps: SelfUpdateDeps): Target | null {
  if (cfg.ref === 'latest-release') {
    const tags = git(deps, ['tag', '-l', 'v*.*.*', '--sort=-v:refname'])
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0) {
      deps.logger.info('self-update: no release tags found; skipping');
      return null;
    }
    const tag = tags[0];
    return {
      label: tag,
      commit: git(deps, ['rev-parse', `${tag}^{commit}`]),
      checkout: () =>
        deps.run('git', ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', tag]),
    };
  }

  const branch = cfg.ref;
  return {
    label: branch,
    commit: git(deps, ['rev-parse', `origin/${branch}`]),
    checkout: () => {
      deps.run('git', ['checkout', '--quiet', branch]);
      deps.run('git', ['merge', '--ff-only', '--quiet', `origin/${branch}`]);
    },
  };
}

function rollback(deps: SelfUpdateDeps, oldHead: string, cfg: SelfUpdateConfig): void {
  // Best-effort restoration of a consistent previous state.
  try {
    deps.run('git', ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', oldHead]);
    if (cfg.build) deps.run('npm', ['run', 'build']);
  } catch {
    /* nothing more we can do; current in-memory code still runs this cycle */
  }
}

/** Default command runner: synchronous, rooted at the repo directory. */
export function defaultRun(repoDir: string): (cmd: string, args: string[]) => string {
  return (cmd, args) => {
    const bin = cmd === 'npm' && process.platform === 'win32' ? 'npm.cmd' : cmd;
    return execFileSync(bin, args, {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  };
}

/** Default re-exec: rerun this process's argv with the sentinel set. */
export function defaultReexec(env: NodeJS.ProcessEnv): never {
  const res = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...env, [UPDATE_SENTINEL]: '1' },
  });
  process.exit(res.status ?? 1);
}

/** Resolve the repo root: explicit override, else the dir above this file. */
export function resolveRepoDir(override?: string): string {
  if (override) return override;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url)); // <repo>/dist
    return path.resolve(here, '..');
  } catch {
    return process.cwd();
  }
}
