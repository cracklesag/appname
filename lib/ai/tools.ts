// Tool schemas advertised to the model. The executor in runTools.ts maps each
// name to a query. All read tools are scoped to the signed-in user's farm by
// reusing the app's existing data loaders (which carry whatever RLS / farm
// resolution the rest of the app uses).

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const ASSISTANT_TOOLS: AnthropicTool[] = [
  {
    name: 'get_fields',
    description:
      "List all of the farm's fields with their key attributes: area, group, soil type, soil indices (pH, P, K, Mg), whether sampled and when, grass system, cut profile and planned cuts. Use this for any question that spans fields or needs the field list.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_field',
    description:
      'Get one field by name (case-insensitive, partial match allowed). Returns the same attributes as get_fields for the matched field, or a list of candidates if the name is ambiguous.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The field name to look up.' } },
      required: ['name'],
    },
  },
  {
    name: 'rank_fields_by_soil',
    description:
      "Rank the farm's sampled fields by a soil metric. Use for 'which fields are lowest on P', 'worst pH', etc.",
    input_schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['ph', 'p', 'k', 'mg'], description: 'Soil metric to rank by.' },
        order: { type: 'string', enum: ['asc', 'desc'], description: "asc = lowest first (default), desc = highest first." },
        limit: { type: 'integer', description: 'How many fields to return (default 5).' },
      },
      required: ['metric'],
    },
  },
  {
    name: 'get_recent_cuts',
    description:
      "Recent cut records (date, type, yield class, what's-next), newest first. Optionally filter to one field by name.",
    input_schema: {
      type: 'object',
      properties: {
        fieldName: { type: 'string', description: 'Optional — limit to this field.' },
        limit: { type: 'integer', description: 'Max rows (default 20).' },
      },
    },
  },
  {
    name: 'get_recent_applications',
    description:
      'Recent applications (product, date, rate + unit, method), newest first. Optionally filter to one field by name.',
    input_schema: {
      type: 'object',
      properties: {
        fieldName: { type: 'string', description: 'Optional — limit to this field.' },
        limit: { type: 'integer', description: 'Max rows (default 20).' },
      },
    },
  },
  {
    name: 'get_settings',
    description:
      "The farm's settings: unit system, soil targets, N targets per cut, report defaults (split %, annual N cap, maintenance dose threshold, grazing cadence), carryover release model, and timing prompts. Use when a question depends on a configurable value.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_products',
    description:
      "The product catalogue available to the farm (shared + custom): name, category, type and nutrient composition. Use for questions about what products exist or their N/P/K content.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_grazing_schedule',
    description:
      "The rotational-grazing nitrogen top-up schedule — the SAME computation as the app's Grazing top-up report. For ANY question about which grazing fields need nitrogen, when N was last applied to a grazing field, or when the next dose is due, use THIS tool. Do NOT derive grazing timing from get_recent_applications: that list is capped at the newest rows and will miss older dressings, giving false 'none on record' results, and it requires hand-computed dates. Returns, per grazing field (soonest-due first): area, last N date and rate, next-due date, days until due, and a status of overdue / due now / upcoming / awaiting first dose, plus the cadence in use. Only fields heading for rotational grazing are included.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_jobs',
    description:
      "Job sheets the farm has created (work sent to staff or contractors): title, type, status (draft/sent/submitted/approved/archived), who it's assigned to, due date, and per-field completion. Use for 'what jobs are outstanding', 'which jobs are waiting for approval', 'what has the contractor not done yet'. Optionally filter by status.",
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'sent', 'submitted', 'approved', 'archived'], description: 'Optional — only jobs in this status.' },
        limit: { type: 'integer', description: 'Max jobs (default 20).' },
      },
    },
  },
  {
    name: 'get_spray_stock',
    description:
      "Current spray-chemical stock: per product, litres purchased, litres used and litres remaining in store. Use for 'how much glyphosate have I got left', 'what spray am I low on', 'spray stock'. Negative remaining means more has been recorded as used than purchased.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'submit_feature_request',
    description:
      "File a feature request to the developer. ONLY call this after the user has explicitly agreed to send one, and only for something the app genuinely cannot do. Do not promise delivery.",
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'A clean one-line summary of the underlying need.' },
        raw_request: { type: 'string', description: "The user's request in their own words." },
        context: { type: 'string', description: 'Short note on what they were trying to do when they hit the wall.' },
      },
      required: ['summary'],
    },
  },
];
