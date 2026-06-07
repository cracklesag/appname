'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { getFarmContext, requireAdmin, requireMember } from '@/lib/farm';
import { CutType, ProductCategory, YieldClass, ApplicationMethod, RateUnit } from '@/lib/types';
import { polygonAreaHectares, type FieldGeometry } from '@/lib/geo';
import { coverageFraction, RECONCILE_COVERAGE_THRESHOLD } from '@/lib/partials';
import { suggestSoilTypeFromExtras } from '@/lib/soil-suggest';

/**
 * Season start used for cut renumbering. Mirrors getSeasonStart() in
 * lib/rules (the UK grass/fertiliser year runs 1st Oct → 30th Sep). Inlined
 * here so server actions don't import the rules module (which pulls product
 * types etc.). Keep these two in lock-step.
 */
function getSeasonStartIso(): string {
  const now = new Date();
  const startYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-10-01`;
}

/**
 * Renumber all cuts on a field in chronological order. Called after every
 * cut save / update / delete / batch save so that cut_number always
 * reflects "Nth cut by date" rather than "Nth cut by log order".
 *
 * Backdating a cut now correctly bumps every later cut's number up by one.
 * Deleting a middle cut closes the gap.
 *
 * Uses cut_date asc + created_at asc as tiebreakers (multiple cuts on the
 * same date: whichever was logged first comes first).
 *
 * Idempotent — calling it twice gives the same result.
 */
async function renumberCutsForField(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  fieldId: string,
): Promise<void> {
  const seasonStart = getSeasonStartIso();
  // Fetch cuts in correct chronological order.
  const { data: cuts, error } = await supabase
    .from('cuts')
    .select('id, cut_number, cut_date, created_at')
    .eq('user_id', userId)
    .eq('field_id', fieldId)
    .gte('cut_date', seasonStart)
    .order('cut_date', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Could not renumber cuts: ${error.message}`);
  if (!cuts || cuts.length === 0) return;

  // Only rewrite rows whose cut_number doesn't already match position.
  // Spares DB writes and avoids churning updated_at unnecessarily.
  const updates = cuts
    .map((c, idx) => ({ id: c.id, expectedNumber: idx + 1, currentNumber: c.cut_number }))
    .filter((u) => u.expectedNumber !== u.currentNumber);

  for (const u of updates) {
    const { error: upErr } = await supabase
      .from('cuts')
      .update({ cut_number: u.expectedNumber })
      .eq('id', u.id)
      .eq('user_id', userId);
    if (upErr) throw new Error(`Could not renumber cut ${u.id}: ${upErr.message}`);
  }
}

