import type { ActualApi } from './client.js';
import type { Logger } from '../logger.js';

export interface BankSyncOptions {
  enabled: boolean;
  /** Specific accounts to sync; empty = all linked accounts. */
  accountIds: string[];
}

/**
 * Trigger the third-party bank sync (SimpleFIN / GoCardless) — the programmatic
 * equivalent of the "Bank Sync" button — then sync the result back to the
 * server so the new transactions are available locally. No-op when disabled.
 */
export async function runBankSyncIfEnabled(
  api: ActualApi,
  opts: BankSyncOptions,
  logger: Logger,
): Promise<void> {
  if (!opts.enabled) {
    logger.debug('bank sync disabled; skipping');
    return;
  }

  if (opts.accountIds.length === 0) {
    logger.info('running bank sync for all linked accounts');
    await api.runBankSync();
  } else {
    for (const accountId of opts.accountIds) {
      logger.info(`running bank sync for account ${accountId}`);
      await api.runBankSync({ accountId });
    }
  }
  await api.sync();
  logger.info('bank sync complete');
}
