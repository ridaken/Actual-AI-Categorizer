import { mkdirSync } from 'node:fs';
import type {
  Account,
  ActualTransaction,
  Category,
  CategoryGroup,
  Payee,
} from '../domain/types.js';

/**
 * The subset of `@actual-app/api` this project uses. The rest of the codebase
 * depends only on this interface, so adapting to future Actual API changes (or
 * mocking in tests) means touching this one file.
 */
export interface ActualApi {
  getCategoryGroups(): Promise<CategoryGroup[]>;
  getCategories(): Promise<Category[]>;
  getPayees(): Promise<Payee[]>;
  getAccounts(): Promise<Account[]>;
  getTransactions(
    accountId: string,
    startDate: string,
    endDate: string,
  ): Promise<ActualTransaction[]>;
  updateTransaction(id: string, fields: Partial<ActualTransaction>): Promise<void>;
  runBankSync(opts?: { accountId?: string }): Promise<void>;
  sync(): Promise<void>;
}

export interface ActualConnectionConfig {
  serverUrl: string;
  password: string;
  syncId: string;
  encryptionPassword?: string;
  dataDir: string;
}

export interface ActualSession extends ActualApi {
  shutdown(): Promise<void>;
}

/**
 * Connect to the Actual sync server, download the budget into the local cache,
 * and return a session exposing the methods we need plus `shutdown()`.
 *
 * Imports `@actual-app/api` lazily so unit tests (which inject a fake ActualApi)
 * never need the heavy native dependency installed.
 */
export async function connectActual(
  cfg: ActualConnectionConfig,
): Promise<ActualSession> {
  mkdirSync(cfg.dataDir, { recursive: true });
  // The published types model init() as returning a handle object; we only use
  // the documented method surface, so narrow to our own interface via unknown.
  const api = (await import('@actual-app/api')).default as unknown as ActualRawApi;

  await api.init({
    dataDir: cfg.dataDir,
    serverURL: cfg.serverUrl,
    password: cfg.password,
  });
  await api.downloadBudget(
    cfg.syncId,
    cfg.encryptionPassword ? { password: cfg.encryptionPassword } : undefined,
  );

  return {
    getCategoryGroups: () => api.getCategoryGroups(),
    getCategories: () => api.getCategories(),
    getPayees: () => api.getPayees(),
    getAccounts: () => api.getAccounts(),
    getTransactions: (accountId, start, end) =>
      api.getTransactions(accountId, start, end),
    updateTransaction: async (id, fields) => {
      await api.updateTransaction(id, fields);
    },
    runBankSync: (opts) => api.runBankSync(opts ?? {}),
    sync: () => api.sync(),
    shutdown: () => api.shutdown(),
  };
}

/** Shape of the raw `@actual-app/api` default export we rely on. */
interface ActualRawApi {
  init(config: {
    dataDir: string;
    serverURL: string;
    password: string;
  }): Promise<void>;
  downloadBudget(syncId: string, opts?: { password?: string }): Promise<void>;
  getCategoryGroups(): Promise<CategoryGroup[]>;
  getCategories(): Promise<Category[]>;
  getPayees(): Promise<Payee[]>;
  getAccounts(): Promise<Account[]>;
  getTransactions(
    accountId: string,
    startDate: string,
    endDate: string,
  ): Promise<ActualTransaction[]>;
  updateTransaction(id: string, fields: Partial<ActualTransaction>): Promise<unknown>;
  runBankSync(opts: { accountId?: string }): Promise<void>;
  sync(): Promise<void>;
  shutdown(): Promise<void>;
}
