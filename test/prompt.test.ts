import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserMessage } from '../src/ai/prompt.js';
import { buildResponseFormat, buildGrammar } from '../src/ai/schema.js';
import { UNKNOWN_CATEGORY } from '../src/domain/types.js';
import { txn } from './helpers.js';

const groups = [
  {
    id: 'g1',
    name: 'Expenses',
    categories: [
      { id: 'c1', name: 'Groceries' },
      { id: 'c2', name: 'Dining Out' },
    ],
  },
];

describe('buildSystemPrompt', () => {
  it('includes every live category and the reference sheet', () => {
    const prompt = buildSystemPrompt({
      groups,
      referenceSheet: 'Groceries means food at home.',
    });
    expect(prompt).toContain('Groceries');
    expect(prompt).toContain('Dining Out');
    expect(prompt).toContain('food at home');
    expect(prompt).toContain(UNKNOWN_CATEGORY);
  });

  it('renders few-shot examples when provided', () => {
    const prompt = buildSystemPrompt({
      groups,
      referenceSheet: '',
      examples: [{ description: 'WHOLE FOODS', category: 'Groceries' }],
    });
    expect(prompt).toContain('WHOLE FOODS');
  });
});

describe('buildUserMessage', () => {
  it('marks outflow vs inflow and includes payee/notes', () => {
    const msg = buildUserMessage(
      txn({ amount: -2500, notes: 'weekly shop' }),
      'Whole Foods',
      'Checking',
    );
    expect(msg).toContain('expense/outflow');
    expect(msg).toContain('Whole Foods');
    expect(msg).toContain('Checking');
    expect(msg).toContain('weekly shop');
  });

  it('falls back to imported_payee when no payee name', () => {
    const msg = buildUserMessage(
      txn({ payee_name: null, imported_payee: 'SQ *COFFEE' }),
      null,
      null,
    );
    expect(msg).toContain('SQ *COFFEE');
  });
});

describe('schema', () => {
  it('enumerates categories plus the uncertain sentinel in response_format', () => {
    const rf = buildResponseFormat(['Groceries', 'Dining Out']);
    expect(rf.json_schema.schema.properties.category.enum).toEqual([
      'Groceries',
      'Dining Out',
      UNKNOWN_CATEGORY,
    ]);
  });

  it('builds a grammar that references each category literal', () => {
    const g = buildGrammar(['Groceries', 'Dining Out']);
    expect(g).toContain('Groceries');
    expect(g).toContain('Dining Out');
    expect(g).toContain('category ::=');
  });
});
