import type { Logger } from './logger.js';

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));

export interface LoopController {
  stopped: boolean;
}

/**
 * Run `task` immediately, then every `pollMinutes`, until `controller.stopped`.
 * Each cycle is wrapped so a failure logs and waits for the next tick rather
 * than killing the daemon.
 */
export async function runLoop(
  task: () => Promise<void>,
  pollMinutes: number,
  logger: Logger,
  controller: LoopController = { stopped: false },
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<void> {
  const intervalMs = pollMinutes * 60_000;
  while (!controller.stopped) {
    const startedAt = Date.now();
    try {
      await task();
    } catch (err) {
      logger.error(`scheduled run failed: ${String(err)}`);
    }
    if (controller.stopped) break;
    const elapsed = Date.now() - startedAt;
    const wait = Math.max(0, intervalMs - elapsed);
    logger.info(`next run in ${Math.round(wait / 60_000)} min`);
    await sleepFn(wait);
  }
}
