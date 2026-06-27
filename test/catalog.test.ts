import { describe, it, expect } from 'vitest';
import { Catalog } from '../src/actual/catalog.js';
import { fakeApi, txn } from './helpers.js';
import type { CategoryGroup } from '../src/domain/types.js';

const groups: CategoryGroup[] = [
  {
    id: 'g-exp',
    name: 'Expenses',
    categories: [
      { id: 'c-gro', name: 'Groceries' },
      { id: 'c-din', name: 'Dining Out' },
      { id: 'c-old', name: 'Old', hidden: true },
    ],
  },
  {
    id: 'g-inc',
    name: 'Income',
    is_income: true,
    categories: [{ id: 'c-sal', name: 'Salary' }],
  },
  {
    id: 'g-hid',
    name: 'Hidden group',
    hidden: true,
    categories: [{ id: 'c-x', name: 'Secret' }],
  },
];

const accounts = [
  { id: 'a1', name: 'Checking' },
  { id: 'a2', name: 'Old Savings', closed: true },
  { id: 'a3', name: 'Cash', offbudget: true },
];

async function build(): Promise<Catalog> {
  return Catalog.load(
    fakeApi({ groups, accounts, payees: [{ id: 'p1', name: 'Whole Foods' }] }),
  );
}

describe('Catalog', () => {
  it('exposes only selectable categories (drops hidden, income, and emptied groups)', async () => {
    const cat = await build();
    expect(cat.groups.map((g) => g.name)).toEqual(['Expenses']);
    expect(cat.categoryNames()).toEqual(['Groceries', 'Dining Out']);
  });

  it('resolves category names to ids', async () => {
    const cat = await build();
    expect(cat.resolveCategoryId('Groceries')).toBe('c-gro');
    expect(cat.resolveCategoryId('Salary')).toBeNull(); // income, not selectable
    expect(cat.resolveCategoryId('Nonexistent')).toBeNull();
  });

  it('resolves payee names with payee_name taking precedence over id lookup', async () => {
    const cat = await build();
    expect(cat.resolvePayeeName(txn({ payee_name: 'Inline' }))).toBe('Inline');
    expect(cat.resolvePayeeName(txn({ payee_name: null, payee: 'p1' }))).toBe('Whole Foods');
    expect(cat.resolvePayeeName(txn({ payee_name: null, payee: null }))).toBeNull();
  });

  it('resolves account names', async () => {
    const cat = await build();
    expect(cat.resolveAccountName(txn({ account: 'a1' }))).toBe('Checking');
    expect(cat.resolveAccountName(txn({ account: 'zzz' }))).toBeNull();
  });

  it('lists only on-budget, non-closed accounts to scan', async () => {
    const cat = await build();
    expect(cat.budgetAccountIds(accounts)).toEqual(['a1']);
  });
});
