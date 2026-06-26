import { describe, it, expect } from 'vitest';
import { runLoop, type LoopController } from '../src/scheduler.js';
import { silentLogger } from './helpers.js';

describe('runLoop', () => {
  it('runs immediately and stops when controller is set', async () => {
    let runs = 0;
    const controller: LoopController = { stopped: false };
    const task = async () => {
      runs++;
      if (runs >= 3) controller.stopped = true;
    };
    await runLoop(task, 5, silentLogger(), controller, async () => {});
    expect(runs).toBe(3);
  });

  it('keeps looping after a failing run', async () => {
    let runs = 0;
    const controller: LoopController = { stopped: false };
    const task = async () => {
      runs++;
      if (runs === 1) throw new Error('transient');
      if (runs >= 2) controller.stopped = true;
    };
    await runLoop(task, 5, silentLogger(), controller, async () => {});
    expect(runs).toBe(2);
  });

  it('does not run when already stopped before the first sleep completes', async () => {
    let runs = 0;
    const controller: LoopController = { stopped: false };
    const task = async () => {
      runs++;
      controller.stopped = true;
    };
    await runLoop(task, 5, silentLogger(), controller, async () => {});
    expect(runs).toBe(1);
  });
});
