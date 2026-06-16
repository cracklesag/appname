// Generate the shared-agreement seed SQL from lib/agreements.ts.
//   npx tsx scripts/gen-agreements-seed.ts
// Paste the printed block into supabase/migrations/20260623_agreements.sql
// (between the INSERT header and `commit;`). Mirrors gen-crops-seed.ts.

import { AGREEMENT_SEEDS, type AgreementProfile } from '../lib/agreements';

function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
function sqlNum(n: number | null): string {
  return n == null ? 'null' : String(n);
}
function sqlBool(b: boolean): string {
  return b ? 'true' : 'false';
}
function sqlMaybe(s: string | null): string {
  return s == null ? 'null' : sqlStr(s);
}

const COLUMNS = [
  'user_id', 'seed_key', 'code', 'name', 'scheme', 'summary',
  'no_manufactured_fert', 'manufactured_n_cap_kg_ha', 'total_n_cap_kg_ha',
  'organic_manure_cap_t_ha', 'manure_cut_years_only', 'organic_n_field_cap_kg_ha',
  'no_phosphate', 'no_potash',
  'closed_cut_start_md', 'closed_cut_end_md', 'earliest_cut_md',
  'manufactured_n_closed_start_md', 'manufactured_n_closed_end_md',
  'livestock_exclusion_weeks_pre_cut', 'grazing_closed_start_md', 'grazing_closed_end_md',
  'max_stocking_lu_ha', 'no_supplementary_feeding', 'mineral_blocks_allowed',
  'min_ph', 'note', 'sort_order',
];

function rowValues(a: AgreementProfile): string {
  const v = [
    'null',                                   // user_id (shared seed)
    sqlStr(a.seedKey),
    sqlStr(a.code),
    sqlStr(a.name),
    sqlStr(a.scheme),
    sqlStr(a.summary),
    sqlBool(a.noManufacturedFert),
    sqlNum(a.manufacturedNCapKgHa),
    sqlNum(a.totalNCapKgHa),
    sqlNum(a.organicManureCapTHa),
    sqlBool(a.manureCutYearsOnly),
    sqlNum(a.organicNFieldCapKgHa),
    sqlBool(a.noPhosphate),
    sqlBool(a.noPotash),
    sqlMaybe(a.closedCutStartMd),
    sqlMaybe(a.closedCutEndMd),
    sqlMaybe(a.earliestCutMd),
    sqlMaybe(a.manufacturedNClosedStartMd),
    sqlMaybe(a.manufacturedNClosedEndMd),
    sqlNum(a.livestockExclusionWeeksPreCut),
    sqlMaybe(a.grazingClosedStartMd),
    sqlMaybe(a.grazingClosedEndMd),
    sqlNum(a.maxStockingLuHa),
    sqlBool(a.noSupplementaryFeeding),
    sqlBool(a.mineralBlocksAllowed),
    sqlNum(a.minPh),
    sqlMaybe(a.note),
    String(a.sortOrder),
  ];
  return `  (${v.join(', ')})`;
}

// ON CONFLICT (seed_key) DO UPDATE — re-running re-syncs every shared row.
const UPDATE_COLS = COLUMNS.filter((c) => c !== 'user_id' && c !== 'seed_key');

const out = [
  `insert into public.agreements`,
  `  (${COLUMNS.join(', ')})`,
  `values`,
  AGREEMENT_SEEDS.map(rowValues).join(',\n'),
  `on conflict (seed_key) do update set`,
  UPDATE_COLS.map((c) => `    ${c} = excluded.${c}`).join(',\n') + ';',
].join('\n');

console.log(out);
