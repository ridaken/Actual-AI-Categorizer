import type { ActualTransaction } from './types.js';

export interface FilterOptions {
  skipTransfers: boolean;
  skipSplits: boolean;
}

/**
 * Returns the reason a transaction should be skipped, or null if it is a valid
 * candidate for AI categorization.
 *
 * A candidate must:
 *  - have no category set (we never overwrite an existing category),
 *  - not be a transfer (when skipTransfers),
 *  - not be a split parent (when skipSplits) — the parent itself holds no single
 *    category; its children do.
 */
export function skipReason(
  txn: ActualTransaction,
  opts: FilterOptions,
): string | null {
  if (txn.category) return 'already-categorized';
  if (opts.skipTransfers && txn.transfer_id) return 'transfer';
  if (opts.skipSplits && txn.is_parent) return 'split-parent';
  return null;
}

/** Filter a list of transactions down to the categorization candidates. */
export function selectCandidates(
  txns: ActualTransaction[],
  opts: FilterOptions,
): ActualTransaction[] {
  return txns.filter((t) => skipReason(t, opts) === null);
}
