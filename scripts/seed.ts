/**
 * Seed Mill Farm data for a single user.
 *
 * Usage:
 *   1. Sign in to the app once so you have a user account in Supabase.
 *   2. Get your user id from Supabase dashboard → Authentication → Users
 *   3. Put it in .env.local as SEED_USER_ID=<uuid>
 *   4. npm run seed
 *
 * Idempotent: re-running clears your existing fields/apps/cuts first.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const USER_ID = process.env.SEED_USER_ID;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!USER_ID) {
  console.error('Missing SEED_USER_ID in .env.local. Get it from Supabase → Authentication → Users.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type SeedField = {
  name: string; acres: number; ha: number; cutProfile: number;
  pH?: number; pIdx?: number; kIdx?: number; sampled: boolean; notes?: string;
};

const FIELDS: SeedField[] = [
  { name: "Wartons", acres: 8.1, ha: 3.3, cutProfile: 1, pH: 6.8, pIdx: 3.2, kIdx: 3.2, sampled: true, notes: "Driest field" },
  { name: "Norris'", acres: 19.5, ha: 7.9, cutProfile: 3, pH: 5.4, pIdx: 3.0, kIdx: 3.1, sampled: true, notes: "K at target" },
  { name: "Deer Park", acres: 26.5, ha: 10.7, cutProfile: 2, pH: 5.5, pIdx: 3.4, kIdx: 2.5, sampled: true, notes: "Limited winter slurry" },
  { name: "Nelsons Broadacre", acres: 20.4, ha: 8.3, cutProfile: 2, pH: 5.5, pIdx: 3.3, kIdx: 2.4, sampled: true, notes: "Limed Aut 2025" },
  { name: "Doll Hill Meadow", acres: 21.4, ha: 8.7, cutProfile: 3, pH: 5.3, pIdx: 3.9, kIdx: 2.2, sampled: true, notes: "Reseeded 2024" },
  { name: "13 Acre", acres: 13.0, ha: 5.3, cutProfile: 3, pH: 5.4, pIdx: 3.2, kIdx: 2.2, sampled: true },
  { name: "Broadacre", acres: 27.1, ha: 11.0, cutProfile: 2, pH: 5.9, pIdx: 3.3, kIdx: 2.1, sampled: true, notes: "Largest field" },
  { name: "1st Hill", acres: 9.5, ha: 3.8, cutProfile: 2, pH: 5.3, pIdx: 2.9, kIdx: 2.0, sampled: true },
  { name: "2nd Hill", acres: 6.4, ha: 2.6, cutProfile: 2, pH: 5.5, pIdx: 2.9, kIdx: 2.0, sampled: true },
  { name: "Big Meadow", acres: 10.3, ha: 4.2, cutProfile: 1, pH: 6.5, pIdx: 1.5, kIdx: 1.5, sampled: true, notes: "P+K deficient" },
  { name: "Low Meadows", acres: 10.8, ha: 4.4, cutProfile: 3, pH: 5.3, pIdx: 1.1, kIdx: 1.1, sampled: true, notes: "Worst P+K combo" },
  { name: "Redbank", acres: 6.9, ha: 2.8, cutProfile: 1, pH: 5.5, pIdx: 2.8, kIdx: 1.7, sampled: true, notes: "Limed Aut 2025" },
  { name: "Taylors", acres: 12.9, ha: 5.2, cutProfile: 3, pH: 5.4, pIdx: 4.0, kIdx: 2.6, sampled: true, notes: "Limed Aut 2025" },
  { name: "Hay Seeds", acres: 4.8, ha: 1.9, cutProfile: 1, sampled: false },
  { name: "Out Barn", acres: 8.9, ha: 3.6, cutProfile: 2, pH: 5.5, pIdx: 1.8, kIdx: 1.3, sampled: true, notes: "Wet — limited winter slurry" },
  { name: "Between Grids", acres: 9.4, ha: 3.8, cutProfile: 2, sampled: false },
  { name: "Top of Bog", acres: 13.3, ha: 5.4, cutProfile: 2, pH: 5.5, pIdx: 2.3, kIdx: 1.2, sampled: true, notes: "Wet — limited winter slurry" },
  { name: "Lindale Meadow", acres: 4.6, ha: 1.9, cutProfile: 3, sampled: false },
  { name: "Little Lindale M", acres: 2.1, ha: 0.9, cutProfile: 1, sampled: false },
  { name: "Grandads Paddock", acres: 1.9, ha: 0.8, cutProfile: 1, sampled: false },
  { name: "Chicken Huts", acres: 3.5, ha: 1.4, cutProfile: 1, sampled: false },
  { name: "Overtown Field", acres: 9.3, ha: 3.8, cutProfile: 3, pH: 5.1, pIdx: 2.8, kIdx: 2.1, sampled: true, notes: "Lowest pH" },
  { name: "Opp Chicken Huts", acres: 2.0, ha: 0.8, cutProfile: 1, sampled: false },
  { name: "Lane Side", acres: 1.7, ha: 0.7, cutProfile: 1, sampled: false },
  { name: "Doll Hill Wood Side", acres: 11.4, ha: 4.6, cutProfile: 1, sampled: false },
  { name: "Nelsons Hill", acres: 7.2, ha: 2.9, cutProfile: 1, sampled: false },
  { name: "Reedy's", acres: 6.3, ha: 2.5, cutProfile: 1, sampled: false },
  { name: "Goldridge", acres: 3.0, ha: 1.2, cutProfile: 1, sampled: false },
];

async function main() {
  console.log(`Seeding for user ${USER_ID}...`);

  // Wipe existing data for this user (idempotent)
  console.log('Clearing existing user data...');
  await supabase.from('applications').delete().eq('user_id', USER_ID!);
  await supabase.from('cuts').delete().eq('user_id', USER_ID!);
  await supabase.from('fields').delete().eq('user_id', USER_ID!);

  // Insert fields
  console.log(`Inserting ${FIELDS.length} fields...`);
  const fieldRows = FIELDS.map(f => ({
    user_id: USER_ID,
    name: f.name,
    acres: f.acres,
    ha: f.ha,
    cut_profile: f.cutProfile,
    planned_cuts: Array(f.cutProfile).fill('silage'),
    ph: f.pH ?? null,
    p_idx: f.pIdx ?? null,
    k_idx: f.kIdx ?? null,
    sampled: f.sampled,
    notes: f.notes ?? null,
  }));
  const { data: insertedFields, error: fErr } = await supabase
    .from('fields').insert(fieldRows).select('id, name');
  if (fErr) { console.error('Field insert failed:', fErr); process.exit(1); }
  console.log(`  ✓ ${insertedFields!.length} fields inserted`);

  const byName = Object.fromEntries(insertedFields!.map(f => [f.name, f.id]));

  // Historical applications from the handover
  const apps: any[] = [];

  // Every field got 2,000 gal/ac winter slurry on 15 Feb
  FIELDS.forEach(f => apps.push({
    user_id: USER_ID,
    field_id: byName[f.name],
    product_id: 4,
    date_applied: '2026-02-15',
    rate_value: 2000,
    rate_unit: 'gal/ac',
    method: 'splash_plate',
    notes: 'Winter slurry (pre-loaded from plan)',
    applied_by: 'plan',
  }));

  // Every field got 440 kg/ha of 25-5-5+S on 10 Mar
  FIELDS.forEach(f => apps.push({
    user_id: USER_ID,
    field_id: byName[f.name],
    product_id: 1,
    date_applied: '2026-03-10',
    rate_value: 440,
    rate_unit: 'kg/ha',
    method: null,
    notes: 'Spring compound (pre-loaded from plan)',
    applied_by: 'plan',
  }));

  // MOP applications already made
  const mop = [
    { fieldName: 'Doll Hill Meadow', rate: 67 },
    { fieldName: 'Doll Hill Wood Side', rate: 67 },
    { fieldName: 'Deer Park', rate: 45 },
    { fieldName: 'Redbank', rate: 45 },
    { fieldName: '1st Hill', rate: 45 },
    { fieldName: '2nd Hill', rate: 45 },
    { fieldName: 'Top of Bog', rate: 67 },
  ];
  mop.forEach(({ fieldName, rate }) => apps.push({
    user_id: USER_ID,
    field_id: byName[fieldName],
    product_id: 3,
    date_applied: '2026-03-20',
    rate_value: rate,
    rate_unit: 'kg/ha',
    method: null,
    notes: 'MOP (pre-loaded from plan)',
    applied_by: 'plan',
  }));

  // Autumn 2025 lime
  ['Nelsons Broadacre', 'Redbank', 'Taylors'].forEach(name => apps.push({
    user_id: USER_ID,
    field_id: byName[name],
    product_id: 5,
    date_applied: '2025-10-15',
    rate_value: 2,
    rate_unit: 't/ac',
    method: null,
    notes: 'Lime (pre-loaded from plan)',
    applied_by: 'plan',
  }));

  console.log(`Inserting ${apps.length} applications...`);
  const { error: aErr } = await supabase.from('applications').insert(apps);
  if (aErr) { console.error('Application insert failed:', aErr); process.exit(1); }
  console.log(`  ✓ ${apps.length} applications inserted`);

  console.log('\n✅ Seed complete. Open the app and you should see all 28 fields.');
}

main().catch(e => { console.error(e); process.exit(1); });
