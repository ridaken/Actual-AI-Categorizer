import { describe, it, expect } from 'vitest';
import { skipReason, selectCandidates } from '../src/domain/filter.js';
import { txn } from './helpers.js';

const opts = { skipTransfers: true, skipSplits: true };

describe('skipReason', () => {
  it('skips already-categorized transactions', () => {
    expect(skipReason(txn({ category: 'c-x' }), opts)).toBe('already-categorized');
  });

  it('skips transfers when enabled', () => {
    expect(skipReason(txn({ transfer_id: 't-2' }), opts)).toBe('transfer');
  });

  it('skips split parents when enabled', () => {
    expect(skipReason(txn({ is_parent: true }), opts)).toBe('split-parent');
  });

  it('keeps a plain uncategorized transaction', () => {
    expect(skipReason(txn(), opts)).toBeNull();
  });

  it('does not skip transfers when disabled', () => {
    expect(
      skipReason(txn({ transfer_id: 't-2' }), { skipTransfers: false, skipSplits: true }),
    ).toBeNull();
  });
});

describe('selectCandidates', () => {
  it('returns only valid candidates', () => {
    const list = [
      txn({ id: 'a' }),
      txn({ id: 'b', category: 'c' }),
      txn({ id: 'c', transfer_id: 't' }),
      txn({ id: 'd', is_parent: true }),
    ];
    expect(selectCandidates(list, opts).map((t) => t.id)).toEqual(['a']);
  });
});
