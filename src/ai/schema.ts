import { UNKNOWN_CATEGORY } from '../domain/types.js';

/**
 * Build the JSON-schema `response_format` payload. The `category` field is an
 * enum of the live category names (plus the UNKNOWN sentinel), so a conforming
 * server physically cannot return a category that does not exist.
 */
export function buildResponseFormat(categoryNames: string[]) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: 'transaction_categorization',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['reasoning', 'category', 'confidence'],
        properties: {
          reasoning: {
            type: 'string',
            description: 'Brief chain-of-thought justifying the chosen category.',
          },
          category: {
            type: 'string',
            enum: [...categoryNames, UNKNOWN_CATEGORY],
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
          },
        },
      },
    },
  };
}

function escapeGbnfLiteral(s: string): string {
  // GBNF string literals are double-quoted; escape backslash and quote.
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build an equivalent GBNF grammar as a fallback for llama.cpp servers whose
 * `/v1/chat/completions` `response_format` handling is broken. Enforces the
 * object shape and constrains `category` to the literal enum values.
 */
export function buildGrammar(categoryNames: string[]): string {
  const names = [...categoryNames, UNKNOWN_CATEGORY];
  const categoryAlt = names
    .map((n) => `"\\"${escapeGbnfLiteral(n)}\\""`)
    .join(' | ');

  return [
    'root   ::= "{" ws "\\"reasoning\\"" ws ":" ws string ws "," ws "\\"category\\"" ws ":" ws category ws "," ws "\\"confidence\\"" ws ":" ws number ws "}"',
    `category ::= ${categoryAlt}`,
    'string ::= "\\"" char* "\\""',
    'char   ::= [^"\\\\] | "\\\\" (["\\\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F])',
    'number ::= ("0" | [1-9] [0-9]*) ("." [0-9]+)?',
    'ws     ::= [ \\t\\n]*',
  ].join('\n');
}
