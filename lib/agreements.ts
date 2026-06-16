// =====================================================================
// Swardly · Agri-environment agreements (SFI / Countryside Stewardship /
// Environmental Stewardship) and the restrictions they place on a field.
//
// This is the non-grass, non-crop knowledge base behind the third grouping
// axis. Design mirrors lib/crops.ts and lib/grass_systems exactly:
//   * shared SEED rows (user_id = null) with a stable seed_key, and
//   * user-owned forks / customs (user_id set, seed_key null).
// A field links to AGREEMENTS many-to-many (public.field_agreements), unlike
// blocks/types which are one-per-field — a parcel can sit in several schemes.
//
// Every agreement carries an OPTIONAL restriction block (caps, cutting-date
// windows, grazing/livestock limits). All advisory: they feed warnings and the
// composed N cap, they never change a recommended number or hard-block a save.
//
// NVZ is deliberately NOT seeded here. It is statutory (binds regardless of any
// agreement) and tangles into the spreading engine — modelled separately later.
// The restriction *fields* it would use (organic-N field cap, manufactured-N
// closed period) exist below so a custom agreement can still use them.
//
// The seed block in supabase/migrations/20260623_agreements.sql is GENERATED
// from AGREEMENT_SEEDS by scripts/gen-agreements-seed.ts — do not hand-edit it.
// =====================================================================

export type AgreementScheme = 'sfi' | 'cs' | 'es' | 'custom';

export const SCHEME_LABEL: Record<AgreementScheme, string> = {
  sfi: 'SFI',
  cs: 'Countryside Stewardship',
  es: 'Environmental Stewardship',
  custom: 'Custom',
};

/**
 * The optional restriction block. Every field is nullable / false by default —
 * an agreement sets only what actually applies to it. Month-day fields are
 * 'MM-DD' text so they repeat yearly, matching groups.earliest_fert_md.
 */
export interface AgreementRestrictions {
  // --- Nutrient caps (advisory) -------------------------------------
  /** No manufactured/inorganic fertiliser at all (≡ a manufactured-N cap of 0). */
  noManufacturedFert: boolean;
  /** Manufactured (inorganic) N cap, kg N/ha/yr. e.g. herbal leys ~40. */
  manufacturedNCapKgHa: number | null;
  /** Total N cap (manufactured + crop-available organic), kg N/ha/yr. */
  totalNCapKgHa: number | null;
  /** Organic manure / FYM cap, t/ha/yr. e.g. CS species-rich = 12. */
  organicManureCapTHa: number | null;
  /** FYM only allowed in years the parcel is cut (pairs with the cap). */
  manureCutYearsOnly: boolean;
  /** Organic-N field cap, kg N/ha/yr (the NVZ-style 250 field limit). */
  organicNFieldCapKgHa: number | null;
  /** No phosphate may be applied. */
  noPhosphate: boolean;
  /** No potash may be applied. */
  noPotash: boolean;

  // --- Cutting / timing windows ('MM-DD') ---------------------------
  /** No mechanical cutting between these dates (e.g. 03-15 .. 06-30). */
  closedCutStartMd: string | null;
  closedCutEndMd: string | null;
  /** No cut before this date (late-hay supplements). */
  earliestCutMd: string | null;
  /** Manufactured-N closed period (NVZ-style 09-15 .. 01-15). */
  manufacturedNClosedStartMd: string | null;
  manufacturedNClosedEndMd: string | null;

  // --- Grazing / livestock ------------------------------------------
  /** Exclude livestock this many weeks before a cut (e.g. 7). */
  livestockExclusionWeeksPreCut: number | null;
  /** Grazing closed period (seasonal livestock removal). */
  grazingClosedStartMd: string | null;
  grazingClosedEndMd: string | null;
  /** Stocking-density cap, livestock units/ha. */
  maxStockingLuHa: number | null;
  /** No supplementary feeding on the parcel. */
  noSupplementaryFeeding: boolean;
  /** Mineral blocks still allowed despite the no-feeding rule. */
  mineralBlocksAllowed: boolean;

