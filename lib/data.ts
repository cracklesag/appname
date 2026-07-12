import { cache } from 'react';
import { createClient } from './supabase/server';
import { getFarmContext } from './farm';
import { Application, ApplicationArea, Cut, DEFAULT_SETTINGS, Field, FieldEvent, GrassSystem, Group, GrazingEvent, PlateReading, Product, ProductAnalysis, Settings, SoilSample, SprayRecord, SprayProduct, SprayPurchase, Job, JobField, ContractorProfile, FarmContractor, FieldCropAllocation, Agreement, FieldAgreement, AllocationType, Todo, FarmNote } from './types';
import { CropRow, LoadedCrop, loadedCropFromRow } from './crops';

export const loadAllProducts = cache(async function loadAllProductsUncached(): Promise<Product[]> {
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
})

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

export const loadFields = cache(async function loadFieldsUncached(): Promise<Field[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('fields').select('*').order('name');
  if (error) throw error;
  return (data || []) as Field[];
})

export const loadGroups = cache(async function loadGroupsUncached(): Promise<Group[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('groups').select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as Group[];
})

/**
 * Load all grass systems visible to the current user — both shared seeds
 * (user_id IS NULL, returned by RLS) and the user's own custom rows.
 *
 * Sort order: shared seeds first (by their sort_order then name), then
 * user-owned custom rows alphabetically.
 */
export const loadGrassSystems = cache(async function loadGrassSystemsUncached(): Promise<GrassSystem[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('grass_systems').select('*')
    .order('user_id', { ascending: true, nullsFirst: true })  // shared first
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as GrassSystem[];
})

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

export const loadAllApplications = cache(async function loadAllApplicationsUncached(): Promise<Application[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('applications').select('*')
    .order('date_applied', { ascending: false });
  if (error) throw error;
  return (data || []) as Application[];
})

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

export const loadAllCuts = cache(async function loadAllCutsUncached(): Promise<Cut[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('cuts').select('*').order('cut_date', { ascending: false });
  if (error) throw error;
  return (data || []) as Cut[];
})

export const loadSettings = cache(async function loadSettingsUncached(): Promise<Settings> {
  const supabase = createClient();

  // Which farm's settings? getFarmContext() is the single source of truth for
  // farm resolution (own farm vs. the farm you're staff on, preferring the
  // staffed farm when your own was never onboarded). This used to be
  // re-implemented inline here — one of two copies that had to be kept "in
  // lock-step" by comment alone. Now there's one.
  const ctx = await getFarmContext();
  if (!ctx) return DEFAULT_SETTINGS;
  const isStaff = ctx.role === 'staff';

  const { data, error } = await supabase.from('settings').select('data').eq('user_id', ctx.ownerId).maybeSingle();
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
});

// ---------------------------------------------------------------------
// Multi-user farm: members + invites (Team screen)
// ---------------------------------------------------------------------

export interface FarmMemberRow {
  id: string;
  owner_id: string;
  member_id: string;
  role: 'admin' | 'staff' | 'agronomist';
  member_name: string | null;
  created_at: string;
}

export interface FarmInviteRow {
  id: string;
  owner_id: string;
  code: string;
  role: 'staff' | 'agronomist';
  label: string | null;
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
  used_by: string | null;
}

/** Load all members of the current admin's farm (RLS scopes to their farm). */export async function loadFarmMembers(): Promise<FarmMemberRow[]> {
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

// Submitted jobs on this farm waiting for the admin's approval (home badge).
export async function countJobsAwaitingApproval(): Promise<number> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'submitted');
  return count ?? 0;
}

// ---- Assistant chat history -----------------------------------------
// The "look back at past chats" feature reads the same assistant_logs rows
// the API already writes on every turn. Nothing new is captured — this is a
// read-only view grouped by conversation_id. RLS scopes selects to the
// signed-in user, so a user only ever sees their own threads.
//
// RETENTION: we show only the last RETENTION_DAYS by DISPLAY filter, not by
// deletion — the rows are tiny and we keep them (e.g. to size up model
// routing later). If a hard purge is ever wanted, that's a separate
// scheduled job, not this read path.
export const ASSISTANT_HISTORY_RETENTION_DAYS = 7;

