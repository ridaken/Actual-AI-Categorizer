import type { CategorizationResult } from '../domain/types.js';
import { buildResponseFormat, buildGrammar } from './schema.js';

export interface AiProviderConfig {
  baseUrl: string; // e.g. http://host:8080/v1
  apiKey?: string;
  model: string;
  temperature: number;
  requestTimeoutMs: number;
  maxRetries: number;
  constrainedOutput: boolean;
}

export interface ChatRequest {
  system: string;
  user: string;
  categoryNames: string[];
}

/** Anything that can categorize one transaction. Lets callers inject a stub. */
export interface CategorizerClient {
  categorize(req: ChatRequest): Promise<CategorizationResult>;
}

export class AiError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Minimal OpenAI-compatible chat client. Works against llama.cpp's llama-server
 * and any cloud provider exposing /chat/completions.
 */
export class AiProvider implements CategorizerClient {
  constructor(
    private cfg: AiProviderConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private endpoint(): string {
    return this.cfg.baseUrl.replace(/\/$/, '') + '/chat/completions';
  }

  private buildBody(req: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      temperature: this.cfg.temperature,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    };
    if (this.cfg.constrainedOutput) {
      // Primary path: OpenAI-style structured output.
      body.response_format = buildResponseFormat(req.categoryNames);
      // Fallback the llama.cpp server understands even if response_format is
      // ignored; harmless to other providers that drop unknown fields.
      body.grammar = buildGrammar(req.categoryNames);
    }
    return body;
  }

  /** Categorize a single transaction. Retries transient failures with backoff. */
  async categorize(req: ChatRequest): Promise<CategorizationResult> {
    const body = this.buildBody(req);
    let lastErr: unknown;

    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      if (attempt > 0) await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.cfg.requestTimeoutMs);
        let res: Response;
        try {
          res = await this.fetchImpl(this.endpoint(), {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        if (res.status >= 500 || res.status === 429) {
          lastErr = new AiError(`server returned ${res.status}`);
          continue; // retryable
        }
        if (!res.ok) {
          throw new AiError(`request failed: ${res.status} ${await safeText(res)}`);
        }

        const json = (await res.json()) as ChatCompletionResponse;
        const content = json.choices?.[0]?.message?.content;
        if (!content) throw new AiError('empty completion content');
        return parseResult(content);
      } catch (err) {
        lastErr = err;
        // AbortError and network errors are retryable; explicit AiError for a
        // non-2xx, non-5xx response is not.
        if (err instanceof AiError && !/^server returned/.test(err.message)) {
          if (attempt >= this.cfg.maxRetries) throw err;
        }
      }
    }
    throw new AiError(`AI request failed after retries: ${String(lastErr)}`);
  }
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}

/**
 * Parse the model's JSON response. Tolerant of leading/trailing prose by
 * extracting the first balanced JSON object.
 */
export function parseResult(content: string): CategorizationResult {
  const jsonText = extractJson(content);
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    throw new AiError(`could not parse JSON from completion: ${content.slice(0, 200)}`);
  }
  const o = obj as Record<string, unknown>;
  if (typeof o.category !== 'string') throw new AiError('completion missing "category"');
  const confidence = typeof o.confidence === 'number' ? o.confidence : 0;
  return {
    reasoning: typeof o.reasoning === 'string' ? o.reasoning : '',
    category: o.category,
    confidence: Math.max(0, Math.min(1, confidence)),
  };
}

function extractJson(content: string): string {
  const start = content.indexOf('{');
  if (start === -1) return content;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }
  return content.slice(start);
}
