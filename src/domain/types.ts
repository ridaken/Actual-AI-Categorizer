/**
 * Shared domain types. These mirror the shapes returned by `@actual-app/api`
 * but are declared locally so the rest of the codebase does not depend on the
 * library's types directly (single coupling boundary => easier to adapt to
 * future Actual changes).
 */

export interface ActualTransaction {
  id: string;
  account: string;
  date: string; // YYYY-MM-DD
  amount: number; // integer cents; negative = outflow
  payee?: string | null;
  payee_name?: string | null;
  imported_payee?: string | null;
  category?: string | null; // category id, or null/undefined when uncategorized
  notes?: string | null;
  transfer_id?: string | null;
  is_parent?: boolean; // split parent
  is_child?: boolean; // split child
  cleared?: boolean;
  reconciled?: boolean;
}

export interface Category {
  id: string;
  name: string;
  group_id?: string;
  is_income?: boolean;
  hidden?: boolean;
}

export interface CategoryGroup {
  id: string;
  name: string;
  is_income?: boolean;
  hidden?: boolean;
  categories: Category[];
}

export interface Account {
  id: string;
  name: string;
  closed?: boolean;
  offbudget?: boolean;
}

export interface Payee {
  id: string;
  name: string;
  transfer_acct?: string | null;
}

/** Structured response we ask the AI to produce for a single transaction. */
export interface CategorizationResult {
  reasoning: string;
  /** A category name from the live list, or the UNKNOWN sentinel. */
  category: string;
  confidence: number; // 0..1
}

/** What the pipeline decided to do with one transaction. */
export type DecisionAction = 'categorized' | 'left_blank' | 'skipped' | 'error';

export interface Decision {
  transactionId: string;
  action: DecisionAction;
  /** Reason for skip/leave-blank, or a short note. */
  detail: string;
  payee?: string | null;
  amount?: number;
  date?: string;
  chosenCategoryName?: string | null;
  chosenCategoryId?: string | null;
  confidence?: number;
  reasoning?: string;
}

/** Sentinel the model may return to indicate "no good category". */
export const UNKNOWN_CATEGORY = '__uncertain__';
