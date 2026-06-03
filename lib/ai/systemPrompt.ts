import { AI_CONTEXT_MD } from './context-doc';

/** Dynamic, per-request framing prepended to the static reference document. */
export interface FarmFraming {
  farmName: string | null;
  role: 'admin' | 'staff';
  unitSystem: 'acres' | 'hectares';
  todayIso: string; // YYYY-MM-DD
}

/**
 * Assemble the assistant's system prompt: a short live framing (who the user
 * is, the farm, today's date, units) followed by the full Swardly reference
 * (generated from docs/ai-context.md). The framing is what changes per user;
 * the reference is the same for everyone.
 */
export function buildSystemPrompt(f: FarmFraming): string {
  const who = f.role === 'admin' ? 'the farm admin' : 'a staff member';
  const farm = f.farmName ? ` "${f.farmName}"` : '';
  return [
    `You are the in-app assistant for Swardly, a UK grassland nutrient-management app. You are talking to ${who} on the farm${farm}. Today is ${f.todayIso}. The farm's unit system is ${f.unitSystem} — give nutrient and area figures in that system.`,
    `Answer questions about how the app works and about this farm's own data. For any question about the user's data, call the tools to look it up before answering — never guess at their fields, cuts, applications, soil indices or settings. Keep replies short and plain; users are often on a phone in the field.`,
    `Follow the rules and use the exact terminology in the reference below. Do not invent RB209 figures, regulatory thresholds, or agronomic recommendations the app does not produce. If you don't know, say so. Only offer to file a feature request for something the app genuinely cannot do, and never without asking the user first.`,
    '',
    '--- SWARDLY REFERENCE ---',
    AI_CONTEXT_MD,
  ].join('\n');
}
