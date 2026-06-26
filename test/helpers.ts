import type { ActualApi } from '../src/actual/client.js';
import type {
  Account,
  ActualTransaction,
  CategorizationResult,
  CategoryGroup,
  Payee,
} from '../src/domain/types.js';
import type { ChatRequest, CategorizerClient } from '../src/ai/provider.js';
import type { AuditWriter, Logger } from '../src/logger.js';
import type { Decision } from '../src/domain/types.js';

export function silentLogger(): Logger {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

export function collectingAudit(): AuditWriter & { records: Decision[] } {
  const records: Decision[] = [];
  return { records, write: (d) => records.push(d) };
}

export function txn(over: Partial<ActualTransaction> = {}): ActualTransaction {
  return {
    id: 'tx-1',
    account: 'acct-1',
    date: '2026-06-01',
    amount: -1234,
    payee_name: 'Test Merchant',
    category: null,
    ...over,
  };
}

export interface FakeApiState {
  groups: CategoryGroup[];
  payees: Payee[];
  accounts: Account[];
  transactionsByAccount: Record<string, ActualTransaction[]>;
}

export interface FakeActualApi extends ActualApi {
  updates: Array<{ id: string; fields: Partial<ActualTransaction> }>;
  bankSyncCalls: Array<{ accountId?: string }>;
  syncCalls: number;
}

export function fakeApi(state: Partial<FakeApiState> = {}): FakeActualApi {
  const groups: CategoryGroup[] = state.groups ?? [
    {
      id: 'g-exp',
      name: 'Expenses',
      categories: [
        { id: 'c-groceries', name: 'Groceries' },
        { id: 'c-dining', name: 'Dining Out' },
      ],
    },
  ];
  const payees: Payee[] = state.payees ?? [];
  const accounts: Account[] = state.accounts ?? [{ id: 'acct-1', name: 'Checking' }];
  const txByAcct = state.transactionsByAccount ?? {};

  const updates: FakeActualApi['updates'] = [];
  const bankSyncCalls: FakeActualApi['bankSyncCalls'] = [];

  const api: FakeActualApi = {
    updates,
    bankSyncCalls,
    syncCalls: 0,
    async getCategoryGroups() {
      return groups;
    },
    async getCategories() {
      return groups.flatMap((g) => g.categories);
    },
    async getPayees() {
      return payees;
    },
    async getAccounts() {
      return accounts;
    },
    async getTransactions(accountId) {
      return txByAcct[accountId] ?? [];
    },
    async updateTransaction(id, fields) {
      updates.push({ id, fields });
    },
    async runBankSync(opts) {
      bankSyncCalls.push(opts ?? {});
    },
    async sync() {
      api.syncCalls++;
    },
  };
  return api;
}

/** A CategorizerClient that returns a fixed result, or one keyed by payee. */
export function fakeCategorizer(
  fn: (req: ChatRequest) => CategorizationResult,
): CategorizerClient & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    calls,
    async categorize(req) {
      calls.push(req);
      return fn(req);
    },
  };
}
