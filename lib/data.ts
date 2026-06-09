import { createClient } from './supabase/server';
import { Application, ApplicationArea, Cut, DEFAULT_SETTINGS, Field, FieldEvent, GrassSystem, Group, GrazingEvent, PlateReading, Product, ProductAnalysis, Settings, SoilSample, SprayRecord, SprayProduct, SprayPurchase, Job, JobField, ContractorProfile, FarmContractor } from './types';

export async function loadAllProducts(): Promise<Product[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('products').select('*').order('id');
  if (error) throw error;
  const products = (data as Product[]) ?? [];

  // Attach dated analysis history so each application can be valued using the
  // version effective on its date (see lib/rules.ts:effectiveProductOn).
  const { data: analyses } = await supabase
    .from('product_analyses')
    .select('*')
    .order('effective_from', { ascending: true });
  if (analyses && analyses.length) {
    const byProduct = new Map<number, ProductAnalysis[]>();
    for (const a of analyses as ProductAnalysis[]) {
      const list = byProduct.get(a.product_id);
      if (list) list.push(a);
      else byProduct.set(a.product_id, [a]);
    }
    for (const p of products) {
      const list = byProduct.get(p.id);
      if (list) p.analyses = list;
    }
  }
  return products;
}

export async function loadProduct(id: number): Promise<Product | null> {
  const supabase = createClient();
  const { data } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
  return (data as Product | null) ?? null;
}

export async function loadProductAnalyses(productId: number): Promise<ProductAnalysis[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('product_analyses')
    .select('*')
    .eq('product_id', productId)
    .order('effective_from', { ascending: false });
  return (data as ProductAnalysis[]) ?? [];
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

export async function loadFieldEvents(fieldId: string): Promise<FieldEvent[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('field_events').select('*').eq('field_id', fieldId)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false });
  // Degrade to empty rather than break the field page if the migration
  // hasn't been applied yet (table missing).
  if (error) return [];
  return (data || []) as FieldEvent[];
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

  // Resolve which farm's settings to load. A user can be admin of their own
  // (auto-created) farm AND staff on someone else's. If their own farm has
  // never been set up, prefer the farm they're staff on — otherwise they'd see
  // an empty shell and get bounced to /welcome. Mirrors getFarmContext().
  let ownerId = user.id;
  let isStaff = false;
  const { data: memberships } = await supabase
    .from('farm_members')
    .select('owner_id, role')
    .eq('member_id', user.id);

  if (memberships && memberships.length > 0) {
    const adminM = memberships.find((m) => m.role === 'admin');
    const staffM = memberships.find((m) => m.role === 'staff');

    if (adminM && staffM) {
      // Keep the own (admin) farm only if it's actually been onboarded.
      const { data: ownSettings } = await supabase
        .from('settings')
        .select('data')
        .eq('user_id', adminM.owner_id as string)
        .maybeSingle();
      const ownOnboarded = !!(ownSettings?.data as { onboarded?: boolean } | null)?.onboarded;
      if (ownOnboarded) {
        ownerId = adminM.owner_id as string;
      } else {
        ownerId = staffM.owner_id as string;
        isStaff = true;
      }
    } else if (adminM) {
      ownerId = adminM.owner_id as string;
    } else {
      ownerId = memberships[0].owner_id as string;
      isStaff = true;
    }
  }

  const { data, error } = await supabase.from('settings').select('data').eq('user_id', ownerId).maybeSingle();
  if (error || !data) {
    // A staff member has joined a farm and is past onboarding by definition —
    // never bounce them to /welcome even if the admin's settings row is
    // momentarily unreadable (e.g. read-after-write right after joining).
    return isStaff ? { ...DEFAULT_SETTINGS, onboarded: true } : DEFAULT_SETTINGS;
  }
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
  // Staff are onboarded by virtue of belonging to a farm — the unit-picker
  // welcome is an admin-only, first-run step. Guard against the (rare) case of
  // an admin whose own settings somehow lack the flag.
  if (isStaff) merged.onboarded = true;
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
  if (error) return [];
  return (data || []) as FarmMemberRow[];
}

/** Load invites for the current admin's farm. */
export async function loadFarmInvites(): Promise<FarmInviteRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('farm_invites')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return [];
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

/** All plate-meter readings for the farm, newest first. RLS scopes to the
 *  member's farm. Returns [] if the table doesn't exist yet (pre-migration). */
export async function loadPlateReadings(): Promise<PlateReading[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('plate_readings')
    .select('*')
    .order('reading_date', { ascending: false });
  if (error) return [];
  return (data || []) as PlateReading[];
}

/** All grazing events for the farm, newest first. [] if table absent. */
export async function loadGrazingEvents(): Promise<GrazingEvent[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('grazing_events')
    .select('*')
    .order('graze_date', { ascending: false });
  if (error) return [];
  return (data || []) as GrazingEvent[];
}

/** Drawn sub-areas of partial applications for one field (oldest first).
 *  Returns [] if the table doesn't exist yet (pre-migration). RLS scopes to
 *  the member's farm. */
