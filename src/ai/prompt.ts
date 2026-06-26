import type { ActualTransaction, CategoryGroup } from '../domain/types.js';
import { UNKNOWN_CATEGORY } from '../domain/types.js';

/** A single few-shot example. Reserved for a future history-based enhancement. */
export interface CategoryExample {
  description: string; // human-readable transaction description
  category: string; // chosen category name
}

export interface PromptInputs {
  /** Live category groups (already filtered to selectable categories). */
  groups: CategoryGroup[];
  /** Contents of the user-maintained category reference sheet (Markdown). */
  referenceSheet: string;
  /** Optional few-shot examples (empty for v1). */
  examples?: CategoryExample[];
}

function renderCategoryList(groups: CategoryGroup[]): string {
  const lines: string[] = [];
  for (const g of groups) {
    if (g.categories.length === 0) continue;
    lines.push(`- ${g.name}:`);
    for (const c of g.categories) {
      lines.push(`    - ${c.name}`);
    }
  }
  return lines.join('\n');
}

/**
 * Build the system prompt. Composed of: fixed instructions, the live category
 * list (so only real categories are ever offered), the user's reference sheet
 * explaining nuanced distinctions, and optional few-shot examples.
 */
export function buildSystemPrompt(inputs: PromptInputs): string {
  const { groups, referenceSheet, examples = [] } = inputs;

  const sections: string[] = [];

  sections.push(
    [
      'You are a meticulous personal-finance bookkeeper. Your job is to assign the single',
      'best category to ONE bank transaction at a time.',
      '',
      'Rules:',
      '- Choose exactly one category from the "Available categories" list below.',
      '- You MUST use a category name verbatim as written. Do not invent new categories.',
      `- If no category is a reasonable fit, return "${UNKNOWN_CATEGORY}".`,
      '- Think step by step in the "reasoning" field, then commit to a "category".',
      '- "confidence" is your calibrated probability (0..1) that the category is correct.',
      '- A negative amount is money leaving the account (an expense); positive is income.',
    ].join('\n'),
  );

  sections.push('Available categories:\n' + renderCategoryList(groups));

  const trimmedSheet = referenceSheet.trim();
  if (trimmedSheet) {
    sections.push(
      'Category reference (distinctions between similar categories):\n' + trimmedSheet,
    );
  }

  if (examples.length > 0) {
    const ex = examples
      .map((e) => `- "${e.description}" => ${e.category}`)
      .join('\n');
    sections.push('Examples:\n' + ex);
  }

  return sections.join('\n\n');
}

function formatAmount(cents: number): string {
  const dollars = (cents / 100).toFixed(2);
  const direction = cents < 0 ? 'expense/outflow' : 'income/inflow';
  return `${dollars} (${direction})`;
}

/** Build the per-transaction user message. */
export function buildUserMessage(
  txn: ActualTransaction,
  payeeName: string | null,
  accountName: string | null,
): string {
  const lines = [
    'Categorize this transaction:',
    `- Date: ${txn.date}`,
    `- Amount: ${formatAmount(txn.amount)}`,
    `- Payee: ${payeeName ?? txn.imported_payee ?? '(unknown)'}`,
  ];
  if (txn.imported_payee && txn.imported_payee !== payeeName) {
    lines.push(`- Bank description: ${txn.imported_payee}`);
  }
  if (accountName) lines.push(`- Account: ${accountName}`);
  if (txn.notes) lines.push(`- Notes: ${txn.notes}`);
  return lines.join('\n');
}
