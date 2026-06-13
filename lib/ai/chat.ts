// Core assistant logic: call the Anthropic Messages API with the system prompt
// and tools, run the tool-use loop server-side, and return a single final text
// reply. Tool_use / tool_result turns stay server-side and are never exposed to
// the client — the UI only ever holds plain {role, content} text messages.

import { buildSystemPrompt, type FarmFraming } from './systemPrompt';
import { ASSISTANT_TOOLS } from './tools';
import { runTool } from './runTools';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
// Sonnet is the sweet spot for this app: explanation + lookups + light
// reasoning. Bump to an Opus string here if quality ever needs it.
// Model is overridable per-deployment: set ASSISTANT_MODEL in Vercel env
// (e.g. 'claude-haiku-4-5' to trial the cheaper tier) — no code change needed.
const MODEL = process.env.ASSISTANT_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 2048;
const MAX_TOOL_ITERATIONS = 5;

/** Plain message the client sends and stores. */
export interface PlainMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Anthropic content block (text or tool_use in responses; tool_result in our requests). */
type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Block[];
}

interface AnthropicResponse {
  content: Block[];
  stop_reason: string;
  model?: string; // the resolved model ID that actually served the request
}

async function callAnthropic(system: string, messages: AnthropicMessage[]): Promise<AnthropicResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Prompt caching. The tools + system prompt are identical on every call
      // (the ~8k-token reference doc rides along each time), so we cache them.
      // A single cache_control breakpoint caches the whole static prefix —
      // tools first, then system. The conversation + tool results (messages
      // below) are never cached, and the farm's data isn't in the prompt at
      // all: tools fetch it live each turn, so a data change never needs a
      // re-cache. First call writes the cache (small premium); calls within the
      // window read it (~90% cheaper). Sliding ~5-min TTL, refreshed on each
      // hit. Confirm exact pricing/TTL against current Anthropic docs.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: ASSISTANT_TOOLS,
      messages,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as AnthropicResponse;
}

/**
 * Run one assistant turn. `history` is the plain conversation so far (the
 * current user message included as the last entry). Returns the final reply
 * text and the names of any tools used (handy for debugging / logging).
 */
// Pull the optional "[[FOLLOWUPS]] a? | b? | c?" trailer off the reply. The
// model is told to put it on the last line; we strip it from the visible text
// and return up to 3 cleaned suggestions. Tolerant of casing/spacing, and a
// no-op when the trailer is absent.
function extractFollowups(reply: string): { text: string; suggestions: string[] } {
  const idx = reply.search(/\[\[FOLLOWUPS\]\]/i);
  if (idx === -1) return { text: reply, suggestions: [] };
  const text = reply.slice(0, idx).trim();
  const raw = reply.slice(idx).replace(/\[\[FOLLOWUPS\]\]/i, '');
  const suggestions = raw
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 80)
    .slice(0, 3);
  return { text, suggestions };
}

export async function runAssistant(
  history: PlainMessage[],
  framing: FarmFraming,
): Promise<{ reply: string; toolsUsed: string[]; model: string; suggestions: string[] }> {
  const system = buildSystemPrompt(framing);
  const messages: AnthropicMessage[] = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content }));

  const toolsUsed: string[] = [];
  let servedModel = MODEL;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const resp = await callAnthropic(system, messages);
    if (resp.model) servedModel = resp.model;

    if (resp.stop_reason === 'tool_use') {
      // Echo the assistant's tool-call turn back into the working history.
      messages.push({ role: 'assistant', content: resp.content });
      const results: Block[] = [];
      for (const block of resp.content) {
        if (block.type === 'tool_use') {
          toolsUsed.push(block.name);
          const result = await runTool(block.name, block.input ?? {});
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
        }
      }
      messages.push({ role: 'user', content: results });
      continue; // let the model read the results and answer (or call again)
    }

    const reply = resp.content
      .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const { text, suggestions } = extractFollowups(reply);
    return { reply: text || "I didn't catch that — could you rephrase?", toolsUsed, model: servedModel, suggestions };
  }

  return {
    reply: "Sorry — I couldn't finish working that out just now. Try asking a slightly simpler question?",
    toolsUsed,
    model: servedModel,
    suggestions: [],
  };
}