export async function saveApplication(formData: FormData) {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');

  const fieldId = String(formData.get('field_id'));
  const productId = parseInt(String(formData.get('product_id')), 10);
  const dateApplied = String(formData.get('date_applied'));
  const rateValue = parseFloat(String(formData.get('rate_value')));
  const rateUnit = String(formData.get('rate_unit')) as RateUnit;
  const method = (formData.get('method') ? String(formData.get('method')) : null) as ApplicationMethod | null;
  const notes = formData.get('notes') ? String(formData.get('notes')) : null;

  if (!fieldId || !productId || !dateApplied || !rateValue || rateValue <= 0) {
    throw new Error('Missing required fields');
  }

  // Partial (part-field) application: a drawn sub-area is posted as a GeoJSON
  // polygon. Such an application is held PENDING — excluded from the field's
  // nutrient metrics — until the field reconciles (see reconcileFieldPartials).
  const isPartial = String(formData.get('coverage')) === 'partial';
  const areaJson = formData.get('application_area') ? String(formData.get('application_area')) : null;
  let drawnGeometry: FieldGeometry | null = null;
  let drawnHa: number | null = null;
  if (isPartial) {
    if (!areaJson) throw new Error('A part application needs a drawn area');
    try {
      drawnGeometry = JSON.parse(areaJson) as FieldGeometry;
    } catch {
      throw new Error('Could not read the drawn area');
    }
    drawnHa = polygonAreaHectares(drawnGeometry);
    if (!(drawnHa > 0)) throw new Error('The drawn area is empty — draw the spread area and try again');
  }

  const { data: inserted, error } = await supabase
    .from('applications')
    .insert({
      user_id: ctx.ownerId,        // farm owner owns the row
      created_by: ctx.userId,      // who actually entered it
      field_id: fieldId,
      product_id: productId,
      date_applied: dateApplied,
      rate_value: rateValue,
      rate_unit: rateUnit,
      method,
      notes,
      applied_by: 'me',
      coverage: isPartial ? 'partial' : 'whole',
      drawn_ha: drawnHa,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  if (isPartial && inserted && drawnGeometry) {
    const { error: areaErr } = await supabase.from('application_areas').insert({
      user_id: ctx.ownerId,
      created_by: ctx.userId,
      application_id: inserted.id,
      field_id: fieldId,
      polygon: drawnGeometry,
      area_ha: drawnHa,
    });
    if (areaErr) throw new Error(areaErr.message);
    // Re-evaluate whether the field's partials now cover it (fold into metrics).
    await reconcileFieldPartials(fieldId);
  }

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath(`/fields/${fieldId}/part-applications`);
  revalidatePath('/');
  revalidatePath('/activity');
  const returnTo = formData.get('return_to') ? String(formData.get('return_to')) : '';
  const dest = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : `/fields/${fieldId}`;
  redirect(dest);
}

/**
 * Recompute whether a field's PARTIAL applications together cover it (within
 * the coverage threshold) and stamp/clear reconciled_at accordingly. Idempotent
 * and self-correcting: call after adding a partial area or after deleting any
 * application. Reconciliation is field-level — all of the field's partials flip
 * together (per the spec). Does nothing if the field has no boundary.
 */
async function reconcileFieldPartials(fieldId: string) {
  const supabase = createClient();

  const { data: partials } = await supabase
    .from('applications')
    .select('id, reconciled_at')
    .eq('field_id', fieldId)
    .eq('coverage', 'partial');
  if (!partials || partials.length === 0) return;

  const { data: field } = await supabase
    .from('fields')
    .select('boundary')
    .eq('id', fieldId)
    .maybeSingle();
  const boundary = (field?.boundary ?? null) as FieldGeometry | null;

  const { data: areas } = await supabase
    .from('application_areas')
    .select('polygon')
    .eq('field_id', fieldId);
  const geoms = (areas || [])
    .map((a) => a.polygon as FieldGeometry)
    .filter((g): g is FieldGeometry => !!g);

  // No boundary (or no drawn areas) → cannot reconcile; leave everything pending.
  const reconciled =
    !!boundary && geoms.length > 0 &&
    coverageFraction(boundary, geoms) >= RECONCILE_COVERAGE_THRESHOLD;

  const stampNeeded = partials.filter((p) => !!p.reconciled_at !== reconciled);
  if (stampNeeded.length === 0) return;

  const { error } = await supabase
    .from('applications')
    .update({ reconciled_at: reconciled ? new Date().toISOString() : null })
    .in('id', stampNeeded.map((p) => p.id));
  if (error) throw new Error(error.message);
}

/**
 * Batch application entry: one product/date/method spread across several
 * fields, with an optional per-field rate override. The client posts:
 *   product_id, date_applied, method (optional), notes (optional)
 *   rows = JSON array of { field_id, rate_value, rate_unit }
 * One application row is inserted per field. Any farm member may add
 * applications; rows are stamped created_by = the entering user.
 */
export async function saveBatchApplications(formData: FormData) {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');

  const productId = parseInt(String(formData.get('product_id')), 10);
  const dateApplied = String(formData.get('date_applied'));
  const method = (formData.get('method') ? String(formData.get('method')) : null) as ApplicationMethod | null;
  const notes = formData.get('notes') ? String(formData.get('notes')) : null;

  if (!productId || !dateApplied || !/^\d{4}-\d{2}-\d{2}$/.test(dateApplied)) {
    throw new Error('Pick a product and a valid date');
  }

  let rows: Array<{ field_id: string; rate_value: number; rate_unit: string }>;
  try {
    rows = JSON.parse(String(formData.get('rows') ?? ''));
  } catch {
    throw new Error('Could not parse the selected fields — try again');
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Tick at least one field before saving');
  }

  // Validate the fields belong to this farm.
  const { data: farmFields, error: fErr } = await supabase
    .from('fields')
    .select('id')
    .eq('user_id', ctx.ownerId);
  if (fErr) throw new Error(`Could not load fields: ${fErr.message}`);
  const ownFieldIds = new Set((farmFields ?? []).map((f) => f.id as string));

  const VALID_UNITS = new Set(['kg/ha', 'kg/ac', 'lb/ac', 'gal/ac', 'm3/ha', 't/ac', 't/ha', 'l/ha', 'l/ac']);
  const inserts = rows.map((r) => {
    if (!r.field_id || !ownFieldIds.has(r.field_id)) {
      throw new Error('A selected field was not found on your farm');
    }
    const rate = Number(r.rate_value);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error('Every field needs a rate greater than zero');
    }
    if (!VALID_UNITS.has(r.rate_unit)) {
      throw new Error(`Invalid rate unit: ${r.rate_unit}`);
    }
    return {
      user_id: ctx.ownerId,
      created_by: ctx.userId,
      field_id: r.field_id,
      product_id: productId,
      date_applied: dateApplied,
      rate_value: rate,
      rate_unit: r.rate_unit,
      method,
      notes,
      applied_by: 'me',
    };
  });

  const { error } = await supabase.from('applications').insert(inserts);
  if (error) throw new Error(`Could not save batch: ${error.message}`);

  const fieldIds = Array.from(new Set(rows.map((r) => r.field_id)));
  for (const fId of fieldIds) revalidatePath(`/fields/${fId}`);
  revalidatePath('/');
  revalidatePath('/activity');

  // Return to the log screen ready for the next entry, rather than bouncing
  // to the activity page — keeps the flow going when logging several in a row.
  // (We deliberately do NOT revalidatePath('/log') here: revalidating the same
  // route we're redirecting to can stall the navigation, leaving the Save
  // button stuck. /log is force-dynamic so it always renders fresh anyway.)
  const logType = String(formData.get('log_type') || '');
  const typeParam = ['bag_fert', 'slurry', 'solid_manure', 'lime'].includes(logType)
    ? `&type=${logType}` : '';
  // A unique token per save so the log page can remount the form fresh each
  // time (clears the Saving… state and the inputs ready for the next entry),
  // even when two consecutive saves have the same field count.
  const token = Date.now().toString(36);
  redirect(`/log?flash=apps_logged&count=${rows.length}${typeParam}&t=${token}`);
}

export async function updateApplication(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const id = String(formData.get('id'));
  const fieldId = String(formData.get('field_id'));
  const productId = parseInt(String(formData.get('product_id')), 10);
  const dateApplied = String(formData.get('date_applied'));
  const rateValue = parseFloat(String(formData.get('rate_value')));
  const rateUnit = String(formData.get('rate_unit')) as RateUnit;
  const method = (formData.get('method') ? String(formData.get('method')) : null) as ApplicationMethod | null;
  const notes = formData.get('notes') ? String(formData.get('notes')) : null;

  if (!id || !fieldId || !productId || !dateApplied || !rateValue || rateValue <= 0) {
    throw new Error('Missing required fields');
  }

  const { error } = await supabase
    .from('applications')
    .update({
      field_id: fieldId,
      product_id: productId,
      date_applied: dateApplied,
      rate_value: rateValue,
      rate_unit: rateUnit,
      method,
      notes,
    })
    .eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
  revalidatePath('/activity');
  // Return to wherever the edit was launched from (activity feed or a field
  // tab), falling back to the field view. Only accept internal relative paths.
  const returnTo = formData.get('return_to') ? String(formData.get('return_to')) : '';
  const dest = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : `/fields/${fieldId}`;
  redirect(dest);
}

export async function deleteApplication(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const id = String(formData.get('id'));
  const fieldId = String(formData.get('field_id'));
  if (!id) throw new Error('Missing application id');

  const { error } = await supabase.from('applications').delete().eq('id', id);
  if (error) throw new Error(error.message);

  // Deleting an application (its application_areas cascade) can change a
  // field's partial coverage — re-evaluate so reconciled_at stays honest.
  if (fieldId) await reconcileFieldPartials(fieldId);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath(`/fields/${fieldId}/part-applications`);
  revalidatePath('/');
  revalidatePath('/activity');
  const returnTo = formData.get('return_to') ? String(formData.get('return_to')) : '';
  const dest = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : `/fields/${fieldId}`;
  redirect(dest);
}

export async function saveCut(formData: FormData) {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');

  const fieldId = String(formData.get('field_id'));
  const cutNumber = parseInt(String(formData.get('cut_number')), 10);
  const cutDate = String(formData.get('cut_date'));
  const cutType = String(formData.get('cut_type')) as CutType;
  const yieldClass = String(formData.get('yield_class')) as YieldClass;
  const notes = formData.get('notes') ? String(formData.get('notes')) : null;
  // What's next for this field. Stays nullable for legacy callers / older
  // forms that don't post the field; defaults to null then.
  const VALID_NEXT_ACTIONS = ['another_cut_silage','another_cut_bales','rotational_grazing','maintenance_grazing'];
  const rawNextAction = String(formData.get('next_action') ?? '');
  const nextAction: string | null = VALID_NEXT_ACTIONS.includes(rawNextAction) ? rawNextAction : null;

  if (!fieldId || !cutNumber || !cutDate) throw new Error('Missing required fields');

  const { error } = await supabase.from('cuts').insert({
    user_id: ctx.ownerId,
    created_by: ctx.userId,
    field_id: fieldId,
    cut_number: cutNumber,
    cut_date: cutDate,
    cut_type: cutType,
    yield_class: yieldClass,
    next_action: nextAction,
    notes,
  });
  if (error) throw new Error(error.message);

  // Renumber so cut_number reflects chronological order — handles
  // backdated cuts being inserted between existing ones. Operates on the
  // farm owner's rows.
  await renumberCutsForField(supabase, ctx.ownerId, fieldId);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
  const returnTo = formData.get('return_to') ? String(formData.get('return_to')) : '';
  const dest = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : `/fields/${fieldId}`;
  redirect(dest);
}

export async function updateCut(formData: FormData) {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');

  const id = String(formData.get('id'));
  const fieldId = String(formData.get('field_id'));
  const cutNumber = parseInt(String(formData.get('cut_number')), 10);
  const cutDate = String(formData.get('cut_date'));
  const cutType = String(formData.get('cut_type')) as CutType;
  const yieldClass = String(formData.get('yield_class')) as YieldClass;
  const notes = formData.get('notes') ? String(formData.get('notes')) : null;
  // Same as saveCut — accept next_action, fall back to null when missing.
  const VALID_NEXT_ACTIONS = ['another_cut_silage','another_cut_bales','rotational_grazing','maintenance_grazing'];
  const rawNextAction = String(formData.get('next_action') ?? '');
  const nextAction: string | null = VALID_NEXT_ACTIONS.includes(rawNextAction) ? rawNextAction : null;

  if (!id || !fieldId || !cutNumber || !cutDate) throw new Error('Missing required fields');

  const { error } = await supabase
    .from('cuts')
    .update({
      cut_number: cutNumber,
      cut_date: cutDate,
      cut_type: cutType,
      yield_class: yieldClass,
      next_action: nextAction,
      notes,
    })
    .eq('id', id);
  if (error) throw new Error(error.message);

  // Date may have moved — renumber so chronological order holds.
  await renumberCutsForField(supabase, ctx.ownerId, fieldId);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
  revalidatePath('/activity');

  // Return to where the edit was launched from (a filtered activity view or a
  // field tab), falling back to the field view. Internal relative paths only.
  const returnTo = formData.get('return_to') ? String(formData.get('return_to')) : '';
  const dest = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : `/fields/${fieldId}`;
  redirect(dest);
}

export async function deleteCut(formData: FormData) {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');

  const id = String(formData.get('id'));
  const fieldId = String(formData.get('field_id'));
  if (!id) throw new Error('Missing cut id');

  const { error } = await supabase.from('cuts').delete().eq('id', id);
  if (error) throw new Error(error.message);

  // Close the gap left by the deleted cut so cut numbers stay 1..N.
  if (fieldId) await renumberCutsForField(supabase, ctx.ownerId, fieldId);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
  redirect(`/fields/${fieldId}`);
}

export async function saveSoil(formData: FormData) {
  const supabase = createClient();
  await requireAdmin();

  const fieldId = String(formData.get('field_id'));
  const ph = formData.get('ph') ? parseFloat(String(formData.get('ph'))) : null;
  const pIdx = formData.get('p_idx') ? parseFloat(String(formData.get('p_idx'))) : null;
  const kIdx = formData.get('k_idx') ? parseFloat(String(formData.get('k_idx'))) : null;
  const mgIdx = formData.get('mg_idx') ? parseFloat(String(formData.get('mg_idx'))) : null;
  const sampleDate = formData.get('sample_date') ? String(formData.get('sample_date')) : null;
  const lastPloughed = formData.get('last_ploughed') ? String(formData.get('last_ploughed')) : null;
  const lastReseeded = formData.get('last_reseeded') ? String(formData.get('last_reseeded')) : null;
  const notes = formData.get('notes') ? String(formData.get('notes')) : null;
  // Soil type is optional on the form — if not present, leave the existing
  // value untouched (don't overwrite a saved value with the default).
  const rawSoilType = String(formData.get('soil_type') ?? '');
  const VALID_SOIL_TYPES = ['light_sand', 'medium_loam', 'heavy_clay', 'deep_silt', 'organic', 'peaty'];
  const soilType = VALID_SOIL_TYPES.includes(rawSoilType) ? rawSoilType : null;
  // Grass system — only set if the form sent a non-empty value. Same
  // approach as soil type lets older forms keep working.
  const rawGrassSystemId = String(formData.get('grass_system_id') ?? '').trim();
  const grassSystemId: string | null | undefined = rawGrassSystemId === ''
    ? undefined  // form didn't send it — leave alone
    : rawGrassSystemId;

  const sampled = ph != null || pIdx != null || kIdx != null || mgIdx != null;

  // Build the update object so we only set soil_type / grass_system_id if
  // they were actually submitted; lets older forms (and partial saves)
  // keep working without overwriting existing values.
  const update: Record<string, unknown> = {
    ph, p_idx: pIdx, k_idx: kIdx, mg_idx: mgIdx,
    sample_date: sampleDate, last_ploughed: lastPloughed, last_reseeded: lastReseeded,
    notes, sampled,
    updated_at: new Date().toISOString(),
  };
  if (soilType) update.soil_type = soilType;
  if (grassSystemId !== undefined) update.grass_system_id = grassSystemId;

  const { error } = await supabase.from('fields').update(update).eq('id', fieldId);
  if (error) throw new Error(error.message);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
  const returnTo = formData.get('return_to') ? String(formData.get('return_to')) : '';
  const dest = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : `/fields/${fieldId}`;
  redirect(dest);
}

export async function savePlan(formData: FormData) {
  const supabase = createClient();
  await requireAdmin();

  const fieldId = String(formData.get('field_id'));
  const cutProfile = parseInt(String(formData.get('cut_profile')), 10);
  const plannedCuts: CutType[] = [];
  for (let i = 0; i < cutProfile; i++) {
    const v = formData.get(`cut_${i}`);
    plannedCuts.push((v ? String(v) : 'silage') as CutType);
  }

  const { error } = await supabase.from('fields').update({
    cut_profile: cutProfile,
    planned_cuts: plannedCuts,
    updated_at: new Date().toISOString(),
  }).eq('id', fieldId);
  if (error) throw new Error(error.message);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
  const returnTo = formData.get('return_to') ? String(formData.get('return_to')) : '';
  const dest = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : `/fields/${fieldId}`;
  redirect(dest);
}

export async function saveSettings(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const user = { id: ctx.ownerId };

  // Load the existing settings blob so we preserve any fields the form
  // doesn't submit — most importantly `onboarded`. Overwriting the whole
  // blob without this drops the flag and bounces the user to /welcome.
  const { data: existingRow } = await supabase
    .from('settings')
    .select('data')
    .eq('user_id', user.id)
    .maybeSingle();
  const existing = (existingRow?.data as Record<string, unknown>) || {};

  const data = {
    ...existing,
    onboarded: existing.onboarded === false ? false : true,
    farmName: (String(formData.get('farm_name') || '').trim()) || null,
    yieldMultipliers: {
      light: parseFloat(String(formData.get('yield_light'))),
      average: parseFloat(String(formData.get('yield_average'))),
      heavy: parseFloat(String(formData.get('yield_heavy'))),
    },
    cutTypeMultipliers: {
      silage: parseFloat(String(formData.get('ct_silage'))),
      bales: parseFloat(String(formData.get('ct_bales'))),
      grazing: parseFloat(String(formData.get('ct_grazing'))),
    },
    grazingReturnPct: parseFloat(String(formData.get('grazing_return'))) / 100,
    nTargets: {
      1: parseFloat(String(formData.get('n_cut1'))),
      2: parseFloat(String(formData.get('n_cut2'))),
      3: parseFloat(String(formData.get('n_cut3'))),
      4: parseFloat(String(formData.get('n_cut4'))),
    },
    soilTargets: {
      pH: parseFloat(String(formData.get('target_ph'))),
      pIdx: parseFloat(String(formData.get('target_pidx'))),
      kIdx: parseFloat(String(formData.get('target_kidx'))),
    },
    reportDefaults: {
      // Clamp to bounds matching the UI input min/max so a manual URL
      // tweak can't push values out of the agronomic range.
      splitFrontLoadPct: Math.max(40, Math.min(80,
        parseFloat(String(formData.get('report_split_pct') || '60')) || 60
      )),
      annualNCapKgPerHa: Math.max(100, Math.min(400,
        parseFloat(String(formData.get('report_n_cap') || '320')) || 320
      )),
      grazingCadenceKgN: Math.max(10, Math.min(80,
        parseFloat(String(formData.get('report_grazing_n') || '40')) || 40
      )),
      grazingCadenceWeeks: Math.max(1, Math.min(12,
        parseInt(String(formData.get('report_grazing_weeks') || '4'), 10) || 4
      )),
      // Maintenance dose threshold — kg N/ha. Clamped 0-200 to match the
      // settings input bounds and prevent unreachable / runaway values.
      maintenanceDoseThresholdKgN: Math.max(0, Math.min(200,
        parseFloat(String(formData.get('report_maintenance_threshold') || '30')) || 30
      )),
      // Carryover release model (fert plan). Clamped to sensible ranges.
      releaseSlurryStartPct: Math.max(0, Math.min(100,
        parseFloat(String(formData.get('release_slurry_start') || '70')) || 70
      )),
      releaseSlurryPerMonthPct: Math.max(0, Math.min(100,
        parseFloat(String(formData.get('release_slurry_permonth') || '15')) || 15
      )),
      releaseFymStartPct: Math.max(0, Math.min(100,
        parseFloat(String(formData.get('release_fym_start') || '35')) || 35
      )),
      releaseFymPerMonthPct: Math.max(0, Math.min(100,
        parseFloat(String(formData.get('release_fym_permonth') || '10')) || 10
      )),
      releaseFymCapPct: Math.max(0, Math.min(100,
        parseFloat(String(formData.get('release_fym_cap') || '95')) || 95
      )),
      // Minimum granular spread rate (kg nutrient/ha) below which the fert
      // plan holds the dribble. Clamped 0–100.
      minSpreadP2O5KgPerHa: Math.max(0, Math.min(100,
        parseFloat(String(formData.get('min_spread_p') || '20')) || 20
      )),
      minSpreadK2OKgPerHa: Math.max(0, Math.min(100,
        parseFloat(String(formData.get('min_spread_k') || '25')) || 25
      )),
    },
    timingDefaults: {
      nDueAfterCutDays: Math.max(0, Math.min(30,
        parseInt(String(formData.get('timing_n_due') || '0'), 10) || 0
      )),
      nOverdueAfterCutDays: Math.max(1, Math.min(60,
        parseInt(String(formData.get('timing_n_overdue') || '7'), 10) || 7
      )),
      grazingDressingIntervalDays: Math.max(7, Math.min(120,
        parseInt(String(formData.get('timing_grazing_interval') || '28'), 10) || 28
      )),
      planLeadTimeDays: Math.max(1, Math.min(30,
        parseInt(String(formData.get('timing_lead') || '7'), 10) || 7
      )),
    },
    bagFertUnit: String(formData.get('bag_fert_unit')) as 'kg/ha' | 'kg/ac' | 'lb/ac' | 'units/ac',
    slurryUnit: String(formData.get('slurry_unit')) as 'gal/ac' | 'm3/ha',
    limeUnit: String(formData.get('lime_unit')) as 't/ac' | 't/ha',
    unitSystem: String(formData.get('unit_system')) as 'acres' | 'hectares',
  };

  const { error } = await supabase.from('settings').upsert({
    user_id: user.id,
    data,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);

  revalidatePath('/', 'layout');
  redirect('/settings');
}

/**
 * Persist (or clear) the agronomist's RB209 overrides. Pass a JSON string of
 * the full AgronomyConfig to save it; pass an empty string to reset to the
 * built-in RB209 defaults. Preserves the rest of the settings blob.
 */
export async function saveAgronomy(overridesJson: string) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const userId = ctx.ownerId;

  const { data: existingRow } = await supabase
    .from('settings')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  const existing = (existingRow?.data as Record<string, unknown>) || {};

  const data: Record<string, unknown> = { ...existing };
  const trimmed = (overridesJson || '').trim();
  if (trimmed) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('Invalid agronomy data');
    }
    if (parsed && typeof parsed === 'object') data.agronomy = parsed;
  } else {
    delete data.agronomy; // reset to RB209 defaults
  }

  const { error } = await supabase.from('settings').upsert({
    user_id: userId,
    data,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);

  revalidatePath('/', 'layout');
}