  // --- Other --------------------------------------------------------
  /** Maintain soil pH at or above this by liming (e.g. 5.4). */
  minPh: number | null;
  /** Free-text catch-all for anything not modelled above. */
  note: string | null;
}

export interface AgreementProfile extends AgreementRestrictions {
  /** Stable key for the shared seed (null for user customs in the DB). */
  seedKey: string;
  /** Scheme code as it appears on the agreement, e.g. 'SAM3', 'GS6'. */
  code: string;
  name: string;
  scheme: AgreementScheme;
  /** One-line plain-English description shown in pickers. */
  summary: string;
  sortOrder: number;
}

/** Restriction-block defaults so seeds only specify what differs. */
const NONE: AgreementRestrictions = {
  noManufacturedFert: false,
  manufacturedNCapKgHa: null,
  totalNCapKgHa: null,
  organicManureCapTHa: null,
  manureCutYearsOnly: false,
  organicNFieldCapKgHa: null,
  noPhosphate: false,
  noPotash: false,
  closedCutStartMd: null,
  closedCutEndMd: null,
  earliestCutMd: null,
  manufacturedNClosedStartMd: null,
  manufacturedNClosedEndMd: null,
  livestockExclusionWeeksPreCut: null,
  grazingClosedStartMd: null,
  grazingClosedEndMd: null,
  maxStockingLuHa: null,
  noSupplementaryFeeding: false,
  mineralBlocksAllowed: false,
  minPh: null,
  note: null,
};

function seed(p: Partial<AgreementProfile> & Pick<AgreementProfile, 'seedKey' | 'code' | 'name' | 'scheme' | 'summary' | 'sortOrder'>): AgreementProfile {
  return { ...NONE, ...p };
}