export interface AssistantThreadTurn {
  turn: number | null;
  question: string;
  answer: string | null;
  model: string | null;
  toolsUsed: string[];
  error: string | null;
  createdAt: string;
}

export interface AssistantThread {
  conversationId: string;
  startedAt: string;   // earliest turn in the thread
  lastAt: string;      // latest turn (what we sort the list by)
  turnCount: number;
  firstQuestion: string; // used as the thread title in the list
  turns: AssistantThreadTurn[];
}

type RawLog = {
  conversation_id: string | null;
  turn: number | null;
  question: string;
  answer: string | null;
  model: string | null;
  tools_used: string[] | null;
  error: string | null;
  created_at: string;
};

function groupThreads(rows: RawLog[]): AssistantThread[] {
  const byConvo = new Map<string, RawLog[]>();
  for (const r of rows) {
    // Pre-conversation_id rows (older logs) get bucketed by row so they still
    // show as one-off entries rather than vanishing.
    const key = r.conversation_id ?? `legacy:${r.created_at}`;
    const list = byConvo.get(key);
    if (list) list.push(r); else byConvo.set(key, [r]);
  }

  const threads: AssistantThread[] = [];
  for (const [conversationId, list] of byConvo) {
    // Order turns within a thread oldest-first (by turn, then time).
    list.sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0) || a.created_at.localeCompare(b.created_at));
    const turns: AssistantThreadTurn[] = list.map((r) => ({
      turn: r.turn,
      question: r.question,
      answer: r.answer,
      model: r.model,
      toolsUsed: r.tools_used ?? [],
      error: r.error,
      createdAt: r.created_at,
    }));
    threads.push({
      conversationId,
      startedAt: list[0].created_at,
      lastAt: list[list.length - 1].created_at,
      turnCount: turns.length,
      firstQuestion: list[0].question,
      turns,
    });
  }
  // Most-recently-active thread first.
  threads.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return threads;
}

/** All of the current user's chat threads within the retention window. */
export const loadAssistantThreads = cache(async function loadAssistantThreadsUncached(): Promise<AssistantThread[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const sinceIso = new Date(Date.now() - ASSISTANT_HISTORY_RETENTION_DAYS * 86400_000).toISOString();
  const { data, error } = await supabase
    .from('assistant_logs')
    .select('conversation_id, turn, question, answer, model, tools_used, error, created_at')
    .eq('user_id', user.id)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error || !data) return [];
  return groupThreads(data as RawLog[]);
});

/** One thread by conversation id (retention window still applies). */
export async function loadAssistantThread(conversationId: string): Promise<AssistantThread | null> {
  const threads = await loadAssistantThreads();
  return threads.find((t) => t.conversationId === conversationId) ?? null;
}

/**
 * Map of member_id → display name for the current farm, used to show "who
 * logged this" on the Activity page. RLS scopes farm_members to the farm, so
 * this only ever returns the viewer's own farm. Members without a name set
 * are omitted (the caller falls back to a neutral label).
 */
export const loadFarmMemberNames = cache(async function loadFarmMemberNamesUncached(): Promise<Record<string, string>> {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) return {};
  const { data, error } = await supabase
    .from('farm_members')
    .select('member_id, member_name')
    .eq('owner_id', ctx.ownerId);
  if (error || !data) return {};
  const map: Record<string, string> = {};
  for (const r of data as { member_id: string; member_name: string | null }[]) {
    if (r.member_name && r.member_name.trim()) map[r.member_id] = r.member_name.trim();
  }
  return map;
});

// ---- Agronomist: the client farms linked to this advisor ----------------
export interface AgronomistFarm {
  ownerId: string;
  farmName: string;
  /** When they were linked (membership created). */
  linkedAt: string | null;
}

/**
 * The farms an agronomist is linked to (role='agronomist'), with each farm's
 * display name. RLS lets an agronomist read these farms' settings because they
 * are a member of them. Names come from each owner's own settings row.
 */