export async function createField(formData: FormData) {
  const supabase = createClient();
  await requireAdmin();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const name = String(formData.get('name') || '').trim();
  const acres = parseFloat(String(formData.get('acres')));
  const ha = parseFloat(String(formData.get('ha')));
  const cutProfile = parseInt(String(formData.get('cut_profile')), 10);
  const plannedCuts: CutType[] = [];
  for (let i = 0; i < cutProfile; i++) {
    const v = formData.get(`cut_${i}`);
    plannedCuts.push((v ? String(v) : 'silage') as CutType);
  }
  const notes = formData.get('notes') ? String(formData.get('notes')) : null;
  // Optional group assignment — empty string or absence means "ungrouped".
  const rawGroupId = String(formData.get('group_id') ?? '').trim();
  const groupId: string | null = rawGroupId === '' ? null : rawGroupId;
  // Soil type — defaults to medium_loam if not provided.
  const VALID_SOIL_TYPES = ['light_sand', 'medium_loam', 'heavy_clay', 'deep_silt', 'organic', 'peaty'];
  const rawSoilType = String(formData.get('soil_type') ?? '');
  const soilType = VALID_SOIL_TYPES.includes(rawSoilType) ? rawSoilType : 'medium_loam';
  // Grass system — optional FK. Empty string or absence → look up the PRG
  // shared seed as default (matches the migration's backfill behaviour).
  const rawGrassSystemId = String(formData.get('grass_system_id') ?? '').trim();
  let grassSystemId: string | null = rawGrassSystemId === '' ? null : rawGrassSystemId;
  if (!grassSystemId) {
    const { data: prg } = await supabase
      .from('grass_systems').select('id')
      .eq('seed_key', 'perennial_ryegrass').maybeSingle();
    if (prg?.id) grassSystemId = prg.id;
  }

  // Validation: name required, acres > 0, ha > 0, cut profile 1-4
  if (!name) throw new Error('Field name is required');
  if (!acres || acres <= 0) throw new Error('Acres must be greater than 0');
  if (!ha || ha <= 0) throw new Error('Hectares must be greater than 0');
  if (!cutProfile || cutProfile < 1 || cutProfile > 4) throw new Error('Cut profile must be 1–4');

  const { data, error } = await supabase.from('fields').insert({
    user_id: user.id,
    group_id: groupId,
    name,
    acres,
    ha,
    cut_profile: cutProfile,
    planned_cuts: plannedCuts,
    soil_type: soilType,
    grass_system_id: grassSystemId,
    sampled: false,
    notes,
  }).select('id').single();

  if (error) {
    if (error.code === '23505') throw new Error(`A field called "${name}" already exists`);
    throw new Error(error.message);
  }

  revalidatePath('/');
  redirect(`/fields/${data.id}`);
}

export async function deleteField(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const ownerId = ctx.ownerId;

  const fieldId = String(formData.get('field_id'));
  const confirmName = String(formData.get('confirm_name') || '').trim();
  if (!fieldId) throw new Error('Missing field id');
  if (!confirmName) throw new Error('Type the field name to confirm');

  // Load the field, scoped to the farm owner so we never match a field from a
  // different farm the user might also belong to.
  const { data: field, error: fetchErr } = await supabase
    .from('fields')
    .select('name')
    .eq('id', fieldId)
    .eq('user_id', ownerId)
    .maybeSingle();
  if (fetchErr || !field) throw new Error('Field not found');

  // Tolerant confirmation: ignore case, collapse whitespace, and treat smart
  // quotes the same as straight ones — so an invisible trailing space, a
  // non-breaking space, a phone auto-capitalising, or a curly-vs-straight
  // apostrophe (e.g. "Bernard's beck side") doesn't block a genuine match.
  const normalise = (s: string) =>
    s
      .replace(/[\u2018\u2019\u201B\u02BC]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  if (normalise(field.name) !== normalise(confirmName)) {
    throw new Error(`Name didn't match. Type "${field.name}" exactly to confirm.`);
  }

  // Clear dependent rows explicitly before deleting the field. Applications and
  // cuts cascade via FK, but soil-sample links (from the import feature) may
  // not, and a non-cascading FK would otherwise block the delete with an
  // opaque constraint error. Best-effort: ignore "table doesn't exist" so this
  // stays robust across environments.
  await supabase.from('applications').delete().eq('field_id', fieldId).eq('user_id', ownerId);
  await supabase.from('cuts').delete().eq('field_id', fieldId).eq('user_id', ownerId);
  await supabase.from('soil_sample_fields').delete().eq('field_id', fieldId).then(
    () => undefined,
    () => undefined,
  );

  // Delete the field itself, scoped to the owner as belt-and-braces over RLS.
  const { error } = await supabase
    .from('fields')
    .delete()
    .eq('id', fieldId)
    .eq('user_id', ownerId);
  if (error) throw new Error(error.message);

  revalidatePath('/');
  revalidatePath('/activity');
  redirect('/');
}

export async function resetAllData(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const user = { id: ctx.ownerId };

  const confirm = String(formData.get('confirm') || '').trim();
  if (confirm !== 'DELETE') {
    throw new Error('Type DELETE in capitals to confirm');
  }

  // Delete in FK-safe order. Settings and the user account are NOT touched.
  await supabase.from('applications').delete().eq('user_id', user.id);
  await supabase.from('cuts').delete().eq('user_id', user.id);
  await supabase.from('fields').delete().eq('user_id', user.id);

  revalidatePath('/');
  revalidatePath('/activity');
  redirect('/');
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

/**
 * Permanently delete the signed-in user's account.
 *
 * Deletion is keyed on the signed-in auth user (ctx.userId), NOT the resolved
 * farm owner — so the Postgres ON DELETE CASCADE on every user_id / owner_id
 * FK (see schema.sql) does the right thing automatically:
 *   - Admin (userId === ownerId): removes their account and the entire farm —
 *     fields, cuts, applications, custom products/grass systems, groups, soil,
 *     settings, invites — and every farm_members row they own, so any staff
 *     are detached from the (now-gone) farm.
 *   - Staff (userId !== ownerId): removes their account, their own empty
 *     auto-created farm, and their membership rows (they leave every farm).
 *     The admin's farm data is owned by the admin and is untouched.
 *
 * Requires the service-role client to call the auth admin API. After deletion
 * the current session is invalid, so we clear it and redirect to /login.
 */
export async function deleteMyAccount(formData: FormData) {
  const ctx = await requireMember();

  const confirm = String(formData.get('confirm') || '').trim();
  if (confirm !== 'DELETE') {
    throw new Error('Type DELETE in capitals to confirm');
  }

  const admin = createServiceClient();
  const { error } = await admin.auth.admin.deleteUser(ctx.userId);
  if (error) {
    throw new Error(`Could not delete your account: ${error.message}`);
  }

  // Session now references a deleted user — clear the cookie (best-effort) and
  // bounce to login.
  try {
    const supabase = createClient();
    await supabase.auth.signOut();
  } catch {
    // ignore — the user is already gone; we just want the cookie cleared
  }
  redirect('/login');
}

// =====================================================================
// FIELD EVENTS — reseed / oversow / plough log
// =====================================================================

/**
 * Recompute the cached sward fields on `fields` from the event log:
 *   - last_reseeded  = most recent reseed/oversow event date
 *   - last_ploughed  = most recent plough event date
 *   - grass_system_id = system from the most recent reseed/oversow event
 *                       that names one
 * Non-destructive: a field is only overwritten when there's an event to
 * derive it from, so deleting every event of a kind leaves the existing
 * value (and a manually-set sward) alone.
 */
async function recomputeFieldFromEvents(
  supabase: ReturnType<typeof createClient>,
  ownerId: string,
  fieldId: string,
): Promise<void> {
  const { data: events } = await supabase
    .from('field_events')
    .select('event_type, event_date, grass_system_id')
    .eq('user_id', ownerId)
    .eq('field_id', fieldId)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false });
  const rows = events ?? [];

  const update: Record<string, unknown> = {};
  const maxDate = (dates: string[]) => dates.reduce((a, b) => (a > b ? a : b));

  const reseedDates = rows
    .filter((e) => e.event_type === 'reseed' || e.event_type === 'oversow')
    .map((e) => e.event_date as string);
  const ploughDates = rows
    .filter((e) => e.event_type === 'plough')
    .map((e) => e.event_date as string);
  if (reseedDates.length) update.last_reseeded = maxDate(reseedDates);
  if (ploughDates.length) update.last_ploughed = maxDate(ploughDates);

  // rows is date-desc, so the first matching entry is the most recent.
  const latestSown = rows.find(
    (e) => (e.event_type === 'reseed' || e.event_type === 'oversow') && e.grass_system_id,
  );
  if (latestSown?.grass_system_id) update.grass_system_id = latestSown.grass_system_id;

  if (Object.keys(update).length) {
    update.updated_at = new Date().toISOString();
    await supabase.from('fields').update(update).eq('id', fieldId).eq('user_id', ownerId);
  }
}