// ---------------------------------------------------------------------
// The seed catalogue — grassland + livestock-relevant options across the
// three English schemes. Stored values are the KNOWN restrictions from
// scheme guidance; softer / agreement-specific conditions live in `note`,
// and every value is user-editable after seeding. NVZ is excluded.
//
// Caveat baked into the data: SFI figures (esp. the herbal-ley ~40 kg N)
// are the *typical* published guidance, not always an exact contractual
// number — they seed as an editable advisory default.
// ---------------------------------------------------------------------
export const AGREEMENT_SEEDS: AgreementProfile[] = [
  // ---- SFI ----
  seed({
    seedKey: 'sfi_sam3', code: 'SAM3', name: 'Herbal leys', scheme: 'sfi', sortOrder: 0,
    summary: 'Grass/legume/herb ley; minimise inorganic N (~40 kg N/ha typical). Also CSAM3 under SFI24.',
    manufacturedNCapKgHa: 40,
    note: 'No pesticides on the established ley (spot-treatment of weeds aside). The ~40 kg N is typical guidance — set to your agreement.',
  }),
  seed({
    seedKey: 'sfi_lig1', code: 'LIG1', name: 'Low-input grassland (outside SDA)', scheme: 'sfi', sortOrder: 1,
    summary: 'Very low nutrient inputs on improved grassland; supplementary feeding allowed.',
    note: 'No fixed N figure — "very low inputs". Supplementary feeding is permitted (unlike CS GS2).',
  }),
  seed({
    seedKey: 'sfi_lig2', code: 'LIG2', name: 'Low-input grassland (SDA)', scheme: 'sfi', sortOrder: 2,
    summary: 'As LIG1, for grassland within Severely Disadvantaged Areas.',
    note: 'No fixed N figure — "very low inputs". Supplementary feeding permitted.',
  }),
  seed({
    seedKey: 'sfi_num3', code: 'NUM3', name: 'Legume fallow', scheme: 'sfi', sortOrder: 3,
    summary: 'Sown legume fallow; static (maintain the same area each year). No fertiliser.',
    noManufacturedFert: true,
    note: 'Rotational-fallow equivalent of CS AB15, but static under SFI.',
  }),

  // ---- Countryside Stewardship ----
  seed({
    seedKey: 'cs_gs2', code: 'GS2', name: 'Permanent grassland, very low inputs (outside SDA)', scheme: 'cs', sortOrder: 10,
    summary: 'Restricted fertiliser; FYM ≤12 t/ha; maintain pH ≥5.4 by liming.',
    organicManureCapTHa: 12, minPh: 5.4,
    note: 'Fertiliser as an alternative to FYM is restricted and must not be increased above the existing low rate. Sward-height management applies.',
  }),
  seed({
    seedKey: 'cs_gs5', code: 'GS5', name: 'Permanent grassland, very low inputs (SDA)', scheme: 'cs', sortOrder: 11,
    summary: 'As GS2, for grassland within Severely Disadvantaged Areas.',
    organicManureCapTHa: 12, minPh: 5.4,
    note: 'Fertiliser restricted; sward-height management applies.',
  }),
  seed({
    seedKey: 'cs_gs4', code: 'GS4', name: 'Legume and herb-rich swards', scheme: 'cs', sortOrder: 12,
    summary: 'Mixed legume/herb sward; restricts artificial nitrogen; no pesticides.',
    note: 'Restricts artificial N (the CS equivalent of SFI herbal leys). Must follow a recommended fertiliser/nutrient management system.',
  }),
  seed({
    seedKey: 'cs_gs6', code: 'GS6', name: 'Management of species-rich grassland', scheme: 'cs', sortOrder: 13,
    summary: 'No inorganic fertiliser; no cut 15 Mar–30 Jun; exclude stock 7 wks pre-cut; FYM ≤12 t/ha cut years only; no supp. feed except mineral blocks.',
    noManufacturedFert: true,
    organicManureCapTHa: 12, manureCutYearsOnly: true,
    closedCutStartMd: '03-15', closedCutEndMd: '06-30',
    livestockExclusionWeeksPreCut: 7,
    noSupplementaryFeeding: true, mineralBlocksAllowed: true,
    note: 'Priority-habitat grassland (must be mapped). Control dense rush below 20% cover by 30 Sep.',
  }),
  seed({
    seedKey: 'cs_gs7', code: 'GS7', name: 'Restoration towards species-rich grassland', scheme: 'cs', sortOrder: 14,
    summary: 'Very little or no manure, fertiliser, pesticide or supplementary feed.',
    noManufacturedFert: true,
    noSupplementaryFeeding: true, mineralBlocksAllowed: true,
    note: 'Restoration timetable agreed with Natural England; may introduce new species.',
  }),
  seed({
    seedKey: 'cs_gs8', code: 'GS8', name: 'Creation of species-rich grassland', scheme: 'cs', sortOrder: 15,
    summary: 'Sward creation on low-fertility land; minimal inputs, low soil P required.',
    noManufacturedFert: true,
    note: 'Feasible only where soil fertility (especially available P) is low. Establish by regeneration or an approved seed mix.',
  }),
  seed({
    seedKey: 'cs_sw9', code: 'SW9', name: 'Seasonal livestock removal on intensive grassland', scheme: 'cs', sortOrder: 16,
    summary: 'Remove livestock over winter (~5.5 consecutive months).',
    grazingClosedStartMd: '11-01', grazingClosedEndMd: '04-15',
    note: 'The ~5.5-month winter window is a seeded default — set the exact dates to your agreement.',
  }),

  // ---- SFI26 (current offer) ----
  seed({
    seedKey: 'sfi_wbd6', code: 'WBD6', name: 'Remove livestock from intensive grassland (autumn & winter, outside SDA)', scheme: 'sfi', sortOrder: 20,
    summary: 'No grazing over the autumn/winter period on intensive grassland.',
    grazingClosedStartMd: '10-01', grazingClosedEndMd: '03-31',
    note: 'SFI26 action. WBD7 is the equivalent within SDAs. Set the exact window to your agreement.',
  }),

  // ---- Environmental Stewardship (legacy ELS/HLS still held) ----
  seed({
    seedKey: 'es_ek3', code: 'EK3', name: 'Permanent grassland with very low inputs (ELS, legacy)', scheme: 'es', sortOrder: 30,
    summary: 'Legacy ELS option — permanent grassland managed with very low inputs.',
    note: 'Older Entry Level Stewardship agreement. Low fertiliser/spray inputs; check your agreement document for the exact limits.',
  }),
  seed({
    seedKey: 'es_hk6', code: 'HK6', name: 'Maintenance of species-rich, semi-natural grassland (HLS, legacy)', scheme: 'es', sortOrder: 31,
    summary: 'Legacy HLS option — low fertility, sward managed by grazing/cutting to height targets.',
    noManufacturedFert: true,
    note: 'Older Higher Level Stewardship agreement. Sward-height management (often ~2–10 cm by autumn); no new drainage. HK7/HK8 are the restoration/creation variants.',
  }),
];

