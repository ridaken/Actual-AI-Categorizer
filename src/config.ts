import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * Recursively replace `${ENV_VAR}` placeholders inside string values using the
 * provided environment. Keeps secrets (API keys, passwords) out of the config
 * file. An unset variable resolves to an empty string.
 */
export function interpolateEnv(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_m, name: string) => env[name] ?? '');
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolateEnv(v, env));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateEnv(v, env);
    }
    return out;
  }
  return value;
}

const ActualSchema = z.object({
  server_url: z.string().url(),
  password: z.string().min(1, 'actual.password is required (use ${ACTUAL_PASSWORD})'),
  sync_id: z.string().min(1, 'actual.sync_id is required'),
  encryption_password: z.string().optional().default(''),
  data_dir: z.string().default('./.actual-data'),
});

const AiSchema = z.object({
  base_url: z.string().url(),
  api_key: z.string().optional().default(''),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.2),
  request_timeout_s: z.number().positive().default(60),
  max_retries: z.number().int().min(0).default(3),
  constrained_output: z.boolean().default(true),
});

const CategorizationSchema = z.object({
  confidence_threshold: z.number().min(0).max(1).default(0.6),
  skip_transfers: z.boolean().default(true),
  skip_splits: z.boolean().default(true),
  max_transactions: z.number().int().min(0).default(200), // 0 = no cap
  months_lookback: z.number().int().positive().default(3),
  write_reasoning_to_notes: z.boolean().default(false),
});

const BankSyncSchema = z.object({
  enabled: z.boolean().default(false),
  account_ids: z.array(z.string()).default([]),
});

const SchedulerSchema = z.object({
  mode: z.enum(['once', 'loop']).default('once'),
  polling_minutes: z.number().positive().default(30),
});

const LoggingSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  audit_file: z.string().default('./logs/audit.jsonl'),
});

const AutoUpdateSchema = z.object({
  enabled: z.boolean().default(false),
  // 'latest-release' = newest v*.*.* tag; otherwise a branch name to track.
  ref: z.string().default('latest-release'),
  install_deps: z.boolean().default(true),
  build: z.boolean().default(true),
  restart: z.boolean().default(true),
  // Require a valid signature on the target commit before applying (fail-closed).
  verify_signature: z.boolean().default(true),
  // Optional SSH allowed-signers file; when set, verification uses SSH format.
  allowed_signers_file: z.string().optional(),
  // Repo directory; defaults to the install location when omitted.
  repo_dir: z.string().optional(),
});

export const ConfigSchema = z.object({
  actual: ActualSchema,
  ai: AiSchema,
  categorization: CategorizationSchema.default({}),
  bank_sync: BankSyncSchema.default({}),
  scheduler: SchedulerSchema.default({}),
  logging: LoggingSchema.default({}),
  auto_update: AutoUpdateSchema.default({}),
  category_reference_path: z.string().default('./categories.md'),
  dry_run: z.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Parse + validate an already-loaded raw object (after env interpolation). */
export function parseConfig(raw: unknown, env: NodeJS.ProcessEnv = process.env): Config {
  const interpolated = interpolateEnv(raw, env);
  return ConfigSchema.parse(interpolated);
}

/** Load YAML config from disk, interpolate env vars, and validate. */
export function loadConfig(path: string, env: NodeJS.ProcessEnv = process.env): Config {
  const text = readFileSync(path, 'utf8');
  const raw = parseYaml(text);
  return parseConfig(raw, env);
}
