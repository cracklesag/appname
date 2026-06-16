// =====================================================================
// Swardly · Allocation types — the middle grouping axis.
//
// How a field is *currently run*: Silage, Rotational grazing, Maintenance,
// Low input — plus user-built customs. One per field (a swappable FK), unlike
// agreements (many) and like blocks (one). Carries the advisory management
// params that used to live on the block profile: earliest-fert date, an N cap,
// a low-input flag, and what cuts default to.
//
// Design mirrors lib/crops.ts / lib/agreements.ts: shared SEED rows
// (user_id = null, stable seed_key) + user forks/customs (user_id set).
// Params are advisory — they feed warnings and the composed N cap, never the
// recommended numbers.
//
// Seed block in 20260625_allocation_types.sql is GENERATED from
// ALLOCATION_TYPE_SEEDS by scripts/gen-allocation-types-seed.ts.
// =====================================================================

export type AllocationKind = 'silage' | 'grazing' | 'maintenance' | 'low_input' | 'custom';

export const ALLOCATION_KIND_LABEL: Record<AllocationKind, string> = {
  silage: 'Silage',
  grazing: 'Grazing',
  maintenance: 'Maintenance',
  low_input: 'Low input',
  custom: 'Custom',
};

export interface AllocationTypeProfile {
  seedKey: string;
  label: string;
  kind: AllocationKind;
  /** What a fresh cut/round defaults to on this type. */
  regimeDefault: 'silage' | 'grazing';
  /** Earliest date fertiliser should go on (advisory), 'MM-DD'. */
  earliestFertMd: string | null;
  /** Advisory manufactured-N cap, kg N/ha. Null = no cap. */
  nCapKgPerHa: number | null;
  /** Low-input management flag (informational; pairs with the cap). */
  lowInput: boolean;
  /** Short note shown alongside the type. */
  note: string | null;
  sortOrder: number;
}

function t(p: AllocationTypeProfile): AllocationTypeProfile {
  return p;
}

// The four seeded types. Caps are left null by default — they're advisory and
// the user sets them to their own system; only Low input ships flagged.
export const ALLOCATION_TYPE_SEEDS: AllocationTypeProfile[] = [
  t({
    seedKey: 'silage', label: 'Silage', kind: 'silage', regimeDefault: 'silage',
    earliestFertMd: null, nCapKgPerHa: null, lowInput: false, sortOrder: 0,
    note: 'Cut for silage or hay. The implicit default elsewhere in the app.',
  }),
  t({
    seedKey: 'rotational', label: 'Rotational grazing', kind: 'grazing', regimeDefault: 'grazing',
    earliestFertMd: null, nCapKgPerHa: null, lowInput: false, sortOrder: 1,
    note: 'Grazed in rotation. New rounds default to grazing rather than a cut.',
  }),
  t({
    seedKey: 'maintenance', label: 'Maintenance', kind: 'maintenance', regimeDefault: 'grazing',
    earliestFertMd: null, nCapKgPerHa: null, lowInput: false, sortOrder: 2,
    note: 'Lightly managed / maintenance grazing — modest inputs.',
  }),
  t({
    seedKey: 'low_input', label: 'Low input', kind: 'low_input', regimeDefault: 'grazing',
    earliestFertMd: null, nCapKgPerHa: null, lowInput: true, sortOrder: 3,
    note: 'Minimise inputs. Set an N cap to flag dressings above it.',
  }),
];

// DB row shape (snake_case) — what loaders return; logic reads it structurally.
export interface AllocationTypeRow {
  id: string;
  user_id: string | null;
  seed_key: string | null;
  label: string;
  kind: AllocationKind;
  regime_default: 'silage' | 'grazing';
  earliest_fert_md: string | null;
  n_cap_kg_per_ha: number | null;
  low_input: boolean;
  note: string | null;
  sort_order: number;
  created_at?: string;
}

/** The advisory manufactured-N cap a type implies, or null if it sets none. */
export function allocationTypeNCap(ty: Pick<AllocationTypeRow, 'n_cap_kg_per_ha'> | null | undefined): number | null {
  if (!ty) return null;
  return ty.n_cap_kg_per_ha ?? null;
}