// =====================================================================
// DB row shape (snake_case) — what loaders return. The restriction logic
// below operates structurally on this shape so it needs no mapping.
// =====================================================================
export interface AgreementRow {
  id: string;
  user_id: string | null;
  seed_key: string | null;
  code: string;
  name: string;
  scheme: AgreementScheme;
  summary: string;
  no_manufactured_fert: boolean;
  manufactured_n_cap_kg_ha: number | null;
  total_n_cap_kg_ha: number | null;
  organic_manure_cap_t_ha: number | null;
  manure_cut_years_only: boolean;
  organic_n_field_cap_kg_ha: number | null;
  no_phosphate: boolean;
  no_potash: boolean;
  closed_cut_start_md: string | null;
  closed_cut_end_md: string | null;
  earliest_cut_md: string | null;
  manufactured_n_closed_start_md: string | null;
  manufactured_n_closed_end_md: string | null;
  livestock_exclusion_weeks_pre_cut: number | null;
  grazing_closed_start_md: string | null;
  grazing_closed_end_md: string | null;
  max_stocking_lu_ha: number | null;
  no_supplementary_feeding: boolean;
  mineral_blocks_allowed: boolean;
  min_ph: number | null;
  note: string | null;
  sort_order: number;
  created_at?: string;
}

// =====================================================================
// Cap composition — the "most-restrictive wins, labelled with what imposed
// it" rule from the groupings design. Advisory only.
// =====================================================================

/** A resolved N cap and the human label of whatever imposed it. */
export interface NCapSource {
  capKgHa: number;
  /** e.g. "GS6" / "Low input type" — shown as "capped by GS6". */
  source: string;
}

/** Minimal shape the cap reader needs — works on AgreementRow or a partial. */
export interface AgreementNCapInput {
  name?: string;
  code?: string;
  no_manufactured_fert?: boolean | null;
  manufactured_n_cap_kg_ha?: number | null;
}

/** The manufactured-N cap an agreement implies, or null if it sets none. */
export function agreementNCap(a: AgreementNCapInput): number | null {
  if (a.no_manufactured_fert) return 0;
  if (a.manufactured_n_cap_kg_ha != null) return a.manufactured_n_cap_kg_ha;
  return null;
}

/** Best (shortest, most distinctive) label for an agreement in a cap note. */
function agreementLabel(a: AgreementNCapInput): string {
  return a.code || a.name || 'an agreement';
}

/**
 * Compose a field's advisory manufactured-N cap from a baseline (the
 * allocation type's or block's own cap, already labelled) and the field's
 * agreements. Returns the single most restrictive cap with its source, or
 * null if nothing caps N. A cap of 0 (no-fertiliser) wins outright.
 *
 * Ties keep the incumbent — the baseline/type is reported in preference to an
 * equally-tight agreement, which reads more naturally ("capped by Low input"
 * rather than flipping to whichever agreement happened to match).
 */
export function mostRestrictiveNCap(
  baseline: NCapSource | null,
  agreements: AgreementNCapInput[],
): NCapSource | null {
  let best: NCapSource | null = baseline;
  for (const a of agreements) {
    const cap = agreementNCap(a);
    if (cap == null) continue;
    if (best == null || cap < best.capKgHa) {
      best = { capKgHa: cap, source: agreementLabel(a) };
    }
  }
  return best;
}

