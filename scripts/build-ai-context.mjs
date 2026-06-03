#!/usr/bin/env node
// Generates lib/ai/context-doc.ts from docs/ai-context.md.
// Keeps a single editable source: edit the markdown, re-run this, commit both.
//   node scripts/build-ai-context.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const md = readFileSync(join(root, 'docs/ai-context.md'), 'utf8');

// Escape backticks and ${ so the markdown is safe inside a template literal.
const escaped = md.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const out = `// AUTO-GENERATED from docs/ai-context.md by scripts/build-ai-context.mjs.
// Do not edit by hand — edit the markdown and re-run the script.
export const AI_CONTEXT_MD = \`${escaped}\`;
`;

writeFileSync(join(root, 'lib/ai/context-doc.ts'), out, 'utf8');
console.log('Wrote lib/ai/context-doc.ts (%d chars of context).', md.length);
