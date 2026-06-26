import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AiProvider, parseResult, AiError } from '../src/ai/provider.js';

let server: Server | undefined;

async function startServer(
  handler: (body: any, req: { count: number }) => { status?: number; json?: unknown },
): Promise<string> {
  let count = 0;
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      count++;
      const body = raw ? JSON.parse(raw) : {};
      const { status = 200, json = {} } = handler(body, { count });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((r) => server!.listen(0, r));
  const addr = server!.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return `http://127.0.0.1:${port}/v1`;
}

afterEach(() => {
  server?.close();
  server = undefined;
});

function completion(content: string) {
  return { choices: [{ message: { content } }] };
}

const cfg = (baseUrl: string, over = {}) => ({
  baseUrl,
  model: 'm',
  temperature: 0.2,
  requestTimeoutMs: 2000,
  maxRetries: 2,
  constrainedOutput: true,
  ...over,
});

describe('AiProvider', () => {
  it('sends constrained-output fields and parses the result', async () => {
    let received: any;
    const url = await startServer((body) => {
      received = body;
      return {
        json: completion(
          JSON.stringify({ reasoning: 'r', category: 'Groceries', confidence: 0.8 }),
        ),
      };
    });
    const provider = new AiProvider(cfg(url));
    const result = await provider.categorize({
      system: 'sys',
      user: 'usr',
      categoryNames: ['Groceries'],
    });
    expect(result.category).toBe('Groceries');
    expect(received.response_format.type).toBe('json_schema');
    expect(received.grammar).toContain('Groceries');
    expect(received.messages[0].role).toBe('system');
  });

  it('retries on a 5xx then succeeds', async () => {
    const url = await startServer((_b, { count }) => {
      if (count === 1) return { status: 503 };
      return {
        json: completion(
          JSON.stringify({ reasoning: 'r', category: 'Dining Out', confidence: 0.7 }),
        ),
      };
    });
    const provider = new AiProvider(cfg(url));
    const result = await provider.categorize({
      system: 's',
      user: 'u',
      categoryNames: ['Dining Out'],
    });
    expect(result.category).toBe('Dining Out');
  });

  it('throws after exhausting retries', async () => {
    const url = await startServer(() => ({ status: 500 }));
    const provider = new AiProvider(cfg(url, { maxRetries: 1 }));
    await expect(
      provider.categorize({ system: 's', user: 'u', categoryNames: ['X'] }),
    ).rejects.toBeInstanceOf(AiError);
  });
});

describe('parseResult', () => {
  it('extracts JSON embedded in surrounding prose', () => {
    const r = parseResult(
      'Sure! {"reasoning":"r","category":"Groceries","confidence":0.9} done',
    );
    expect(r.category).toBe('Groceries');
    expect(r.confidence).toBe(0.9);
  });

  it('clamps confidence into [0,1]', () => {
    const r = parseResult('{"reasoning":"r","category":"X","confidence":5}');
    expect(r.confidence).toBe(1);
  });

  it('throws on a missing category', () => {
    expect(() => parseResult('{"reasoning":"r","confidence":0.5}')).toThrow();
  });
});