// =====================================================================
// Restriction summary — flattens an agreement's active restrictions into a
// short list for chips / the plan warning surface. Empty list = nothing set.
// =====================================================================

export type RestrictionKind =
  | 'no_fert' | 'n_cap' | 'total_n_cap' | 'manure_cap' | 'organic_n_field_cap'
  | 'no_p' | 'no_k' | 'closed_cut' | 'earliest_cut' | 'man_n_closed'
  | 'stock_exclusion' | 'grazing_closed' | 'stocking_cap' | 'no_feed' | 'min_ph';

export interface ActiveRestriction {
  kind: RestrictionKind;
  /** Short chip label, e.g. "≤40 kg N/ha" or "No inorganic fert". */
  label: string;
}

function mdLabel(md: string): string {
  const [m, d] = md.split('-').map((x) => parseInt(x, 10));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!m || !d || m < 1 || m > 12) return md;
  return `${d} ${months[m - 1]}`;
}

/** Active restrictions on an agreement row, ordered roughly nutrient→timing→stock. */
export function summariseRestrictions(a: AgreementRow): ActiveRestriction[] {
  const out: ActiveRestriction[] = [];
  if (a.no_manufactured_fert) out.push({ kind: 'no_fert', label: 'No inorganic fert' });
  else if (a.manufactured_n_cap_kg_ha != null) out.push({ kind: 'n_cap', label: `≤${a.manufactured_n_cap_kg_ha} kg N/ha` });
  if (a.total_n_cap_kg_ha != null) out.push({ kind: 'total_n_cap', label: `≤${a.total_n_cap_kg_ha} kg total N/ha` });
  if (a.organic_manure_cap_t_ha != null) {
    out.push({ kind: 'manure_cap', label: `FYM ≤${a.organic_manure_cap_t_ha} t/ha${a.manure_cut_years_only ? ' (cut yrs)' : ''}` });
  }
  if (a.organic_n_field_cap_kg_ha != null) out.push({ kind: 'organic_n_field_cap', label: `Organic N ≤${a.organic_n_field_cap_kg_ha} kg/ha` });
  if (a.no_phosphate) out.push({ kind: 'no_p', label: 'No P' });
  if (a.no_potash) out.push({ kind: 'no_k', label: 'No K' });
  if (a.closed_cut_start_md && a.closed_cut_end_md) {
    out.push({ kind: 'closed_cut', label: `No cut ${mdLabel(a.closed_cut_start_md)}–${mdLabel(a.closed_cut_end_md)}` });
  }
  if (a.earliest_cut_md) out.push({ kind: 'earliest_cut', label: `No cut before ${mdLabel(a.earliest_cut_md)}` });
  if (a.manufactured_n_closed_start_md && a.manufactured_n_closed_end_md) {
    out.push({ kind: 'man_n_closed', label: `No N ${mdLabel(a.manufactured_n_closed_start_md)}–${mdLabel(a.manufactured_n_closed_end_md)}` });
  }
  if (a.livestock_exclusion_weeks_pre_cut != null) out.push({ kind: 'stock_exclusion', label: `Stock off ${a.livestock_exclusion_weeks_pre_cut} wk pre-cut` });
  if (a.grazing_closed_start_md && a.grazing_closed_end_md) {
    out.push({ kind: 'grazing_closed', label: `No graze ${mdLabel(a.grazing_closed_start_md)}–${mdLabel(a.grazing_closed_end_md)}` });
  }
  if (a.max_stocking_lu_ha != null) out.push({ kind: 'stocking_cap', label: `≤${a.max_stocking_lu_ha} LU/ha` });
  if (a.no_supplementary_feeding) out.push({ kind: 'no_feed', label: a.mineral_blocks_allowed ? 'No supp. feed (blocks ok)' : 'No supp. feed' });
  if (a.min_ph != null) out.push({ kind: 'min_ph', label: `Lime to pH ${a.min_ph}` });
  return out;
}
