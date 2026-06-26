# actual-ai-categorizer

Automatically categorize uncategorized [Actual Budget](https://actualbudget.org)
transactions using an OpenAI-compatible AI server (built for
[llama.cpp / llama-server](https://github.com/ggml-org/llama.cpp); cloud providers
work too).

On each run it (optionally) triggers a SimpleFIN/GoCardless bank sync, pulls
**only uncategorized** transactions, asks the model to pick the best category
**one transaction at a time** (with per-row chain-of-thought), and writes the
result back — **never overwriting** a category you already set.

## How it works

```
bank sync (optional) → load categories/payees → find uncategorized rows
   → for each row: AI picks a category (constrained to your real categories)
   → write back if confidence ≥ threshold, else leave blank → sync
```

- **No SSH or DB hacking.** It uses the official `@actual-app/api`, the same
  backend code Actual itself ships, so it tracks the app across upgrades. All
  Actual calls live in `src/actual/` — the only place a future API change can hit.
- **Can't hallucinate categories.** With `constrained_output`, the request carries
  a JSON schema *and* a GBNF grammar whose `category` field is an enum of your live
  category names. The model can only return a real category (or an "uncertain"
  sentinel).
- **Safe by default.** Transfers and split parents are skipped, low-confidence rows
  are left blank and retried next run, and every decision is written to an audit
  log (`logs/audit.jsonl`).

## Requirements

- Node.js 18.17+ (Debian, macOS, Windows).
- A running Actual **sync server** and your budget's **Sync ID**
  (Settings → Advanced → Sync ID).
- An OpenAI-compatible chat endpoint (e.g. `llama-server` with `--port 8080`).

## Setup

```bash
npm install
npm run build

cp config.example.yaml config.yaml
cp categories.example.md categories.md
# edit both to taste
```

Secrets are referenced as `${VAR}` in `config.yaml` and read from the environment,
so they never sit in the file in plaintext:

```bash
export ACTUAL_PASSWORD='...'
export ACTUAL_E2E_PASSWORD=''   # only if your budget is end-to-end encrypted
export AI_API_KEY=''            # only for cloud providers
```

## Usage

```bash
# One cycle and exit (pair with systemd timer / cron):
actual-ai-categorizer run --config ./config.yaml

# Preview without writing anything:
actual-ai-categorizer run --dry-run

# Long-running daemon on the configured interval (good for macOS/Windows):
actual-ai-categorizer loop
```

During development you can skip the build with `npm run dev -- run --dry-run`.

## Configuration

See `config.example.yaml` for the fully-commented template. Highlights:

| Key | Meaning |
| --- | --- |
| `categorization.confidence_threshold` | Below this, leave the row uncategorized (retried next run). |
| `categorization.months_lookback` | Only consider transactions newer than N months. |
| `categorization.max_transactions` | Cap rows processed per run (0 = no cap). |
| `categorization.write_reasoning_to_notes` | Append the AI's reasoning/confidence to the transaction notes. |
| `bank_sync.enabled` | Trigger SimpleFIN/GoCardless sync before each run. Leave `false` if you don't use bank sync. |
| `ai.constrained_output` | Force valid-category output via json_schema + grammar. Recommended. |
| `scheduler.mode` / `polling_minutes` | `once` (with a timer) or `loop`. |

### The category reference sheet

`categories.md` is embedded verbatim into the system prompt. Use it to explain
distinctions the model can't infer from names alone (e.g. Groceries vs Dining Out).
Your categories themselves are read **live** from the budget, so adding/renaming a
category in Actual is picked up automatically — you only edit this file for nuance.

## Deployment on Debian (recommended)

Use the one-shot `run` with a systemd timer (see `systemd/`):

```bash
sudo cp -r . /opt/actual-ai-categorizer && cd /opt/actual-ai-categorizer
sudo mkdir -p /etc/actual-ai-categorizer
sudo cp config.yaml /etc/actual-ai-categorizer/
sudo cp systemd/secrets.env.example /etc/actual-ai-categorizer/secrets.env  # edit + chmod 600
sudo cp systemd/actual-ai-categorizer.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now actual-ai-categorizer.timer
```

On macOS/Windows, prefer `actual-ai-categorizer loop` (or Task Scheduler / launchd).

## Testing

```bash
npm test          # unit + adapter suite (no live Actual/AI needed)
npm run typecheck
```

Tests inject a fake Actual API and a stub AI client, and exercise the AI provider
against a local mock HTTP server — nothing external is required.

## Verifying against your real setup

1. Point `config.yaml` at a **copy/test budget** if you have one.
2. `actual-ai-categorizer run --dry-run` and inspect `logs/audit.jsonl` — confirm
   sensible categories and that transfers / splits / already-categorized rows were
   skipped.
3. Drop `--dry-run`, run once, and check in the Actual UI that only previously-blank,
   high-confidence rows changed.
4. Switch to `loop` mode or install the systemd timer.

## Compatibility note

`@actual-app/api` is pinned in `package.json`. When upgrading your Actual server,
bump it to a matching release and re-run `npm test`. The startup log records the
server URL it connected to; keep the API version aligned with your server version.
