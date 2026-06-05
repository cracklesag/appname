// GET /api/account/export
// Streams a JSON file containing all of the signed-in user's farm data —
// fields, cuts, fertiliser/slurry/manure/lime records, products, groups,
// grass systems, soil and settings — for the farm they're currently working
// in (their resolved farm context). A "download my data" / portability tool.
//
// Auth + scope: uses the normal RLS-scoped server client. Post-migration RLS
// (20260529_farm_roles) lets any farm member READ rows owned by the farm
// owner, so this returns exactly what the user is entitled to see. Every query
// is additionally filtered to the resolved owner id, so a user who belongs to
// more than one farm only exports the farm they're currently in.
//
// Shared catalogue rows (built-in products / grass systems, user_id IS NULL)
// are app defaults and are intentionally NOT included — only the farm's own
// custom rows are. Each table is best-effort: if one can't be read (e.g. a
// deferred feature's table isn't present yet) it's skipped and listed under
// `skipped` rather than failing the whole export.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFarmContext } from '@/lib/farm';

export const dynamic = 'force-dynamic';

interface TableSpec {
  /** Key in the output `data` object. */
  key: string;
  /** Table name in public schema. */
  table: string;
  /** Column to scope by: most tables use user_id; roster/invite tables use owner_id. */
  column: 'user_id' | 'owner_id';
  /** Single-row tables (PK = user_id) are unwrapped to an object instead of an array. */
  single?: boolean;
}

// Order is for human readability of the file; it has no functional effect.
const TABLES: TableSpec[] = [
  { key: 'settings', table: 'settings', column: 'user_id', single: true },
  { key: 'map_settings', table: 'map_settings', column: 'user_id', single: true },
  { key: 'fields', table: 'fields', column: 'user_id' },
  { key: 'groups', table: 'groups', column: 'user_id' },
  { key: 'grass_systems', table: 'grass_systems', column: 'user_id' },
  { key: 'products', table: 'products', column: 'user_id' },
  { key: 'applications', table: 'applications', column: 'user_id' },
  { key: 'application_areas', table: 'application_areas', column: 'user_id' },
  { key: 'cuts', table: 'cuts', column: 'user_id' },
  { key: 'grazing_events', table: 'grazing_events', column: 'user_id' },
  { key: 'plate_readings', table: 'plate_readings', column: 'user_id' },
  { key: 'farm_members', table: 'farm_members', column: 'owner_id' },
  { key: 'farm_invites', table: 'farm_invites', column: 'owner_id' },
  { key: 'feature_requests', table: 'feature_requests', column: 'owner_id' },
  // Deferred soil-report ingestion (schema may be live, feature not yet shipped).
  { key: 'documents', table: 'documents', column: 'user_id' },
  { key: 'soil_samples', table: 'soil_samples', column: 'user_id' },
];

export async function GET() {
  const ctx = await getFarmContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const ownerId = ctx.ownerId;

  const data: Record<string, unknown> = {};
  const skipped: string[] = [];

  for (const spec of TABLES) {
    const { data: rows, error } = await supabase
      .from(spec.table)
      .select('*')
      .eq(spec.column, ownerId);
    if (error) {
      skipped.push(spec.table);
      continue;
    }
    data[spec.key] = spec.single ? (rows && rows.length ? rows[0] : null) : (rows ?? []);
  }

  // The user's own farm memberships (which farms they belong to, and their
  // role on each) — part of "their" account data regardless of resolved farm.
  let memberships: unknown[] = [];
  {
    const { data: rows } = await supabase
      .from('farm_members')
      .select('owner_id, role, created_at')
      .eq('member_id', ctx.userId);
    memberships = rows ?? [];
  }

  const payload = {
    export: {
      app: 'Swardly',
      format_version: 1,
      exported_at: new Date().toISOString(),
      account: {
        user_id: ctx.userId,
        email: userData?.user?.email ?? null,
        account_created_at: userData?.user?.created_at ?? null,
        role: ctx.role,
        is_admin: ctx.isAdmin,
        farm_owner_id: ownerId,
        memberships,
      },
      note:
        'Contains the data for the farm you are currently working in. Built-in ' +
        'catalogue products and grass systems (shared app defaults) are not ' +
        'included — only your farm\u2019s own custom rows are.',
    },
    data,
    ...(skipped.length ? { skipped } : {}),
  };

  const filename = `swardly-export-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
