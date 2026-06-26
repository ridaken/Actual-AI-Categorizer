import type { ActualTransaction, Decision } from '../domain/types.js';
import { UNKNOWN_CATEGORY } from '../domain/types.js';
import type { CategorizerClient } from './provider.js';
import { buildUserMessage } from './prompt.js';

export interface CategorizeDeps {
  provider: CategorizerClient;
  systemPrompt: string;
  categoryNames: string[];
  confidenceThreshold: number;
  /** Resolve a category name to its id, or null if it is not a real category. */
  resolveCategoryId: (name: string) => string | null;
  /** Resolve a transaction's payee id to a display name. */
  resolvePayeeName: (txn: ActualTransaction) => string | null;
  /** Resolve a transaction's account id to a display name. */
  resolveAccountName: (txn: ActualTransaction) => string | null;
}

/**
 * Run one transaction through the AI and decide what to do. Pure with respect
 * to side effects: it does NOT write to Actual — the pipeline applies the
 * resulting Decision. Errors are returned as an 'error' Decision, never thrown,
 * so one bad row can't abort the run.
 */
export async function decideCategory(
  txn: ActualTransaction,
  deps: CategorizeDeps,
): Promise<Decision> {
  const base: Decision = {
    transactionId: txn.id,
    action: 'error',
    detail: '',
    payee: deps.resolvePayeeName(txn) ?? txn.imported_payee ?? null,
    amount: txn.amount,
    date: txn.date,
  };

  try {
    const user = buildUserMessage(txn, base.payee ?? null, deps.resolveAccountName(txn));
    const result = await deps.provider.categorize({
      system: deps.systemPrompt,
      user,
      categoryNames: deps.categoryNames,
    });

    base.confidence = result.confidence;
    base.reasoning = result.reasoning;
    base.chosenCategoryName = result.category;

    if (result.category === UNKNOWN_CATEGORY) {
      return { ...base, action: 'left_blank', detail: 'model returned uncertain' };
    }

    const categoryId = deps.resolveCategoryId(result.category);
    if (!categoryId) {
      // Should be impossible with constrained output, but guard anyway.
      return {
        ...base,
        action: 'left_blank',
        detail: `unknown category "${result.category}"`,
      };
    }

    if (result.confidence < deps.confidenceThreshold) {
      return {
        ...base,
        action: 'left_blank',
        detail: `confidence ${result.confidence.toFixed(2)} < threshold ${deps.confidenceThreshold}`,
        chosenCategoryId: categoryId,
      };
    }

    return {
      ...base,
      action: 'categorized',
      detail: 'ok',
      chosenCategoryId: categoryId,
    };
  } catch (err) {
    return { ...base, action: 'error', detail: String(err) };
  }
}
