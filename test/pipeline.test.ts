import { describe, it, expect } from 'vitest';
import { runOnce } from '../src/pipeline.js';
import { parseConfig, type Config } from '../src/config.js';
import {
  collectingAudit,
  fakeApi,
  fakeCategorizer,
  silentLogger,
  txn,
} from './helpers.js';

function config(over: Partial<Record<string, unknown>> = {}): Config {
  const cfg = parseConfig(
    {
      actual: {
        server_url: 'https://a.example.com',
        password: 'pw',
        sync_id: 's',
      },
      ai: { base_url: 'http://localhost:8080/v1', model: 'm' },
    },
    {} as NodeJS.ProcessEnv,
  );
  return { ...cfg, ...(over as Partial<Config>) };
}

const now = () => new Date('2026-06-26T00:00:00Z');

const confident = () =>
  fakeCategorizer(() => ({ reasoning: 'r', category: 'Groceries', confidence: 0.9 }));

describe('runOnce', () => {
  it('categorizes a confident candidate and syncs', async () => {
    const api = fakeApi({ transactionsByAccount: { 'acct-1': [txn({ id: 't1' })] } });
    const audit = collectingAudit();
    const summary = await runOnce({
      api,
      provider: confident(),
      config: config(),
      referenceSheet: '',
      logger: silentLogger(),
      audit,
      now,
    });

    expect(summary).toMatchObject({ candidates: 1, categorized: 1, errors: 0 });
    expect(api.updates).toEqual([
      { id: 't1', fields: { category: 'c-groceries' } },
    ]);
    expect(api.syncCalls).toBe(1);
    expect(audit.records[0].action).toBe('categorized');
  });

  it('never writes in dry-run mode but still audits', async () => {
    const api = fakeApi({ transactionsByAccount: { 'acct-1': [txn({ id: 't1' })] } });
    const audit = collectingAudit();
    const summary = await runOnce({
      api,
      provider: confident(),
      config: config({ dry_run: true }),
      referenceSheet: '',
      logger: silentLogger(),
      audit,
      now,
    });

    expect(summary.categorized).toBe(1);
    expect(api.updates).toHaveLength(0);
    expect(api.syncCalls).toBe(0);
    expect(audit.records).toHaveLength(1);
  });

  it('does not send already-categorized transactions to the AI', async () => {
    const api = fakeApi({
      transactionsByAccount: {
        'acct-1': [txn({ id: 't1', category: 'c-dining' }), txn({ id: 't2' })],
      },
    });
    const provider = confident();
    const summary = await runOnce({
      api,
      provider,
      config: config(),
      referenceSheet: '',
      logger: silentLogger(),
      audit: collectingAudit(),
      now,
    });

    expect(summary.candidates).toBe(1);
    expect(provider.calls).toHaveLength(1);
    expect(api.updates.map((u) => u.id)).toEqual(['t2']);
  });

  it('runs bank sync first only when enabled', async () => {
    const api = fakeApi();
    const enabled = config({
      bank_sync: { enabled: true, account_ids: [] },
    } as Partial<Config>);
    await runOnce({
      api,
      provider: confident(),
      config: enabled,
      referenceSheet: '',
      logger: silentLogger(),
      audit: collectingAudit(),
      now,
    });
    expect(api.bankSyncCalls).toHaveLength(1);
  });

  it('writes reasoning to notes when configured', async () => {
    const api = fakeApi({ transactionsByAccount: { 'acct-1': [txn({ id: 't1' })] } });
    const cfg = config({
      categorization: {
        ...config().categorization,
        write_reasoning_to_notes: true,
      },
    } as Partial<Config>);
    await runOnce({
      api,
      provider: confident(),
      config: cfg,
      referenceSheet: '',
      logger: silentLogger(),
      audit: collectingAudit(),
      now,
    });
    expect(api.updates[0].fields.notes).toMatch(/\[AI 0\.90\]/);
  });
});
