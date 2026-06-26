import type { ActualTransaction } from '../domain/types.js';
import type { ActualApi } from './client.js';
import { selectCandidates, type FilterOptions } from '../domain/filter.js';

/** YYYY-MM-DD for `date`, defaulting to today. */
export function isoDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** First day of the month `months` before `from` (inclusive lower bound). */
export function lookbackStart(months: number, from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - months, 1));
  return isoDate(d);
}

export interface FetchOptions extends FilterOptions {
  monthsLookback: number;
  /** Max candidates to return across all accounts (0 = unlimited). */
  maxTransactions: number;
}

/**
 * Gather uncategorized candidate transactions across the given accounts within
 * the lookback window, skipping transfers / split parents per options, capped
 * at `maxTransactions`.
 */
export async function fetchCandidates(
  api: ActualApi,
  accountIds: string[],
  opts: FetchOptions,
  now = new Date(),
): Promise<ActualTransaction[]> {
  const start = lookbackStart(opts.monthsLookback, now);
  const end = isoDate(now);

  const candidates: ActualTransaction[] = [];
  for (const accountId of accountIds) {
    const txns = await api.getTransactions(accountId, start, end);
    candidates.push(...selectCandidates(txns, opts));
    if (opts.maxTransactions > 0 && candidates.length >= opts.maxTransactions) {
      return candidates.slice(0, opts.maxTransactions);
    }
  }
  return candidates;
}

/** Apply a category (and optional notes) to a transaction. */
export async function applyCategory(
  api: ActualApi,
  transactionId: string,
  categoryId: string,
  notes?: string,
): Promise<void> {
  const fields: Record<string, unknown> = { category: categoryId };
  if (notes !== undefined) fields.notes = notes;
  await api.updateTransaction(transactionId, fields);
}
