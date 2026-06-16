// Generate the shared allocation-type seed SQL from lib/allocation_types.ts.
//   npx tsx scripts/gen-allocation-types-seed.ts
// Paste the printed block into supabase/migrations/20260625_allocation_types.sql.

import { ALLOCATION_TYPE_SEEDS, type AllocationTypeProfile } from '../lib/allocation_types';

const s = (x: string) => `'${x.replace(/'/g, "''")}'`;
const n = (x: number | null) => (x == null ? 'null' : String(x));
const b = (x: boolean) => (x ? 'true' : 'false');
const m = (x: string | null) => (x == null ? 'null' : s(x));

const COLUMNS = [
  'user_id', 'seed_key', 'label', 'kind', 'regime_default',
  'earliest_fert_md', 'n_cap_kg_per_ha', 'low_input', 'note', 'sort_order',
];

function row(a: AllocationTypeProfile): string {
  return `  (${[
    'null', s(a.seedKey), s(a.label), s(a.kind), s(a.regimeDefault),
    m(a.earliestFertMd), n(a.nCapKgPerHa), b(a.lowInput), m(a.note), String(a.sortOrder),
  ].join(', ')})`;
}

const UPDATE_COLS = COLUMNS.filter((c) => c !== 'user_id' && c !== 'seed_key');

console.log([
  'insert into public.allocation_types',
  `  (${COLUMNS.join(', ')})`,
  'values',
  ALLOCATION_TYPE_SEEDS.map(row).join(',\n'),
  'on conflict (seed_key) do update set',
  UPDATE_COLS.map((c) => `    ${c} = excluded.${c}`).join(',\n') + ';',
].join('\n'));