const VALID_EVENT_TYPES = ['reseed', 'oversow', 'plough'];

export async function addFieldEvent(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();

  const fieldId = String(formData.get('field_id') ?? '').trim();
  const eventType = String(formData.get('event_type') ?? '').trim();
  const eventDate = String(formData.get('event_date') ?? '').trim();
  if (!fieldId || !VALID_EVENT_TYPES.includes(eventType) || !eventDate) {
    throw new Error('Pick an event type and a date.');
  }

  // Grass system + seed details only apply to reseed / oversow.
  const rawSystem = String(formData.get('grass_system_id') ?? '').trim();
  const grassSystemId = eventType === 'plough' || rawSystem === '' ? null : rawSystem;

  const rawMix = String(formData.get('seed_mix') ?? '').trim();
  const seedMix = eventType === 'plough' || rawMix === '' ? null : rawMix;

  const rawRate = String(formData.get('seed_rate_value') ?? '').trim();
  let seedRateValue: number | null = rawRate === '' ? null : Number(rawRate);
  if (eventType === 'plough') seedRateValue = null;
  if (seedRateValue !== null && (!Number.isFinite(seedRateValue) || seedRateValue <= 0)) {
    throw new Error('Seed rate must be a positive number.');
  }
  const rawUnit = String(formData.get('seed_rate_unit') ?? '').trim();
  const seedRateUnit = seedRateValue === null
    ? null
    : (rawUnit === 'kg/ha' ? 'kg/ha' : 'kg/ac');

  const rawNotes = String(formData.get('notes') ?? '').trim();
  const notes = rawNotes === '' ? null : rawNotes;

  const { error } = await supabase.from('field_events').insert({
    user_id: ctx.ownerId,
    created_by: ctx.userId,
    field_id: fieldId,
    event_type: eventType,
    event_date: eventDate,
    grass_system_id: grassSystemId,
    seed_mix: seedMix,
    seed_rate_value: seedRateValue,
    seed_rate_unit: seedRateUnit,
    notes,
  });
  if (error) throw new Error(error.message);

  await recomputeFieldFromEvents(supabase, ctx.ownerId, fieldId);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
  const returnTo = formData.get('return_to') ? String(formData.get('return_to')) : '';
  const dest = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : `/fields/${fieldId}`;
  redirect(dest);
}

export async function updateFieldEvent(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();

  const id = String(formData.get('id') ?? '').trim();
  const fieldId = String(formData.get('field_id') ?? '').trim();
  const eventType = String(formData.get('event_type') ?? '').trim();
  const eventDate = String(formData.get('event_date') ?? '').trim();
  if (!id || !fieldId || !VALID_EVENT_TYPES.includes(eventType) || !eventDate) {
    throw new Error('Pick an event type and a date.');
  }

  const rawSystem = String(formData.get('grass_system_id') ?? '').trim();
  const grassSystemId = eventType === 'plough' || rawSystem === '' ? null : rawSystem;

  const rawMix = String(formData.get('seed_mix') ?? '').trim();
  const seedMix = eventType === 'plough' || rawMix === '' ? null : rawMix;

  const rawRate = String(formData.get('seed_rate_value') ?? '').trim();
  let seedRateValue: number | null = rawRate === '' ? null : Number(rawRate);
  if (eventType === 'plough') seedRateValue = null;
  if (seedRateValue !== null && (!Number.isFinite(seedRateValue) || seedRateValue <= 0)) {
    throw new Error('Seed rate must be a positive number.');
  }
  const rawUnit = String(formData.get('seed_rate_unit') ?? '').trim();
  const seedRateUnit = seedRateValue === null
    ? null
    : (rawUnit === 'kg/ha' ? 'kg/ha' : 'kg/ac');

  const rawNotes = String(formData.get('notes') ?? '').trim();
  const notes = rawNotes === '' ? null : rawNotes;

  const { error } = await supabase
    .from('field_events')
    .update({
      event_type: eventType,
      event_date: eventDate,
      grass_system_id: grassSystemId,
      seed_mix: seedMix,
      seed_rate_value: seedRateValue,
      seed_rate_unit: seedRateUnit,
      notes,
    })
    .eq('id', id)
    .eq('user_id', ctx.ownerId);
  if (error) throw new Error(error.message);

  await recomputeFieldFromEvents(supabase, ctx.ownerId, fieldId);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');

  const returnTo = formData.get('return_to') ? String(formData.get('return_to')) : '';
  const dest = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : `/fields/${fieldId}`;
  redirect(dest);
}

export async function deleteFieldEvent(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();

  const id = String(formData.get('id') ?? '').trim();
  const fieldId = String(formData.get('field_id') ?? '').trim();
  if (!id) throw new Error('Missing event id');

  const { error } = await supabase
    .from('field_events').delete()
    .eq('id', id).eq('user_id', ctx.ownerId);
  if (error) throw new Error(error.message);

  if (fieldId) {
    await recomputeFieldFromEvents(supabase, ctx.ownerId, fieldId);
    revalidatePath(`/fields/${fieldId}`);
  }
  revalidatePath('/');
}

// =============================================================================
// Document ingestion
// =============================================================================

/**
 * Upload a soil report PDF and queue it for extraction.
 *
 * Flow:
 *   1. Validate the file (PDF, sensible size)
 *   2. Upload to Supabase Storage in a per-user path
 *   3. Insert a documents row with status='queued'
 *   4. Invoke the extract-document Edge Function (fire-and-forget)
 *   5. Redirect to /import/[documentId] where the page polls for status
 */
export async function uploadDocument(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const file = formData.get('file');
  const docType = String(formData.get('doc_type') || 'soil_report');

  if (!(file instanceof File)) throw new Error('No file uploaded');
  if (file.size === 0) throw new Error('Uploaded file is empty');
  if (file.size > 20 * 1024 * 1024) throw new Error('File is larger than 20 MB');
  if (file.type && file.type !== 'application/pdf') {
    throw new Error('Only PDF files are supported');
  }
  if (docType !== 'soil_report') {
    throw new Error('Unsupported document type');
  }

  // Per-user path scopes Storage RLS naturally
  const ts = Date.now();
  const safeName = (file.name || 'upload.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${user.id}/${ts}_${safeName}`;

  // Upload PDF to Storage
  const buffer = await file.arrayBuffer();
  const { error: uploadErr } = await supabase.storage
    .from('documents-scratch')
    .upload(storagePath, buffer, {
      contentType: 'application/pdf',
      upsert: false,
    });
  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

  // Insert documents row
  const { data: doc, error: insertErr } = await supabase
    .from('documents')
    .insert({
      user_id: user.id,
      storage_path: storagePath,
      original_filename: file.name || null,
      mime_type: file.type || 'application/pdf',
      byte_size: file.size,
      doc_type: docType,
      status: 'queued',
    })
    .select('id')
    .single();
  if (insertErr || !doc) {
    // Try to clean up the orphaned storage object
    await supabase.storage.from('documents-scratch').remove([storagePath]);
    throw new Error(`Failed to create document record: ${insertErr?.message}`);
  }

  // Fire-and-forget Edge Function invocation. We do not await — the page will
  // poll for status. If the function call fails to dispatch, the document just
  // sits in 'queued' forever, which is visible to the user as an error state.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceKey) {
    fetch(`${supabaseUrl}/functions/v1/extract-document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ document_id: doc.id }),
    }).catch(() => {
      // Best-effort. Status stays 'queued' if dispatch fails.
    });
  }

  redirect(`/import/${doc.id}`);
}

/**
 * Commit reviewed samples for a document.
 *
 * Calls the commit_document Postgres RPC which atomically:
 *   - Inserts soil_samples rows for accepted/edited extracted_samples
 *   - Inserts soil_sample_fields junction rows
 *   - Creates new fields where the user opted to create-new
 *   - Updates documents.status='committed'
 *
 * After a successful commit, deletes the source PDF from Storage and revalidates
 * the relevant cache paths so the field cards on the home screen update.
 */
export async function commitDocumentDecisions(
  documentId: string,
  payload: {
    decisions: Array<{
      extracted_sample_id: string;
      decision: 'accepted' | 'edited' | 'rejected';
      overrides: Record<string, unknown>;
      field_links: Array<
        | { existing_field_id: string; replace_existing?: boolean }
        | { new_field: { name: string; acres?: number; ha?: number; skip_size: boolean } }
      >;
    }>;
  },
): Promise<{ error?: string } | void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Not signed in' };
  }

  // Load the document to find the storage path for cleanup
  const { data: doc, error: docErr } = await supabase
    .from('documents')
    .select('id, user_id, storage_path, status')
    .eq('id', documentId)
    .maybeSingle();
  if (docErr || !doc) {
    return { error: 'Document not found' };
  }
  if (doc.user_id !== user.id) {
    return { error: 'Not authorised' };
  }

  // Call the RPC
  const { data: result, error: rpcErr } = await supabase.rpc('commit_document', {
    p_document_id: documentId,
    p_payload: payload,
  });
  if (rpcErr) {
    return { error: rpcErr.message };
  }

  // Best-effort: fill in soil type for linked existing fields that don't have
  // one yet, inferred from the sample (organic-matter % and any stated soil
  // texture). Never overrides an existing choice; failures are ignored since
  // soil type can always be set on the lime page.
  try {
    const live = payload.decisions.filter((d) => d.decision !== 'rejected');
    const ids = live.map((d) => d.extracted_sample_id).filter(Boolean);
    if (ids.length > 0) {
      const { data: exRows } = await supabase
        .from('extracted_samples')
        .select('id, extras')
        .in('id', ids);
      const extrasById = new Map<string, Record<string, unknown>>(
        ((exRows ?? []) as { id: string; extras: Record<string, unknown> | null }[])
          .map((r) => [r.id, r.extras ?? {}]),
      );
      for (const d of live) {
        const suggested = suggestSoilTypeFromExtras(extrasById.get(d.extracted_sample_id));
        if (!suggested) continue;
        for (const link of d.field_links) {
          if ('existing_field_id' in link && link.existing_field_id) {
            await supabase
              .from('fields')
              .update({ soil_type: suggested, updated_at: new Date().toISOString() })
              .eq('id', link.existing_field_id)
              .eq('user_id', user.id)
              .or('soil_type.is.null,soil_type.eq.medium_loam');
          }
        }
      }
    }
  } catch {
    /* best-effort — soil type can be set on the lime page */
  }

  // Best-effort: delete the PDF from Storage now that it's committed.
  // If this fails, we still consider the commit successful — the TTL sweep
  // (Session 4) will catch orphans.
  if (doc.storage_path) {
    await supabase.storage
      .from('documents-scratch')
      .remove([doc.storage_path])
      .catch(() => undefined);
  }

  // Invalidate caches: every field card on home and any field-detail page
  revalidatePath('/');
  revalidatePath(`/import/${documentId}`);

  // Redirect to the home so the user sees the updated field cards
  redirect('/');
}

/**
 * Retry extraction for a failed document. Resets status to 'queued' and
 * re-invokes the Edge Function. The PDF must still exist in Storage; if it's
 * been deleted (shouldn't happen on a failed doc but defensive) the function
 * will fail again with a clearer message.
 */
export async function retryExtraction(documentId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Load and verify ownership and current state
  const { data: doc, error: loadErr } = await supabase
    .from('documents')
    .select('id, user_id, status')
    .eq('id', documentId)
    .maybeSingle();
  if (loadErr || !doc) throw new Error('Document not found');
  if (doc.user_id !== user.id) throw new Error('Not authorised');
  if (doc.status !== 'failed') {
    throw new Error(`Cannot retry — document status is "${doc.status}", not "failed"`);
  }

  // Reset back to queued and clear the error
  const { error: updateErr } = await supabase
    .from('documents')
    .update({
      status: 'queued',
      error_message: null,
      processed_at: null,
    })
    .eq('id', documentId);
  if (updateErr) throw new Error(`Could not reset document: ${updateErr.message}`);

  // Re-invoke the Edge Function (fire-and-forget; the page will poll)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceKey) {
    fetch(`${supabaseUrl}/functions/v1/extract-document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ document_id: documentId }),
    }).catch(() => undefined);
  }

  revalidatePath(`/import/${documentId}`);
  redirect(`/import/${documentId}`);
}

