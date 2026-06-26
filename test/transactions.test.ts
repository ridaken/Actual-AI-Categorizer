import { describe, it, expect } from 'vitest';
import {
  fetchCandidates,
  lookbackStart,
  isoDate,
  applyCategory,
} from '../src/actual/transactions.js';
import { fakeApi, txn } from './helpers.js';

describe('date helpers', () => {
  it('formats today as YYYY-MM-DD', () => {
    expect(isoDate(new Date('2026-06-26T12:00:00Z'))).toBe('2026-06-26');
  });

  it('computes the lookback start as the first of the month N months back', () => {
    expect(lookbackStart(3, new Date('2026-06-26T00:00:00Z'))).toBe('2026-03-01');
  });
});

describe('fetchCandidates', () => {
  const opts = {
    skipTransfers: true,
    skipSplits: true,
    monthsLookback: 3,
    maxTransactions: 0,
  };

  it('aggregates uncategorized candidates across accounts', async () => {
    const api = fakeApi({
      accounts: [
        { id: 'a1', name: 'A1' },
        { id: 'a2', name: 'A2' },
      ],
      transactionsByAccount: {
        a1: [txn({ id: 't1' }), txn({ id: 't2', category: 'c' })],
        a2: [txn({ id: 't3', account: 'a2' })],
      },
    });
    const got = await fetchCandidates(api, ['a1', 'a2'], opts);
    expect(got.map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('respects the maxTransactions cap', async () => {
    const api = fakeApi({
      transactionsByAccount: {
        a1: [txn({ id: 't1' }), txn({ id: 't2' }), txn({ id: 't3' })],
      },
    });
    const got = await fetchCandidates(api, ['a1'], { ...opts, maxTransactions: 2 });
    expect(got).toHaveLength(2);
  });
});

describe('applyCategory', () => {
  it('updates category and optional notes', async () => {
    const api = fakeApi();
    await applyCategory(api, 'tx-9', 'c-groceries', 'a note');
    expect(api.updates).toEqual([
      { id: 'tx-9', fields: { category: 'c-groceries', notes: 'a note' } },
    ]);
  });
});
