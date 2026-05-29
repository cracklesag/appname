import { createClient } from './supabase/server';
import { Application, Cut, DEFAULT_SETTINGS, Field, GrassSystem, Group, Product, Settings } from './types';

export async function loadAllProducts(): Promise<Product[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('products').select('*').order('id');
  if (error) throw error;
  return data as Product[];
}

export async function loadFields(): Promise<Field[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('fields').select('*').order('name');
  if (error) throw error;
  return (data || []) as Field[];
}

export async function loadGroups(): Promise<Group[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('groups').select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as Group[];
}

/**
 * Load all grass systems visible to the current user — both shared seeds
 * (user_id IS NULL, returned by RLS) and the user's own custom rows.
 *
 * Sort order: shared seeds first (by their sort_order then name), then
 * user-owned custom rows alphabetically.
 */
export async function loadGrassSystems(): Promise<GrassSystem[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('grass_systems').select('*')
    .order('user_id', { ascending: true, nullsFirst: true })  // shared first
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as GrassSystem[];
}

export async function loadField(id: string): Promise<Field | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from('fields').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as Field | null;
}

export async function loadApplicationsForField(fieldId: string): Promise<Application[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('applications').select('*')
    .eq('field_id', fieldId)
    .order('date_applied', { ascending: false });
  if (error) throw error;
  return (data || []) as Application[];
}

export async function loadAllApplications(): Promise<Application[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('applications').select('*')
    .order('date_applied', { ascending: false });
  if (error) throw error;
  return (data || []) as Application[];
}

export async function loadCutsForField(fieldId: string): Promise<Cut[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('cuts').select('*').eq('field_id', fieldId)
    .order('cut_date', { ascending: false });
  if (error) throw error;
  return (data || []) as Cut[];
}

export async function loadAllCuts(): Promise<Cut[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('cuts').select('*').order('cut_date', { ascending: false });
  if (error) throw error;
  return (data || []) as Cut[];
}

export async function loadSettings(): Promise<Settings> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return DEFAULT_SETTINGS;

  // Resolve to the farm owner's settings: staff inherit their admin's farm
  // settings (units, targets, timing) rather than their own empty row. Falls
  // back to the user's own id if no membership (admin of their own farm).
  let ownerId = user.id;
  const { data: memberships } = await supabase
    .from('farm_members')
    .select('owner_id, role')
    .eq('member_id', user.id);
  if (memberships && memberships.length > 0) {
    const admin = memberships.find((m) => m.role === 'admin');
    ownerId = (admin ?? memberships[0]).owner_id as string;
  }

  const { data, error } = await supabase.from('settings').select('data').eq('user_id', ownerId).maybeSingle();
  if (error || !data) return DEFAULT_SETTINGS;
  const saved = (data.data || {}) as Partial<Settings>;
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    // Deep-merge nested objects so partial saves don't lose newly-added keys.
    reportDefaults: {
      ...DEFAULT_SETTINGS.reportDefaults,
      ...(saved.reportDefaults || {}),
    },
    timingDefaults: {
      ...DEFAULT_SETTINGS.timingDefaults,
      ...(saved.timingDefaults || {}),
    },
  };
  // For users whose settings predate the unitSystem field: infer from slurryUnit
  // (gal/ac is acres-style, m3/ha is hectares-style). Saved on first explicit
  // Settings save thereafter.
  if (!('unitSystem' in saved)) {
    merged.unitSystem = merged.slurryUnit === 'gal/ac' ? 'acres' : 'hectares';
  }
  return merged;
}

// ---------------------------------------------------------------------
// Multi-user farm: members + invites (Team screen)
// ---------------------------------------------------------------------

export interface FarmMemberRow {
  id: string;
  owner_id: string;
  member_id: string;
  role: 'admin' | 'staff';
  created_at: string;
}

export interface FarmInviteRow {
  id: string;
  owner_id: string;
  code: string;
  role: 'staff';
  label: string | null;
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
  used_by: string | null;
}

/** Load all members of the current admin's farm (RLS scopes to their farm). */
export async function loadFarmMembers(): Promise<FarmMemberRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('farm_members')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as FarmMemberRow[];
}

/** Load invites for the current admin's farm. */
export async function loadFarmInvites(): Promise<FarmInviteRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('farm_invites')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as FarmInviteRow[];
}

// ---------------------------------------------------------------------
// Product usage ranking (for the "most used first" product picker)
// ---------------------------------------------------------------------

/**
 * Returns a map of product_id -> times used (count of applications across the
 * farm). RLS scopes to the farm's applications. Used to rank the product
 * picker most-used-first.
 */
export async function loadProductUsage(): Promise<Record<number, number>> {
  const supabase = createClient();
  const { data, error } = await supabase.from('applications').select('product_id');
  if (error || !data) return {};
  const counts: Record<number, number> = {};
  for (const row of data) {
    const pid = (row as { product_id: number }).product_id;
    counts[pid] = (counts[pid] ?? 0) + 1;
  }
  return counts;
}
