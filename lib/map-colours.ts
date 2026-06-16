// Shared colour logic for the whole-farm map and the per-report topic maps.
// Pure (no maplibre, no React) so it can be unit-tested and reused by both the
// FarmMapShell editor and the read-only TopicMap.

export type ColourMode = "none" | "ph" | "p" | "k" | "block" | "type" | "agreement";

/** Minimal field shape the colour logic needs. FarmMapShell's MapField and the
 *  report ColourField builders both satisfy this structurally. */
export type ColourField = {
  id: string;
  name: string;
  ha: number;
  ph?: number | null;
  p_idx: number | null;
  k_idx: number | null;
  limeStatus?: "ok" | "low" | "due" | "unknown";
  boundary: any | null; // GeoJSON geometry, [lng,lat]
  centroid_lat?: number | null;
  centroid_lng?: number | null;
  area_ha_mapped?: number | null;
  boundary_source?: string | null;
  group_id?: string | null;
  allocation_type_id?: string | null;
  agreementIds?: string[];
};

// Colours echo the app's forest / amber / red conventions.
export const COLOURS = {
  good: "#3f8f4f",
  warn: "#e0a210",
  bad: "#d6492f",
  unknown: "#9aa0a6",
  neutral: "#2f7d6a",
  parcel: "#22d3ee",
  draw: "#f59e0b",
  allocated: "#f97316",
};

export function indexColour(v: number | null | undefined): string {
  if (v == null) return COLOURS.unknown;
  if (v <= 1) return COLOURS.bad; // deficient → build up
  if (v === 2) return COLOURS.good; // target
  return COLOURS.warn; // index 3+ → high, hold
}

export function statusColourFor(f: ColourField, mode: ColourMode): string {
  if (mode === "none") return COLOURS.neutral;
  if (mode === "ph") {
    if (!f.limeStatus || f.limeStatus === "unknown") return COLOURS.unknown;
    if (f.limeStatus === "ok") return COLOURS.good;
    if (f.limeStatus === "low") return COLOURS.warn;
    return COLOURS.bad; // 'due'
  }
  if (mode === "p") return indexColour(f.p_idx);
  if (mode === "k") return indexColour(f.k_idx);
  return COLOURS.neutral; // categorical modes handled by buildColouring
}

/** GeoJSON FeatureCollection of field boundaries, each carrying a `colour`. */
export function fieldsToFC(fields: ColourField[], colourOf: (f: ColourField) => string) {
  return {
    type: "FeatureCollection" as const,
    features: fields
      .filter((f) => f.boundary)
      .map((f) => ({
        type: "Feature" as const,
        geometry: f.boundary,
        properties: {
          id: f.id,
          name: f.name,
          colour: colourOf(f),
          ha: f.ha,
          mapped: f.area_ha_mapped ?? null,
          source: f.boundary_source ?? "",
        },
      })),
  };
}

// Distinct, satellite-readable hues for categorical modes (block/type/agreement).
// Assigned by sorted label so a field keeps its colour across renders.
export const CATEGORICAL = [
  "#2f7d6a", "#b5651d", "#3f6fb0", "#8a5fb0", "#b0843f", "#4f8f4f",
  "#c0566f", "#4f9fb0", "#8f7a3f", "#6f6f9f", "#3f9f8f", "#a05f3f",
];
export function categoricalColour(i: number): string {
  return CATEGORICAL[i % CATEGORICAL.length];
}

export type ColourLabels = {
  block: Record<string, string>;
  type: Record<string, string>;
  agreement: Record<string, string>;
};

/**
 * Per-field colour function + legend for a mode. Gradient modes (ph/p/k) keep a
 * fixed status legend; categorical modes (block/type/agreement) assign palette
 * colours to the values present and build a dynamic legend. Agreement colours by
 * a field's FIRST agreement.
 */
export function buildColouring(
  fields: ColourField[],
  mode: ColourMode,
  labels: ColourLabels,
): { colourOf: (f: ColourField) => string; legend: { colour: string; label: string }[] } {
  if (mode === "none") return { colourOf: () => COLOURS.neutral, legend: [] };

  if (mode === "ph" || mode === "p" || mode === "k") {
    const legend = mode === "ph"
      ? [
          { colour: COLOURS.good, label: "At/above target" },
          { colour: COLOURS.warn, label: "Slightly low" },
          { colour: COLOURS.bad, label: "Low — lime due" },
          { colour: COLOURS.unknown, label: "Not sampled" },
        ]
      : [
          { colour: COLOURS.good, label: "Index 2 (target)" },
          { colour: COLOURS.warn, label: "Index 3+ (high)" },
          { colour: COLOURS.bad, label: "Index 0–1 (low)" },
          { colour: COLOURS.unknown, label: "Not sampled" },
        ];
    return { colourOf: (f) => statusColourFor(f, mode), legend };
  }

  // Categorical: block / type / agreement
  const valueOf = (f: ColourField): string | null =>
    mode === "block" ? (f.group_id ?? null)
    : mode === "type" ? (f.allocation_type_id ?? null)
    : (f.agreementIds && f.agreementIds.length ? f.agreementIds[0] : null);
  const labelMap = mode === "block" ? labels.block : mode === "type" ? labels.type : labels.agreement;
  const noneLabel = mode === "block" ? "No block" : mode === "type" ? "Untyped" : "No agreement";

  const present = Array.from(new Set(fields.map(valueOf).filter((v): v is string => !!v)));
  present.sort((a, b) => (labelMap[a] ?? a).localeCompare(labelMap[b] ?? b));
  const colourByValue = new Map<string, string>();
  present.forEach((v, i) => colourByValue.set(v, categoricalColour(i)));
  const anyNone = fields.some((f) => !valueOf(f));

  const colourOf = (f: ColourField) => {
    const v = valueOf(f);
    return v ? (colourByValue.get(v) ?? COLOURS.unknown) : COLOURS.unknown;
  };
  const legend = present.map((v) => ({ colour: colourByValue.get(v)!, label: labelMap[v] ?? v }));
  if (anyNone) legend.push({ colour: COLOURS.unknown, label: noneLabel });
  return { colourOf, legend };
}

/** Short value label for a field in a given mode (for map popups). */
export function valueLabelFor(f: ColourField, mode: ColourMode, labels: ColourLabels): string {
  switch (mode) {
    case "ph": return f.ph != null ? `pH ${f.ph}` : "Not sampled";
    case "p": return f.p_idx != null ? `P index ${f.p_idx}` : "P not sampled";
    case "k": return f.k_idx != null ? `K index ${f.k_idx}` : "K not sampled";
    case "block": return f.group_id ? (labels.block[f.group_id] ?? "Block") : "No block";
    case "type": return f.allocation_type_id ? (labels.type[f.allocation_type_id] ?? "Type") : "Untyped";
    case "agreement": {
      const id = f.agreementIds && f.agreementIds.length ? f.agreementIds[0] : null;
      const extra = f.agreementIds && f.agreementIds.length > 1 ? ` +${f.agreementIds.length - 1}` : "";
      return id ? `${labels.agreement[id] ?? "Agreement"}${extra}` : "No agreement";
    }
    default: return "";
  }
}
