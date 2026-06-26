import type { Config } from './config.js';
import type { ActualApi } from './actual/client.js';
import { Catalog } from './actual/catalog.js';
import { fetchCandidates, applyCategory } from './actual/transactions.js';
import { runBankSyncIfEnabled } from './actual/bankSync.js';
import type { CategorizerClient } from './ai/provider.js';
import { buildSystemPrompt } from './ai/prompt.js';
import { decideCategory } from './ai/categorize.js';
import type { Decision } from './domain/types.js';
import type { AuditWriter, Logger } from './logger.js';

export interface PipelineDeps {
  api: ActualApi;
  provider: CategorizerClient;
  config: Config;
  referenceSheet: string;
  logger: Logger;
  audit: AuditWriter;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

export interface RunSummary {
  candidates: number;
  categorized: number;
  leftBlank: number;
  errors: number;
}

/** Execute one full categorization cycle. Never throws on per-row failures. */
export async function runOnce(deps: PipelineDeps): Promise<RunSummary> {
  const { api, provider, config, logger, audit } = deps;
  const now = deps.now ?? (() => new Date());

  await runBankSyncIfEnabled(
    api,
    { enabled: config.bank_sync.enabled, accountIds: config.bank_sync.account_ids },
    logger,
  );

  const catalog = await Catalog.load(api);
  const accounts = await api.getAccounts();
  const accountIds = catalog.budgetAccountIds(accounts);
  logger.debug(`scanning ${accountIds.length} on-budget account(s)`);

  const candidates = await fetchCandidates(
    api,
    accountIds,
    {
      skipTransfers: config.categorization.skip_transfers,
      skipSplits: config.categorization.skip_splits,
      monthsLookback: config.categorization.months_lookback,
      maxTransactions: config.categorization.max_transactions,
    },
    now(),
  );
  logger.info(`found ${candidates.length} uncategorized candidate transaction(s)`);

  const systemPrompt = buildSystemPrompt({
    groups: catalog.groups,
    referenceSheet: deps.referenceSheet,
  });
  const categoryNames = catalog.categoryNames();

  const summary: RunSummary = {
    candidates: candidates.length,
    categorized: 0,
    leftBlank: 0,
    errors: 0,
  };

  for (const txn of candidates) {
    const decision = await decideCategory(txn, {
      provider,
      systemPrompt,
      categoryNames,
      confidenceThreshold: config.categorization.confidence_threshold,
      resolveCategoryId: (n) => catalog.resolveCategoryId(n),
      resolvePayeeName: (t) => catalog.resolvePayeeName(t),
      resolveAccountName: (t) => catalog.resolveAccountName(t),
    });

    await applyDecision(deps, decision);
    tally(summary, decision);
    audit.write(decision);
  }

  if (!config.dry_run && summary.categorized > 0) {
    await api.sync();
  }

  logger.info(
    `run complete: ${summary.categorized} categorized, ` +
      `${summary.leftBlank} left blank, ${summary.errors} error(s)` +
      (config.dry_run ? ' (dry-run, no writes)' : ''),
  );
  return summary;
}

async function applyDecision(deps: PipelineDeps, decision: Decision): Promise<void> {
  const { api, config, logger } = deps;
  if (decision.action !== 'categorized' || !decision.chosenCategoryId) return;

  const payeeLabel = decision.payee ?? '(unknown payee)';
  if (config.dry_run) {
    logger.info(
      `[dry-run] would set "${payeeLabel}" (${centsToStr(decision.amount)}) => ` +
        `${decision.chosenCategoryName}`,
    );
    return;
  }

  const notes = config.categorization.write_reasoning_to_notes
    ? composeNote(decision)
    : undefined;
  await applyCategory(api, decision.transactionId, decision.chosenCategoryId, notes);
  logger.info(
    `categorized "${payeeLabel}" (${centsToStr(decision.amount)}) => ` +
      `${decision.chosenCategoryName} [${decision.confidence?.toFixed(2)}]`,
  );
}

function composeNote(decision: Decision): string {
  const conf = decision.confidence?.toFixed(2) ?? '?';
  return `[AI ${conf}] ${decision.reasoning ?? ''}`.trim();
}

function tally(summary: RunSummary, decision: Decision): void {
  if (decision.action === 'categorized') summary.categorized++;
  else if (decision.action === 'left_blank') summary.leftBlank++;
  else if (decision.action === 'error') summary.errors++;
}

function centsToStr(cents?: number): string {
  if (cents === undefined) return '?';
  return (cents / 100).toFixed(2);
}