/**
 * Complete first-run onboarding: save the user's preferred area unit and set
 * onboarded=true so they're not shown the welcome screen again.
 *
 * The "unit" choice currently drives two settings together:
 *   acres  → bagFertUnit='kg/ac', slurryUnit='gal/ac', limeUnit='t/ac'
 *   ha     → bagFertUnit='kg/ha', slurryUnit='m3/ha', limeUnit='t/ha'
 *
 * The user can still tweak each individually under Settings later if their
 * preference is mixed (e.g. acres for field size, gal/ac for slurry, kg/ha for
 * fert). This is just the sensible default pair-up.
 */
export async function completeOnboarding(unit: 'acres' | 'ha', farmName?: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Ensure this user is admin of their own farm before writing farm-scoped
  // data. New signups need a self-admin farm_members row so the role-aware
  // RLS write policies (which require is_admin_of(user_id)) accept their own
  // settings/fields/etc. The DB trigger handles this for new signups, but we
  // do it here too so onboarding can never deadlock if the trigger is absent.
  await supabase
    .from('farm_members')
    .insert({ owner_id: user.id, member_id: user.id, role: 'admin' });
  // Ignore the result: a duplicate (already a member) is fine, and if the
  // table is missing the single-user fallback still applies.

  // Load current settings (or seed defaults)
  const { data: existing } = await supabase
    .from('settings')
    .select('data')
    .eq('user_id', user.id)
    .maybeSingle();

  const current = (existing?.data as Record<string, unknown>) || {};

  const unitDefaults =
    unit === 'acres'
      ? { unitSystem: 'acres',    bagFertUnit: 'kg/ac', slurryUnit: 'gal/ac', limeUnit: 't/ac' }
      : { unitSystem: 'hectares', bagFertUnit: 'kg/ha', slurryUnit: 'm3/ha',  limeUnit: 't/ha' };

  const next = {
    ...current,
    ...unitDefaults,
    ...(farmName && farmName.trim() ? { farmName: farmName.trim() } : {}),
    onboarded: true,
  };

  const { error } = await supabase
    .from('settings')
    .upsert({ user_id: user.id, data: next, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save preference: ${error.message}`);

  revalidatePath('/');
  redirect('/');
}

// =====================================================================
// CUSTOM PRODUCTS
// =====================================================================

/**
 * Parse a form-data field that should be a non-negative number, but is
 * allowed to be blank (treated as null). Throws on negative or non-numeric.
 */
function optionalNonNegative(formData: FormData, key: string): number | null {
  const raw = formData.get(key);
  if (raw == null || String(raw).trim() === '') return null;
  const n = parseFloat(String(raw));
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${key}`);
  if (n < 0) throw new Error(`${key} cannot be negative`);
  return n;
}

export async function createCustomProduct(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const name = String(formData.get('name') ?? '').trim();
  const type = String(formData.get('type') ?? '') as 'bag_fert' | 'slurry' | 'solid_manure' | 'lime';
  const returnTo = String(formData.get('return_to') ?? '/products');

  if (!name) throw new Error('Name is required');
  if (!['bag_fert', 'slurry', 'solid_manure', 'lime'].includes(type)) {
    throw new Error('Invalid product type');
  }

  // Build the row from the relevant nutrient columns only. Other branches'
  // columns stay null so the storage convention is preserved.
  //
  // Category default: bag_fert + lime have a single obvious category that
  // matches their type, so they auto-categorise correctly (instead of
  // landing in a separate "Custom" bucket in the picker). Slurry and
  // solid manure have multiple plausible categories (dairy/pig/separated,
  // fym/poultry/biosolids) so we default to 'custom' — user can re-tag
  // later if needed.
  const defaultCategory: ProductCategory =
    type === 'bag_fert' ? 'bag_fert' :
    type === 'lime'     ? 'lime' :
    'custom';
  const row: Record<string, unknown> = {
    user_id: user.id,
    name,
    type,
    category: defaultCategory,
    sort_order: 999,  // sort after RB209 rows in the picker
    dm_pct: optionalNonNegative(formData, 'dm_pct'),
  };

  if (type === 'bag_fert') {
    const bagForm = String(formData.get('form') ?? 'granular') === 'liquid' ? 'liquid' : 'granular';
    row.form = bagForm;
    row.n_pct    = optionalNonNegative(formData, 'n_pct');
    row.p2o5_pct = optionalNonNegative(formData, 'p2o5_pct');
    row.k2o_pct  = optionalNonNegative(formData, 'k2o_pct');
    row.s_pct    = optionalNonNegative(formData, 's_pct');
    if (bagForm === 'liquid') {
      const density = optionalNonNegative(formData, 'density_kg_per_l');
      if (!density || density <= 0) {
        throw new Error('Liquid fertiliser needs a density in kg/L (from the product label)');
      }
      row.density_kg_per_l = density;
    }
  } else if (type === 'slurry') {
    row.n_kg_per_m3    = optionalNonNegative(formData, 'n_kg_per_m3');
    row.p2o5_kg_per_m3 = optionalNonNegative(formData, 'p2o5_kg_per_m3');
    row.k2o_kg_per_m3  = optionalNonNegative(formData, 'k2o_kg_per_m3');
    row.so3_kg_per_m3  = optionalNonNegative(formData, 'so3_kg_per_m3');
    row.mgo_kg_per_m3  = optionalNonNegative(formData, 'mgo_kg_per_m3');
  } else if (type === 'solid_manure') {
    row.n_kg_per_t    = optionalNonNegative(formData, 'n_kg_per_t');
    row.p2o5_kg_per_t = optionalNonNegative(formData, 'p2o5_kg_per_t');
    row.k2o_kg_per_t  = optionalNonNegative(formData, 'k2o_kg_per_t');
    row.so3_kg_per_t  = optionalNonNegative(formData, 'so3_kg_per_t');
    row.mgo_kg_per_t  = optionalNonNegative(formData, 'mgo_kg_per_t');
  }
  // lime: name+type only

  // Note: id is intentionally omitted — the products_id_seq sequence supplies
  // it. RLS enforces user_id = auth.uid() on insert.
  const { error } = await supabase.from('products').insert(row);
  if (error) throw new Error(`Could not save product: ${error.message}`);

  // Bust caches so the new product appears immediately.
  revalidatePath('/products');
  revalidatePath('/');
  // The caller may be the application form on a /fields/[id]/log page;
  // revalidate broadly so the picker repopulates wherever it's used.
  revalidatePath('/', 'layout');

  redirect(returnTo);
}

export async function deleteCustomProduct(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();

  const id = parseInt(String(formData.get('id')), 10);
  if (!Number.isFinite(id)) throw new Error('Invalid product id');

  // A product can't be deleted while any logged application still references it
  // (the application needs the product for its nutrient values, and the FK has
  // no cascade — deleting would either fail at the database or destroy spreading
  // history). Check first and return a clear message instead of crashing.
  const { count, error: countErr } = await supabase
    .from('applications')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', id);
  if (countErr) throw new Error(`Could not check product usage: ${countErr.message}`);
  if ((count ?? 0) > 0) {
    throw new Error(
      `This product is used on ${count} logged application${count === 1 ? '' : 's'}, so it can't be deleted (its spreading history needs it). You can stop using it on the plan instead.`,
    );
  }

  // Scope to the farm owner. RLS also enforces admin-of-owner.
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)
    .eq('user_id', ctx.ownerId);
  if (error) throw new Error(`Could not delete product: ${error.message}`);

  revalidatePath('/products');
  revalidatePath('/', 'layout');
  redirect('/products');
}

// =====================================================================
// GROUPS (blocks of land)
// =====================================================================
//
// Users group fields into named blocks for filtering and reporting.
// One group per field; deletion ungroups affected fields rather than
// removing them (FK ON DELETE SET NULL on fields.group_id).

/** Trim and normalise a group name; throws if empty or too long. */
function normaliseGroupName(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) throw new Error('Group name is required');
  if (s.length > 80) throw new Error('Group name is too long (max 80 chars)');
  return s;
}

export async function createGroup(formData: FormData): Promise<{ id: string; name: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const name = normaliseGroupName(formData.get('name'));

  // Pick a sort_order at the end of the current list so new groups land
  // last rather than jostling the user's existing order.
  const { data: existing } = await supabase
    .from('groups')
    .select('sort_order')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = (existing?.sort_order ?? -1) + 1;

  const { data, error } = await supabase.from('groups').insert({
    user_id: user.id,
    name,
    sort_order: nextSort,
  }).select('id, name').single();
  if (error) {
    if (error.code === '23505') throw new Error(`A group named "${name}" already exists.`);
    throw new Error(`Could not create group: ${error.message}`);
  }

  revalidatePath('/settings/groups');
  revalidatePath('/', 'layout');
  return { id: data.id, name: data.name };
}

