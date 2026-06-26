import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Decision } from './domain/types.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export function createLogger(level: LogLevel, sink: Console = console): Logger {
  const enabled = (l: LogLevel) => ORDER[l] >= ORDER[level];
  const stamp = () => new Date().toISOString();
  return {
    debug: (m, ...a) => enabled('debug') && sink.debug(`${stamp()} DEBUG ${m}`, ...a),
    info: (m, ...a) => enabled('info') && sink.info(`${stamp()} INFO  ${m}`, ...a),
    warn: (m, ...a) => enabled('warn') && sink.warn(`${stamp()} WARN  ${m}`, ...a),
    error: (m, ...a) => enabled('error') && sink.error(`${stamp()} ERROR ${m}`, ...a),
  };
}

export interface AuditWriter {
  write(decision: Decision): void;
}

/**
 * Appends one JSON object per line. Each run's decisions are auditable: what was
 * categorized, what was left blank/skipped, the model's confidence and reasoning.
 */
export function createAuditWriter(path: string): AuditWriter {
  let dirReady = false;
  return {
    write(decision: Decision) {
      if (!dirReady) {
        mkdirSync(dirname(path), { recursive: true });
        dirReady = true;
      }
      const record = { ts: new Date().toISOString(), ...decision };
      appendFileSync(path, JSON.stringify(record) + '\n', 'utf8');
    },
  };
}