export async function loadApplicationAreasForField(fieldId: string): Promise<ApplicationArea[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('application_areas')
    .select('*')
    .eq('field_id', fieldId)
    .order('created_at', { ascending: true });
  if (error) return [];
  return (data || []) as ApplicationArea[];
}

/** All drawn sub-areas for the farm. [] if table absent. */
export async function loadAllApplicationAreas(): Promise<ApplicationArea[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('application_areas')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) return [];
  return (data || []) as ApplicationArea[];
}


export async function loadFieldSoilSamples(fieldId: string): Promise<SoilSample[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_field_soil_samples', { p_field_id: fieldId });
  if (error) {
    // Function may not be deployed yet — degrade to an empty history rather
    // than throwing (the view shows a friendly empty state).
    console.error('loadFieldSoilSamples:', error.message);
    return [];
  }
  return (data ?? []) as SoilSample[];
}


export async function loadSprayRecords(): Promise<SprayRecord[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('spray_records')
    .select('*')
    .order('date_applied', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) {
    // Table may not exist yet (migration not run) — degrade gracefully.
    return [];
  }
  return (data as SprayRecord[]) ?? [];
}

export async function loadSprayRecordsForField(fieldId: string): Promise<SprayRecord[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('spray_records')
    .select('*')
    .eq('field_id', fieldId)
    .order('date_applied', { ascending: false });
  return (data as SprayRecord[]) ?? [];
}


export async function loadSprayProducts(): Promise<SprayProduct[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('spray_products').select('*').order('name');
  if (error) return [];
  return (data as SprayProduct[]) ?? [];
}

export async function loadSprayPurchases(): Promise<SprayPurchase[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('spray_purchases')
    .select('*')
    .order('purchase_date', { ascending: false });
  if (error) return [];
  return (data as SprayPurchase[]) ?? [];
}


export async function loadJobs(): Promise<Job[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
  if (error) return [];
  return (data as Job[]) ?? [];
}

export async function loadJob(id: string): Promise<{ job: Job; fields: JobField[] } | null> {
  const supabase = createClient();
  const { data: job, error } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle();
  if (error || !job) return null;
  const { data: fields } = await supabase
    .from('job_fields').select('*').eq('job_id', id).order('sort_order');
  return { job: job as Job, fields: (fields as JobField[]) ?? [] };
}


export async function loadMyContractorProfile(): Promise<ContractorProfile | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('contractor_profiles').select('*').eq('user_id', user.id).maybeSingle();
  return (data as ContractorProfile) ?? null;
}

export async function loadFarmContractors(): Promise<FarmContractor[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('farm_contractors').select('*').order('created_at', { ascending: true });
  if (error) return [];
  return (data as FarmContractor[]) ?? [];
}

export interface TimesheetJob {
  id: string;
  title: string;
  job_type: string;
  farm_name: string | null;
  status: string;
  work_minutes: number | null;
  work_started_at: string | null;
  work_date: string; // ISO — best estimate of when the work happened
  area_done_ha: number;
  field_count: number;
}

// Jobs this user actually worked (assigned to them, or forwarded to them).
export async function loadTimesheetJobs(): Promise<TimesheetJob[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, title, job_type, farm_name, status, work_minutes, work_started_at, submitted_at, approved_at, due_date, created_at')
    .or(`assignee_user_id.eq.${user.id},delegated_to_user_id.eq.${user.id}`)
    .order('created_at', { ascending: false });
  const list = (jobs ?? []) as Record<string, unknown>[];
  if (list.length === 0) return [];

  const ids = list.map((j) => j.id as string);
  const { data: fieldRows } = await supabase.from('job_fields').select('job_id, area_ha, status').in('job_id', ids);
  const byJob = new Map<string, { area: number; count: number }>();
  for (const f of (fieldRows ?? []) as Record<string, unknown>[]) {
    const jid = f.job_id as string;
    const cur = byJob.get(jid) ?? { area: 0, count: 0 };
    if (f.status === 'done' || f.status === 'partial') {
      cur.area += Number(f.area_ha) || 0;
      cur.count += 1;
    }
    byJob.set(jid, cur);
  }

  return list.map((j) => ({
    id: j.id as string,
    title: j.title as string,
    job_type: j.job_type as string,
    farm_name: (j.farm_name as string) ?? null,
    status: j.status as string,
    work_minutes: (j.work_minutes as number) ?? null,
    work_started_at: (j.work_started_at as string) ?? null,
    work_date: (j.submitted_at as string) ?? (j.approved_at as string) ?? (j.due_date as string) ?? (j.created_at as string),
    area_done_ha: byJob.get(j.id as string)?.area ?? 0,
    field_count: byJob.get(j.id as string)?.count ?? 0,
  }));
}

// Count of new (sent, not yet started) jobs waiting for this user — for the nav badge.
export async function countNewJobs(): Promise<number> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .or(`assignee_user_id.eq.${user.id},delegated_to_user_id.eq.${user.id}`);
  return count ?? 0;
}