export async function renameGroup(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const id = String(formData.get('id') ?? '').trim();
  const name = normaliseGroupName(formData.get('name'));
  if (!id) throw new Error('Group id is required');

  // RLS already blocks updates to other users' rows, but filter user_id
  // explicitly as belt + braces.
  const { error } = await supabase
    .from('groups')
    .update({ name })
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) {
    if (error.code === '23505') throw new Error(`A group named "${name}" already exists.`);
    throw new Error(`Could not rename group: ${error.message}`);
  }

  revalidatePath('/settings/groups');
  revalidatePath('/', 'layout');
}

/**
 * Save a group's optional management profile. All fields optional — clearing
 * them removes the profile. Admin-only (groups are farm-level). Drives soft
 * warnings only; never changes recommended numbers.
 */
export async function saveGroupProfile(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();

  const id = String(formData.get('id') ?? '').trim();
  if (!id) throw new Error('Group id is required');

  const rawType = String(formData.get('management_type') ?? '').trim();
  const management_type =
    rawType === 'silage' || rawType === 'rotational' || rawType === 'maintenance' ? rawType : null;

  const rawMd = String(formData.get('earliest_fert_md') ?? '').trim();
  // Accept a full date (from <input type="date">) or an MM-DD; store MM-DD.
  let earliest_fert_md: string | null = null;
  if (rawMd) {
    const m = rawMd.match(/^\d{4}-(\d{2})-(\d{2})$/) || rawMd.match(/^(\d{2})-(\d{2})$/);
    if (m) earliest_fert_md = `${m[1]}-${m[2]}`;
  }

  const low_input = String(formData.get('low_input') ?? '') === 'on'
    || String(formData.get('low_input') ?? '') === 'true';

  const rawMaxN = String(formData.get('max_n_kg_per_ha') ?? '').trim();
  const max_n_kg_per_ha = rawMaxN ? Math.max(0, Math.round(parseFloat(rawMaxN))) : null;

  const nvz = String(formData.get('nvz') ?? '') === 'on'
    || String(formData.get('nvz') ?? '') === 'true';

  const profile_note = String(formData.get('profile_note') ?? '').trim() || null;

  const rawGrazeN = String(formData.get('graze_n_kg_per_ha') ?? '').trim();
  const graze_n_kg_per_ha = rawGrazeN ? Math.max(0, Math.round(parseFloat(rawGrazeN))) : null;
  const rawGrazeInt = String(formData.get('graze_interval_days') ?? '').trim();
  const graze_interval_days = rawGrazeInt ? Math.max(1, Math.round(parseFloat(rawGrazeInt))) : null;

  const { error } = await supabase
    .from('groups')
    .update({
      management_type, earliest_fert_md, low_input, max_n_kg_per_ha, nvz, profile_note,
      graze_n_kg_per_ha, graze_interval_days,
    })
    .eq('id', id)
    .eq('user_id', ctx.ownerId);
  if (error) throw new Error(`Could not save group profile: ${error.message}`);

  revalidatePath('/settings/groups');
  revalidatePath('/', 'layout');
}

/** Log a plate-meter reading for a field. Members (admin or staff) can log. */
export async function logPlateReading(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireMember();

  const field_id = String(formData.get('field_id') ?? '').trim();
  if (!field_id) throw new Error('Pick a field');

  const reading_date = String(formData.get('reading_date') ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reading_date)) throw new Error('Enter a valid date');

  const coverRaw = String(formData.get('cover_kg_dm_ha') ?? '').trim();
  const cover_kg_dm_ha = coverRaw ? Math.round(parseFloat(coverRaw)) : NaN;
  if (!isFinite(cover_kg_dm_ha) || cover_kg_dm_ha < 0) throw new Error('Enter the cover in kg DM/ha');

  const heightRaw = String(formData.get('height_cm') ?? '').trim();
  const height_cm = heightRaw ? parseFloat(heightRaw) : null;

  const note = String(formData.get('note') ?? '').trim() || null;

  const { error } = await supabase.from('plate_readings').insert({
    user_id: ctx.ownerId,
    field_id,
    reading_date,
    cover_kg_dm_ha,
    height_cm,
    note,
    created_by: ctx.userId,
  });
  if (error) throw new Error(`Could not save reading: ${error.message}`);

  revalidatePath('/grazing');
  revalidatePath(`/fields/${field_id}`);
  revalidatePath('/reports/grazing-history');
}

/** Delete a plate-meter reading. */
export async function deletePlateReading(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireMember();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) throw new Error('Missing reading id');
  const { error } = await supabase
    .from('plate_readings')
    .delete()
    .eq('id', id)
    .eq('user_id', ctx.ownerId);
  if (error) throw new Error(`Could not delete reading: ${error.message}`);
  revalidatePath('/grazing');
  revalidatePath('/reports/grazing-history');
}

/** Log a grazing event (weekly-walk model). You record the residual the paddock
 *  was grazed to; the pre-grazing cover is taken from the latest plate reading
 *  in the report. Members (admin or staff) can log. */
export async function logGrazingEvent(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireMember();

  const field_id = String(formData.get('field_id') ?? '').trim();
  if (!field_id) throw new Error('Pick a field');

  const graze_date = String(formData.get('graze_date') ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(graze_date)) throw new Error('Enter a valid date');

  const postRaw = String(formData.get('post_cover_kg_dm_ha') ?? '').trim();
  const post = postRaw ? Math.round(parseFloat(postRaw)) : NaN;
  if (!isFinite(post) || post < 0) throw new Error('Enter the residual left after grazing (kg DM/ha)');

  // Optional measured pre-cover; normally omitted and derived from readings.
  const preRaw = String(formData.get('pre_cover_kg_dm_ha') ?? '').trim();
  const pre = preRaw ? Math.round(parseFloat(preRaw)) : null;

  const note = String(formData.get('note') ?? '').trim() || null;

  const { error } = await supabase.from('grazing_events').insert({
    user_id: ctx.ownerId,
    field_id,
    graze_date,
    post_cover_kg_dm_ha: post,
    pre_cover_kg_dm_ha: pre,
    note,
    created_by: ctx.userId,
  });
  if (error) throw new Error(`Could not save grazing: ${error.message}`);

  revalidatePath('/grazing');
  revalidatePath(`/fields/${field_id}`);
  revalidatePath('/reports/grazing-history');
}

/** Delete a grazing event. */
export async function deleteGrazingEvent(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireMember();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) throw new Error('Missing event id');
  const { error } = await supabase
    .from('grazing_events')
    .delete()
    .eq('id', id)
    .eq('user_id', ctx.ownerId);
  if (error) throw new Error(`Could not delete grazing: ${error.message}`);
  revalidatePath('/grazing');
  revalidatePath('/reports/grazing-history');
}

export async function deleteGroup(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const id = String(formData.get('id') ?? '').trim();
  if (!id) throw new Error('Group id is required');

  // ON DELETE SET NULL on fields.group_id means affected fields just
  // become ungrouped, no extra cleanup needed.
  const { error } = await supabase
    .from('groups')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw new Error(`Could not delete group: ${error.message}`);

  revalidatePath('/settings/groups');
  revalidatePath('/', 'layout');
}

/**
 * Move a group up or down one slot in the sort order. Swaps sort_order
 * with the adjacent group rather than rebuilding the whole sequence —
 * less data to write and works with concurrent edits.
 *
 * Direction is 'up' (smaller sort_order, appears earlier) or 'down'.
 */
export async function moveGroup(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const id = String(formData.get('id') ?? '').trim();
  const direction = String(formData.get('direction') ?? '') as 'up' | 'down';
  if (!id) throw new Error('Group id is required');
  if (direction !== 'up' && direction !== 'down') throw new Error('Invalid direction');

  // Fetch current group + neighbour in one round-trip each.
  const { data: current } = await supabase
    .from('groups')
    .select('id, sort_order')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!current) return; // silently no-op if missing

  // Find the immediate neighbour in the requested direction.
  // 'up'   = neighbour with the largest sort_order that's < current.sort_order
  // 'down' = neighbour with the smallest sort_order that's > current.sort_order
  const neighbourQuery = supabase
    .from('groups')
    .select('id, sort_order')
    .eq('user_id', user.id);
  const { data: neighbour } = direction === 'up'
    ? await neighbourQuery
        .lt('sort_order', current.sort_order)
        .order('sort_order', { ascending: false })
        .limit(1).maybeSingle()
    : await neighbourQuery
        .gt('sort_order', current.sort_order)
        .order('sort_order', { ascending: true })
        .limit(1).maybeSingle();
  if (!neighbour) return; // already at top/bottom — no-op

  // Swap. Two updates; not transactional but worst case is a momentary
  // out-of-order state that the next read fixes.
  await supabase.from('groups').update({ sort_order: neighbour.sort_order })
    .eq('id', current.id).eq('user_id', user.id);
  await supabase.from('groups').update({ sort_order: current.sort_order })
    .eq('id', neighbour.id).eq('user_id', user.id);

  revalidatePath('/settings/groups');
  revalidatePath('/', 'layout');
}

/**
 * Change a single field's group assignment. Used from the field detail page
 * and the field add/edit form. Empty string clears the group (sets to null).
 */
export async function setFieldGroup(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const fieldId = String(formData.get('field_id') ?? '').trim();
  if (!fieldId) throw new Error('Field id is required');
  const rawGroupId = String(formData.get('group_id') ?? '').trim();
  const groupId: string | null = rawGroupId === '' ? null : rawGroupId;

  const { error } = await supabase
    .from('fields')
    .update({ group_id: groupId, updated_at: new Date().toISOString() })
    .eq('id', fieldId)
    .eq('user_id', user.id);
  if (error) throw new Error(`Could not update group: ${error.message}`);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
  revalidatePath('/settings/groups');
}
/**
 * Replace a group's membership wholesale. The provided fieldIds become the
 * new set of fields belonging to the group; anything previously in the
 * group that's not in the list gets ungrouped.
 *
 * Two-statement approach (not transactional but the worst case is a brief
 * intermediate state):
 *   1. Clear the group from any field currently in it that's not in the new
 *      list — `group_id = null where group_id = :groupId and id not in :keep`
 *   2. Assign the group to all fields in the new list (covers both "new
 *      additions" and idempotent re-assigns of existing members) —
 *      `group_id = :groupId where id in :fieldIds and user_id = :user`
 *
 * The user_id filter on step 2 is essential — it stops a malicious caller
 * from grabbing fields they don't own. Step 1 is implicitly safe because
 * the group itself is filtered to the user via RLS.
 */
