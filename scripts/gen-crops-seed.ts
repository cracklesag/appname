/**
 * Emits the `public.crops` catalogue seed as SQL, straight from CROP_PROFILES in
 * lib/crops.ts — so the shared seed rows can never drift from the code. The
 * output is pasted into supabase/migrations/20260621_crops.sql and is
 * re-runnable: ON CONFLICT (seed_key) DO UPDATE re-syncs every shared row.
 *
 *   npx tsx scripts/gen-crops-seed.ts > /tmp/crops_seed.sql
 */
import { CROP_PROFILES } from '../lib/crops';

const q = (s: string | null | undefined): string =>
  s == null ? 'null' : `'${s.replace(/'/g, "''")}'`;
const j = (v: unknown): string =>
  v == null ? 'null' : `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
const n = (v: number | null | undefined): string => (v == null ? 'null' : String(v));
const b = (v: boolean | undefined): string => (v ? 'true' : 'false');

const COLS = [
  'user_id', 'seed_key', 'label', 'category', 'yield_default', 'yield_unit', 'yield_range',
  'offtake', 'total_n', 'n_target_kg_per_ha', 'pk_regime', 'n_stages', 'target_ph', 'ph_note',
  'soil_fit', 'manure_fit', 'needs_mg', 'needs_na', 'needs_s', 'sulphur_note', 'micros',
  'family', 'k_lift_top_up_note', 'evidence', 'sources', 'summary', 'sort_order',
];

const rows = CROP_PROFILES.map((c, i) => {
  const vals = [
    'null',                 // user_id — shared seed
    q(c.key),               // seed_key
    q(c.label),
    q(c.category),
    n(c.yieldDefault),
    q(c.yieldUnit),
    q(c.yieldRange),
    j(c.offtake),
    q(c.totalN),
    n(c.nTargetKgPerHa),
    q(c.pkRegime),
    j(c.nStages),
    n(c.targetPh),
    q(c.phNote ?? null),
    q(c.soilFit),
    q(c.manureFit),
    b(c.needsMg),
    b(c.needsNa),
    b(c.needsS),
    q(c.sulphurNote ?? null),
    j(c.micros ?? null),
    q(c.family ?? null),
    q(c.kLiftTopUpNote ?? null),
    q(c.evidence),
    q(c.sources),
    q(c.summary),
    String(i),              // sort_order
  ];
  return `  (${vals.join(', ')})`;
});

const updateAssignments = COLS
  .filter((col) => col !== 'user_id' && col !== 'seed_key')
  .map((col) => `    ${col} = excluded.${col}`)
  .join(',\n');

const sql =
  `insert into public.crops\n  (${COLS.join(', ')})\nvalues\n${rows.join(',\n')}\non conflict (seed_key) do update set\n${updateAssignments};`;

process.stdout.write(sql + '\n');