export async function loadAgronomistFarms(): Promise<AgronomistFarm[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: mems } = await supabase
    .from('farm_members')
    .select('owner_id, created_at')
    .eq('member_id', user.id)
    .eq('role', 'agronomist');
  if (!mems || mems.length === 0) return [];
  const ownerIds = mems.map((m) => m.owner_id as string);
  const { data: settingsRows } = await supabase
    .from('settings')
    .select('user_id, data')
    .in('user_id', ownerIds);
  const nameById = new Map(
    (settingsRows ?? []).map((r) => [
      r.user_id as string,
      ((r.data as { farmName?: string } | null)?.farmName ?? 'Unnamed farm'),
    ]),
  );
  return mems
    .map((m) => ({
      ownerId: m.owner_id as string,
      farmName: nameById.get(m.owner_id as string) ?? 'Unnamed farm',
      linkedAt: (m.created_at as string) ?? null,
    }))
    .sort((a, b) => a.farmName.localeCompare(b.farmName));
}

// ---------------------------------------------------------------------
// Crops — catalogue + per-field allocations
// ---------------------------------------------------------------------

/**
 * Load all crops visible to the user — shared seeds (user_id IS NULL) and the
 * farm's own forks (RLS scopes both). Mapped to the engine profile + identity.
 * Shared seeds first (by sort_order), then user customs alphabetically.
 */
export const loadCrops = cache(async function loadCropsUncached(): Promise<LoadedCrop[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('crops').select('*')
    .order('user_id', { ascending: true, nullsFirst: true })
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as CropRow[]).map(loadedCropFromRow);
})

/** All crop allocations on the farm (RLS-scoped), newest season first. */
export const loadCropAllocations = cache(async function loadCropAllocationsUncached(): Promise<FieldCropAllocation[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('field_crop_allocations').select('*')
    .order('season', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FieldCropAllocation[];
})

/** Crop allocations for one field, newest season first. */
export async function loadCropAllocationsForField(fieldId: string): Promise<FieldCropAllocation[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('field_crop_allocations').select('*')
    .eq('field_id', fieldId)
    .order('season', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FieldCropAllocation[];
}


/**
 * Load all agreements visible to the current user — shared seeds
 * (user_id IS NULL, returned by RLS) and the user's own customs. Shared seeds
 * first (by sort_order then code), then the user's rows.
 */
export const loadAgreements = cache(async function loadAgreementsUncached(): Promise<Agreement[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('agreements').select('*')
    .order('user_id', { ascending: true, nullsFirst: true })
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Agreement[];
})

/** All field<->agreement memberships on the farm (RLS-scoped). */
export const loadFieldAgreements = cache(async function loadFieldAgreementsUncached(): Promise<FieldAgreement[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('field_agreements').select('*');
  if (error) throw error;
  return (data ?? []) as FieldAgreement[];
})

/** field_id -> agreement_id[] for quick per-field lookup. */
export async function loadFieldAgreementMap(): Promise<Record<string, string[]>> {
  const rows = await loadFieldAgreements();
  const map: Record<string, string[]> = {};
  for (const r of rows) (map[r.field_id] ??= []).push(r.agreement_id);
  return map;
}


/** All allocation types visible to the user — shared seeds first, then own. */
export const loadAllocationTypes = cache(async function loadAllocationTypesUncached(): Promise<AllocationType[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('allocation_types').select('*')
    .order('user_id', { ascending: true, nullsFirst: true })
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AllocationType[];
})

/** Warning ids the farm's admins have dismissed (see dismissed_notifications).
 *  Computed warnings whose id is in this set are hidden. */
export async function loadDismissedNotificationIds(): Promise<Set<string>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('dismissed_notifications')
    .select('warning_id');
  if (error || !data) return new Set();
  return new Set(data.map((r) => (r as { warning_id: string }).warning_id));
}

/** Diary to-dos. RLS shapes the result by role: admins get the whole farm's
 *  list, staff get only rows assigned to them. Open first, then done. */
export async function loadTodos(): Promise<Todo[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data as Todo[];
}

/** Diary notes (admin-only via RLS). Pinned first, newest first within. */
export async function loadNotes(): Promise<FarmNote[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('farm_notes')
    .select('*')
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error || !data) return [];
  return data as FarmNote[];
}