export async function setGroupMembership(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const groupId = String(formData.get('group_id') ?? '').trim();
  if (!groupId) throw new Error('Group id is required');

  // Parse the comma-separated field IDs. Empty string is valid — means
  // "no fields in this group".
  const fieldIdsRaw = String(formData.get('field_ids') ?? '').trim();
  const fieldIds = fieldIdsRaw === '' ? [] : fieldIdsRaw.split(',').filter(Boolean);

  // Verify the group belongs to this user — RLS would block the writes
  // anyway, but failing loudly here gives a better error message.
  const { data: groupRow, error: groupErr } = await supabase
    .from('groups')
    .select('id')
    .eq('id', groupId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (groupErr || !groupRow) throw new Error('Group not found or not yours');

  // Step 1: ungroup any field currently in the group that's not in the new list.
  // PostgREST's `not.in` expects `(a,b,c)` — empty list means "remove all".
  if (fieldIds.length === 0) {
    const { error } = await supabase
      .from('fields')
      .update({ group_id: null, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('group_id', groupId);
    if (error) throw new Error(`Could not clear group: ${error.message}`);
  } else {
    const { error } = await supabase
      .from('fields')
      .update({ group_id: null, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('group_id', groupId)
      .not('id', 'in', `(${fieldIds.map((id) => `"${id}"`).join(',')})`);
    if (error) throw new Error(`Could not clear removed fields: ${error.message}`);

    // Step 2: assign the group to the new list. Idempotent — existing
    // members get set to the same value, new additions get the new value,
    // fields moved from another group get reassigned.
    const { error: assignErr } = await supabase
      .from('fields')
      .update({ group_id: groupId, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .in('id', fieldIds);
    if (assignErr) throw new Error(`Could not assign fields: ${assignErr.message}`);
  }

  revalidatePath('/settings/groups');
  revalidatePath(`/settings/groups/${groupId}`);
  revalidatePath('/');
  revalidatePath('/activity');
  revalidatePath('/reports/spreading');
  revalidatePath('/reports/grazing');
}

/**
 * Set every field in a group to a grazing plan — each field's planned_cuts
 * become all 'grazing' (keeping its existing cut_profile length, min 1). This
 * makes a whole grazing block show on the grazing top-up report in one go,
 * instead of editing each field's plan by hand.
 *
 * Only touches planned_cuts (and normalises a 0/empty profile to 1). Does NOT
 * change a field's logged cuts — a field with a recent non-grazing cut keeps
 * that cut's next_action until its next grazing round is logged.
 */
export async function setGroupToGrazing(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await requireAdmin();

  const groupId = String(formData.get('group_id') ?? '').trim();
  if (!groupId) throw new Error('Group id is required');

  // Confirm the group is the user's (clearer error than an RLS failure).
  const { data: groupRow, error: groupErr } = await supabase
    .from('groups')
    .select('id')
    .eq('id', groupId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (groupErr || !groupRow) throw new Error('Group not found or not yours');

  // Fetch the group's fields — need each cut_profile to size planned_cuts.
  const { data: groupFields, error: fieldsErr } = await supabase
    .from('fields')
    .select('id, cut_profile')
    .eq('user_id', user.id)
    .eq('group_id', groupId);
  if (fieldsErr) throw new Error(`Could not load group fields: ${fieldsErr.message}`);

  const now = new Date().toISOString();
  for (const f of groupFields ?? []) {
    const profile = Math.max(1, Number(f.cut_profile) || 1);
    const plannedCuts: CutType[] = Array(profile).fill('grazing');
    const { error } = await supabase
      .from('fields')
      .update({ cut_profile: profile, planned_cuts: plannedCuts, updated_at: now })
      .eq('id', f.id)
      .eq('user_id', user.id);
    if (error) throw new Error(`Could not update field: ${error.message}`);
  }

  revalidatePath('/');
  revalidatePath('/reports/grazing');
  revalidatePath('/reports/spreading');
  revalidatePath('/settings/groups');
  revalidatePath(`/settings/groups/${groupId}`);
}

export async function setFieldToGrazing(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await requireAdmin();

  const fieldId = String(formData.get('field_id') ?? '').trim();
  if (!fieldId) throw new Error('Field id is required');

  const { data: fieldRow, error: fieldErr } = await supabase
    .from('fields')
    .select('id, cut_profile')
    .eq('id', fieldId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (fieldErr || !fieldRow) throw new Error('Field not found or not yours');

  const profile = Math.max(1, Number(fieldRow.cut_profile) || 1);
  const plannedCuts: CutType[] = Array(profile).fill('grazing');
  const { error } = await supabase
    .from('fields')
    .update({ cut_profile: profile, planned_cuts: plannedCuts, updated_at: new Date().toISOString() })
    .eq('id', fieldId)
    .eq('user_id', user.id);
  if (error) throw new Error(`Could not update field: ${error.message}`);

  revalidatePath('/');
  revalidatePath('/reports/grazing');
  revalidatePath('/reports/spreading');
  revalidatePath(`/fields/${fieldId}`);
}
// =====================================================================
//
// Library has shared seeds (user_id NULL) shipped by migration plus
// user-owned custom rows users can add via Settings → Grass systems.
//
// Shared rows are read-only — RLS blocks user-side INSERT/UPDATE/DELETE
// on user_id=NULL rows. Editing a shared row uses `forkGrassSystem` which
// creates a user-owned copy with the same defaults.
//
// Per-user visibility (hiding shared systems from the dropdown) lives in
// `settings.hiddenGrassSystemIds` — toggled via `setGrassSystemHidden`.

/** Normalise a system name; throws if invalid. */
function normaliseSystemName(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) throw new Error('System name is required');
  if (s.length > 80) throw new Error('System name is too long (max 80 chars)');
  return s;
}

/**
 * Parse numeric field from form data, with clamping bounds. Throws on
 * unparseable input.
 */
function parseSystemNumber(
  raw: unknown,
  fieldName: string,
  min: number,
  max: number,
): number {
  const n = parseFloat(String(raw ?? ''));
  if (!Number.isFinite(n)) throw new Error(`${fieldName} must be a number`);
  if (n < min || n > max) throw new Error(`${fieldName} must be between ${min} and ${max}`);
  return n;
}

/**
 * Create a user-owned custom grass system. Use this directly for a brand-new
 * custom system; for forking a shared seed see forkGrassSystem.
 */
export async function createGrassSystem(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const name = normaliseSystemName(formData.get('name'));
  const shortLabel = String(formData.get('short_label') ?? '').trim() || name;
  const description = String(formData.get('description') ?? '').trim() || null;
  const nCap = parseSystemNumber(formData.get('n_cap_kg_per_ha'), 'N cap', 0, 1000);
  const nMult = parseSystemNumber(formData.get('n_target_multiplier'), 'N target multiplier', 0.01, 2);
  const kMult = parseSystemNumber(formData.get('k_multiplier'), 'K multiplier', 0.01, 2);
  const isLegume = formData.get('is_legume_rich') === 'on' || formData.get('is_legume_rich') === 'true';

  const { error } = await supabase.from('grass_systems').insert({
    user_id: user.id,
    seed_key: null,
    name,
    short_label: shortLabel,
    description,
    n_cap_kg_per_ha: nCap,
    n_target_multiplier: nMult,
    k_multiplier: kMult,
    is_legume_rich: isLegume,
    sort_order: 1000,  // user-owned sorts after shared seeds
  });
  if (error) {
    if (error.code === '23505') throw new Error(`A grass system named "${name}" already exists.`);
    throw new Error(`Could not create grass system: ${error.message}`);
  }

  revalidatePath('/settings/grass-systems');
  revalidatePath('/', 'layout');
}

/**
 * Update a user-owned grass system. RLS blocks updates on shared rows so
 * the user_id filter is belt+braces. Use forkGrassSystem to "edit" a
 * shared row — it creates a custom copy the user owns.
 */
export async function updateGrassSystem(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const id = String(formData.get('id') ?? '').trim();
  if (!id) throw new Error('System id is required');
  const name = normaliseSystemName(formData.get('name'));
  const shortLabel = String(formData.get('short_label') ?? '').trim() || name;
  const description = String(formData.get('description') ?? '').trim() || null;
  const nCap = parseSystemNumber(formData.get('n_cap_kg_per_ha'), 'N cap', 0, 1000);
  const nMult = parseSystemNumber(formData.get('n_target_multiplier'), 'N target multiplier', 0.01, 2);
  const kMult = parseSystemNumber(formData.get('k_multiplier'), 'K multiplier', 0.01, 2);
  const isLegume = formData.get('is_legume_rich') === 'on' || formData.get('is_legume_rich') === 'true';

  const { error } = await supabase
    .from('grass_systems')
    .update({
      name,
      short_label: shortLabel,
      description,
      n_cap_kg_per_ha: nCap,
      n_target_multiplier: nMult,
      k_multiplier: kMult,
      is_legume_rich: isLegume,
    })
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) {
    if (error.code === '23505') throw new Error(`A grass system named "${name}" already exists.`);
    throw new Error(`Could not update grass system: ${error.message}`);
  }

  revalidatePath('/settings/grass-systems');
  revalidatePath('/', 'layout');
}

/**
 * Delete a user-owned grass system. Fields referencing it get group_id set
 * to NULL via the FK's ON DELETE SET NULL. Shared rows can't be deleted —
 * RLS blocks it; the user_id filter here is belt+braces.
 */
export async function deleteGrassSystem(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const id = String(formData.get('id') ?? '').trim();
  if (!id) throw new Error('System id is required');

  const { error } = await supabase
    .from('grass_systems')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw new Error(`Could not delete grass system: ${error.message}`);

  revalidatePath('/settings/grass-systems');
  revalidatePath('/', 'layout');
}

/**
 * Fork a shared system into a user-owned copy. Copies the shared row's
 * values into a new user-owned row, with " (custom)" appended to the
 * name to avoid the unique constraint. The user can rename it afterwards.
 */
export async function forkGrassSystem(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const sourceId = String(formData.get('source_id') ?? '').trim();
  if (!sourceId) throw new Error('Source system id is required');

  // Load the source — RLS lets us read it whether it's shared or own.
  const { data: source, error: loadErr } = await supabase
    .from('grass_systems')
    .select('*')
    .eq('id', sourceId)
    .maybeSingle();
  if (loadErr || !source) throw new Error('Source system not found');

  // Pick a unique name. Try " (custom)", then " (custom 2)" etc.
  let attempt = 0;
  let newName = `${source.name} (custom)`;
  while (attempt < 20) {
    const { data: clash } = await supabase
      .from('grass_systems')
      .select('id')
      .eq('user_id', user.id)
      .eq('name', newName)
      .maybeSingle();
    if (!clash) break;
    attempt++;
    newName = `${source.name} (custom ${attempt + 1})`;
  }

  const { data: created, error: insertErr } = await supabase.from('grass_systems').insert({
    user_id: user.id,
    seed_key: null,
    name: newName,
    short_label: source.short_label,
    description: source.description,
    n_cap_kg_per_ha: source.n_cap_kg_per_ha,
    n_target_multiplier: source.n_target_multiplier,
    k_multiplier: source.k_multiplier,
    is_legume_rich: source.is_legume_rich,
    sort_order: 1000,
  }).select('id').single();
  if (insertErr || !created) throw new Error(`Could not fork: ${insertErr?.message}`);

  revalidatePath('/settings/grass-systems');
  revalidatePath('/', 'layout');
  return { id: created.id, name: newName };
}

/**
 * Toggle visibility for a grass system in the user's dropdown. Stored in
 * settings.hiddenGrassSystemIds (array of system IDs). hidden=true adds
 * the id to the array; hidden=false removes it.
 */
export async function setGrassSystemHidden(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const systemId = String(formData.get('system_id') ?? '').trim();
  if (!systemId) throw new Error('System id is required');
  const hidden = formData.get('hidden') === 'true' || formData.get('hidden') === 'on';

  // Load current settings, merge, write back.
  const { data: row, error: loadErr } = await supabase
    .from('settings')
    .select('data')
    .eq('user_id', user.id)
    .maybeSingle();
  if (loadErr) throw new Error(`Could not load settings: ${loadErr.message}`);
  const current = (row?.data ?? {}) as Record<string, unknown>;
  const hidden_set = new Set<string>(
    Array.isArray(current.hiddenGrassSystemIds) ? (current.hiddenGrassSystemIds as string[]) : [],
  );
  if (hidden) hidden_set.add(systemId);
  else hidden_set.delete(systemId);
  const nextData = { ...current, hiddenGrassSystemIds: Array.from(hidden_set) };

  const { error } = await supabase
    .from('settings')
    .upsert({ user_id: user.id, data: nextData, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save visibility: ${error.message}`);

  revalidatePath('/settings/grass-systems');
  revalidatePath('/', 'layout');
}

/**
 * Change a single field's grass system assignment. Used from the field
 * detail page and the field forms. Empty string clears (sets to null).
 */
export async function setFieldGrassSystem(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const fieldId = String(formData.get('field_id') ?? '').trim();
  if (!fieldId) throw new Error('Field id is required');
  const raw = String(formData.get('grass_system_id') ?? '').trim();
  const grassSystemId: string | null = raw === '' ? null : raw;

  const { error } = await supabase
    .from('fields')
    .update({ grass_system_id: grassSystemId, updated_at: new Date().toISOString() })
    .eq('id', fieldId)
    .eq('user_id', user.id);
  if (error) throw new Error(`Could not update grass system: ${error.message}`);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
  revalidatePath('/reports/spreading');
  revalidatePath('/reports/grazing');
  revalidatePath('/reports/snapshot');
}

/**
 * Update the `next_action` on a specific cut. Used by the field detail
 * page's "what's next" dropdown so users can change their mind without
 * having to log a new cut. RLS plus user_id filter prevent edits to
 * other users' cuts.
 */
export async function setCutNextAction(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const cutId = String(formData.get('cut_id') ?? '').trim();
  if (!cutId) throw new Error('Cut id is required');
  const fieldId = String(formData.get('field_id') ?? '').trim();
  const VALID_NEXT_ACTIONS = ['another_cut_silage','another_cut_bales','rotational_grazing','maintenance_grazing'];
  const raw = String(formData.get('next_action') ?? '');
  const nextAction: string | null = VALID_NEXT_ACTIONS.includes(raw) ? raw : null;

  const { error } = await supabase
    .from('cuts').update({ next_action: nextAction })
    .eq('id', cutId).eq('user_id', user.id);
  if (error) throw new Error(`Could not update next action: ${error.message}`);

  if (fieldId) revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
  revalidatePath('/reports/spreading');
  revalidatePath('/reports/grazing');
  revalidatePath('/reports/snapshot');
}

/**
 * Batch-create cuts across multiple fields in one transaction.
 *
 * Form data shape:
 *   - cut_date: single ISO date for all rows
 *   - rows: JSON-encoded array of per-field row state:
 *       [{ field_id, cut_number, cut_type, yield_class, next_action }, ...]
 *
 * cut_number is supplied by the client (computed from field's existing
 * season cut count + 1). Validated server-side against an upper bound of
 * the field's cut_profile to prevent over-cut.
 *
 * Behaviour:
 *   - Empty rows array → throw (form should prevent this)
 *   - On any validation failure → throw, nothing written (atomic via
 *     Supabase batch insert)
 *   - On success → revalidate paths, redirect to /activity
 */
export async function saveBatchCuts(formData: FormData) {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');

  const cutDate = String(formData.get('cut_date') ?? '').trim();
  if (!cutDate || !/^\d{4}-\d{2}-\d{2}$/.test(cutDate)) {
    throw new Error('Cut date is required and must be a valid date');
  }

  const rowsJson = String(formData.get('rows') ?? '');
  let rows: Array<{
    field_id: string;
    cut_number: number;
    cut_type: string;
    yield_class: string;
    next_action: string | null;
  }>;
  try {
    rows = JSON.parse(rowsJson);
  } catch {
    throw new Error('Could not parse batch rows — try again');
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Pick at least one field before saving');
  }

  // Validate every row before any insert. Cheaper than a Supabase round
  // trip and gives one clear error message instead of a DB constraint
  // failure.
  const VALID_CUT_TYPES = new Set(['silage', 'bales', 'grazing']);
  const VALID_YIELD_CLASSES = new Set(['light', 'average', 'heavy']);
  const VALID_NEXT_ACTIONS = new Set([
    'another_cut_silage', 'another_cut_bales', 'rotational_grazing', 'maintenance_grazing',
  ]);

  // Load the farm's fields once to validate field membership + cut_profile
  // limits. Fields belong to the farm owner.
  const { data: userFields, error: fieldsErr } = await supabase
    .from('fields')
    .select('id, cut_profile')
    .eq('user_id', ctx.ownerId);
  if (fieldsErr) throw new Error(`Could not load fields: ${fieldsErr.message}`);
  const userFieldById = new Map<string, { id: string; cut_profile: number }>(
    (userFields ?? []).map((f) => [f.id, f as { id: string; cut_profile: number }]),
  );

  const inserts: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    if (!r.field_id || typeof r.field_id !== 'string') {
      throw new Error('Row missing field id');
    }
    const f = userFieldById.get(r.field_id);
    if (!f) {
      throw new Error(`Field ${r.field_id} not found or not owned`);
    }
    if (!VALID_CUT_TYPES.has(r.cut_type)) {
      throw new Error(`Invalid cut type: ${r.cut_type}`);
    }
    if (!VALID_YIELD_CLASSES.has(r.yield_class)) {
      throw new Error(`Invalid yield class: ${r.yield_class}`);
    }
    if (r.next_action !== null && !VALID_NEXT_ACTIONS.has(r.next_action)) {
      throw new Error(`Invalid next action: ${r.next_action}`);
    }
    const cutNumber = Number(r.cut_number);
    if (!Number.isInteger(cutNumber) || cutNumber < 1 || cutNumber > f.cut_profile) {
      throw new Error(`Cut number ${cutNumber} out of range for field ${r.field_id} (profile ${f.cut_profile})`);
    }
    inserts.push({
      user_id: ctx.ownerId,
      created_by: ctx.userId,
      field_id: r.field_id,
      cut_number: cutNumber,
      cut_date: cutDate,
      cut_type: r.cut_type,
      yield_class: r.yield_class,
      next_action: r.next_action,
      // Notes intentionally omitted — batch entry skips per-row notes for
      // speed; the user can add them later via the cut edit page.
    });
  }

  const { error: insertErr } = await supabase.from('cuts').insert(inserts);
  if (insertErr) throw new Error(`Could not save batch: ${insertErr.message}`);

  // Renumber every affected field so cut_number reflects chronological order.
  const affectedFieldIds = Array.from(new Set(rows.map((r) => r.field_id)));
  for (const fId of affectedFieldIds) {
    await renumberCutsForField(supabase, ctx.ownerId, fId);
  }

  revalidatePath('/activity');
  revalidatePath('/');
  revalidatePath('/reports/spreading');
  revalidatePath('/reports/grazing');
  revalidatePath('/reports/snapshot');
  // Each affected field's detail page may show a different last cut.
  for (const r of rows) revalidatePath(`/fields/${r.field_id}`);

  redirect(`/activity?flash=cuts_logged&count=${rows.length}`);
}

// =====================================================================
// Multi-user farm: Team management (admin) + join flow (staff)
// =====================================================================

/**
 * Generate a short, readable invite code (no ambiguous chars). Admin-only.
 * Creates a farm_invites row owned by the admin's farm; staff redeem it via
 * redeemInvite to join as staff.
 */
function generateInviteCode(): string {
  // Avoid 0/O, 1/I/L to keep codes easy to read aloud.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export async function createFarmInvite(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();

  const label = formData.get('label') ? String(formData.get('label')).trim() : null;

  // Try a few times in the vanishingly unlikely event of a code collision.
  let lastErr: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode();
    const { error } = await supabase.from('farm_invites').insert({
      owner_id: ctx.ownerId,
      code,
      role: 'staff',
      label,
    });
    if (!error) {
      revalidatePath('/settings/team');
      return;
    }
    lastErr = error.message;
  }
  throw new Error(`Could not create invite: ${lastErr ?? 'unknown error'}`);
}

export async function deleteFarmInvite(formData: FormData) {
  const supabase = createClient();
  await requireAdmin();

  const id = String(formData.get('id'));
  if (!id) throw new Error('Missing invite id');
  const { error } = await supabase.from('farm_invites').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/settings/team');
}

export async function removeFarmMember(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();

  const memberId = String(formData.get('member_id'));
  if (!memberId) throw new Error('Missing member id');
  // Don't let an admin remove themselves here (would orphan the farm).
  if (memberId === ctx.userId) {
    throw new Error('You cannot remove yourself from your own farm.');
  }
  const { error } = await supabase
    .from('farm_members')
    .delete()
    .eq('owner_id', ctx.ownerId)
    .eq('member_id', memberId);
  if (error) throw new Error(error.message);
  revalidatePath('/settings/team');
}

/**
 * Staff redeem an invite code to join a farm. Calls the SECURITY DEFINER RPC
 * which validates the code and creates the membership. Returns nothing on
 * success (redirects home); throws with a friendly message on failure.
 */
export async function redeemInvite(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const code = String(formData.get('code') || '').trim().toUpperCase();
  if (!code) throw new Error('Enter an invite code');

  const { data, error } = await supabase.rpc('redeem_farm_invite', { p_code: code });
  if (error) throw new Error(error.message);
  const result = data as { ok: boolean; error?: string };
  if (!result?.ok) {
    throw new Error(result?.error || 'Could not join farm');
  }

  revalidatePath('/');
  revalidatePath('/settings');
  redirect('/?joined=1');
}


export async function setFieldSoilType(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await requireAdmin();

  const fieldId = String(formData.get('field_id') ?? '').trim();
  if (!fieldId) throw new Error('Field id is required');
  const raw = String(formData.get('soil_type') ?? '');
  const VALID_SOIL_TYPES = ['light_sand', 'medium_loam', 'heavy_clay', 'deep_silt', 'organic', 'peaty'];
  if (!VALID_SOIL_TYPES.includes(raw)) throw new Error('Invalid soil type');

  const { error } = await supabase
    .from('fields')
    .update({ soil_type: raw, updated_at: new Date().toISOString() })
    .eq('id', fieldId)
    .eq('user_id', user.id);
  if (error) throw new Error(`Could not update soil type: ${error.message}`);

  revalidatePath('/reports/lime');
  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
}
