import { AI_CONTEXT_MD } from './context-doc';

/** Dynamic, per-request framing prepended to the static reference document. */
export interface FarmFraming {
  farmName: string | null;
  role: 'admin' | 'staff';
  accountType: 'farm' | 'contractor';
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
  const who =
    f.accountType === 'contractor'
      ? 'a contractor account (they receive job sheets from farms; they have no fields or nutrient data of their own — steer them to Jobs, Timesheets, Team and Settings)'
      : f.role === 'admin' ? 'the farm admin' : 'a staff member';
  const farm = f.accountType === 'contractor' ? (f.farmName ? ` (business: "${f.farmName}")` : '') : (f.farmName ? ` on the farm "${f.farmName}"` : '');
  return [
    `You are the in-app assistant for Swardly, a UK grassland nutrient-management app. You are talking to ${who}${farm}. Today is ${f.todayIso}. The farm's unit system is ${f.unitSystem} — give nutrient and area figures in that system.`,
    `Answer questions about how the app works and about this farm's own data. For any question about the user's data, call the tools to look it up before answering — never guess at their fields, cuts, applications, soil indices or settings. For grazing nitrogen timing — which grazing fields need N, when N was last applied, or when the next dose is due — call get_grazing_schedule (it matches the Grazing top-up report exactly); do not work it out from get_recent_applications, and quote the dates and "days until due" it returns rather than calculating them yourself. Keep replies short and plain; users are often on a phone in the field.`,
    `Follow the rules and use the exact terminology in the reference below. Do not invent RB209 figures, regulatory thresholds, or agronomic recommendations the app does not produce. If you don't know, say so. Only offer to file a feature request for something the app genuinely cannot do, and never without asking the user first.`,
    '',
    '--- SWARDLY REFERENCE ---',
    AI_CONTEXT_MD,
  ].join('\n');
}
