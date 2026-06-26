import { describe, it, expect } from 'vitest';
import { runBankSyncIfEnabled } from '../src/actual/bankSync.js';
import { fakeApi, silentLogger } from './helpers.js';

describe('runBankSyncIfEnabled', () => {
  it('does nothing when disabled', async () => {
    const api = fakeApi();
    await runBankSyncIfEnabled(api, { enabled: false, accountIds: [] }, silentLogger());
    expect(api.bankSyncCalls).toHaveLength(0);
    expect(api.syncCalls).toBe(0);
  });

  it('syncs all linked accounts when no account ids given', async () => {
    const api = fakeApi();
    await runBankSyncIfEnabled(api, { enabled: true, accountIds: [] }, silentLogger());
    expect(api.bankSyncCalls).toEqual([{}]);
    expect(api.syncCalls).toBe(1);
  });

  it('syncs each configured account then syncs to the server', async () => {
    const api = fakeApi();
    await runBankSyncIfEnabled(
      api,
      { enabled: true, accountIds: ['a', 'b'] },
      silentLogger(),
    );
    expect(api.bankSyncCalls).toEqual([{ accountId: 'a' }, { accountId: 'b' }]);
    expect(api.syncCalls).toBe(1);
  });
});
