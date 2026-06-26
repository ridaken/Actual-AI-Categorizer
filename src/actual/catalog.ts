import type {
  Account,
  ActualTransaction,
  CategoryGroup,
} from '../domain/types.js';
import type { ActualApi } from './client.js';

/**
 * A snapshot of the budget's categories/payees/accounts plus convenient lookup
 * helpers. Built once per run so name<->id resolution is O(1) per transaction.
 */
export class Catalog {
  private categoryIdByName = new Map<string, string>();
  private payeeNameById = new Map<string, string>();
  private accountNameById = new Map<string, string>();

  private constructor(
    /** Selectable, non-hidden, non-income category groups for the prompt. */
    readonly groups: CategoryGroup[],
  ) {}

  static async load(api: ActualApi): Promise<Catalog> {
    const [groups, payees, accounts] = await Promise.all([
      api.getCategoryGroups(),
      api.getPayees(),
      api.getAccounts(),
    ]);

    // Offer only spendable categories: drop hidden groups/categories and the
    // income group (income is not what we auto-assign for typical spending).
    const selectable: CategoryGroup[] = groups
      .filter((g) => !g.hidden && !g.is_income)
      .map((g) => ({
        ...g,
        categories: (g.categories ?? []).filter((c) => !c.hidden && !c.is_income),
      }))
      .filter((g) => g.categories.length > 0);

    const catalog = new Catalog(selectable);
    for (const g of selectable) {
      for (const c of g.categories) catalog.categoryIdByName.set(c.name, c.id);
    }
    for (const p of payees) catalog.payeeNameById.set(p.id, p.name);
    for (const a of accounts) catalog.accountNameById.set(a.id, a.name);
    return catalog;
  }

  /** Flat list of selectable category names (the AI's allowed choices). */
  categoryNames(): string[] {
    return [...this.categoryIdByName.keys()];
  }

  resolveCategoryId(name: string): string | null {
    return this.categoryIdByName.get(name) ?? null;
  }

  resolvePayeeName(txn: ActualTransaction): string | null {
    if (txn.payee_name) return txn.payee_name;
    if (txn.payee) return this.payeeNameById.get(txn.payee) ?? null;
    return null;
  }

  resolveAccountName(txn: ActualTransaction): string | null {
    return this.accountNameById.get(txn.account) ?? null;
  }

  /** On-budget, non-closed accounts to scan for candidates. */
  budgetAccountIds(accounts: Account[]): string[] {
    return accounts.filter((a) => !a.closed && !a.offbudget).map((a) => a.id);
  }
}
