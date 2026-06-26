import { describe, it, expect } from 'vitest';
import { decideCategory } from '../src/ai/categorize.js';
import { UNKNOWN_CATEGORY } from '../src/domain/types.js';
import { fakeCategorizer, txn } from './helpers.js';

const baseDeps = {
  systemPrompt: 'sys',
  categoryNames: ['Groceries', 'Dining Out'],
  confidenceThreshold: 0.6,
  resolveCategoryId: (n: string) =>
    ({ Groceries: 'c-groceries', 'Dining Out': 'c-dining' })[n] ?? null,
  resolvePayeeName: () => 'Whole Foods',
  resolveAccountName: () => 'Checking',
};

describe('decideCategory', () => {
  it('categorizes when confidence meets the threshold', async () => {
    const provider = fakeCategorizer(() => ({
      reasoning: 'food at home',
      category: 'Groceries',
      confidence: 0.9,
    }));
    const d = await decideCategory(txn(), { ...baseDeps, provider });
    expect(d.action).toBe('categorized');
    expect(d.chosenCategoryId).toBe('c-groceries');
  });

  it('leaves blank when confidence is below the threshold', async () => {
    const provider = fakeCategorizer(() => ({
      reasoning: 'maybe',
      category: 'Groceries',
      confidence: 0.4,
    }));
    const d = await decideCategory(txn(), { ...baseDeps, provider });
    expect(d.action).toBe('left_blank');
    expect(d.detail).toMatch(/confidence/);
  });

  it('leaves blank on the uncertain sentinel', async () => {
    const provider = fakeCategorizer(() => ({
      reasoning: 'no idea',
      category: UNKNOWN_CATEGORY,
      confidence: 0.99,
    }));
    const d = await decideCategory(txn(), { ...baseDeps, provider });
    expect(d.action).toBe('left_blank');
  });

  it('leaves blank when the model returns an unknown category', async () => {
    const provider = fakeCategorizer(() => ({
      reasoning: 'hallucinated',
      category: 'Spaceships',
      confidence: 0.95,
    }));
    const d = await decideCategory(txn(), { ...baseDeps, provider });
    expect(d.action).toBe('left_blank');
    expect(d.detail).toMatch(/unknown category/);
  });

  it('returns an error decision instead of throwing on provider failure', async () => {
    const provider = fakeCategorizer(() => {
      throw new Error('boom');
    });
    const d = await decideCategory(txn(), { ...baseDeps, provider });
    expect(d.action).toBe('error');
    expect(d.detail).toMatch(/boom/);
  });
});
