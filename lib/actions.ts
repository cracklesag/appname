'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { getFarmContext, requireAdmin, requireMember, requireAgronomistFor, AGRONOMIST_FARM_COOKIE } from '@/lib/farm';
import { CutType, ProductCategory, YieldClass, ApplicationMethod, RateUnit, Product, ProductAnalysis } from '@/lib/types';
import { polygonAreaHectares, type FieldGeometry } from '@/lib/geo';
import { coverageFraction, RECONCILE_COVERAGE_THRESHOLD } from '@/lib/partials';
import { loadSettings } from '@/lib/data';
import { suggestSoilTypeFromExtras } from '@/lib/soil-suggest';
import { STARTER_PRODUCTS } from '@/lib/starter-products';
import { jobTypeDef } from '@/lib/jobTypes';
import { randomBytes, timingSafeEqual } from 'crypto';
import { sendPushToUser } from '@/lib/push';
import { getSeasonStart } from '@/lib/rules';
import {
  clampNotes, isValidIsoDate, RATE_UNITS_BY_TYPE, VALID_APPLICATION_METHODS,
  FIELD_RANGES, NOTES_MAX_LEN,
} from '@/lib/validation';

/**
 * Server-side structural validation for a single application write. The
 * client forms warn/block too, but a crafted POST bypasses them — the lovely
 * ranges in lib/validation.ts were enforced nowhere on the server until now.
 * Verifies: real calendar date, finite positive rate, the rate unit is legal
 * FOR THE PRODUCT'S TYPE, the method (if any) is a known value, and that the
 * field and product actually exist on this farm (RLS scopes the reads, so a
 * foreign UUID comes back null). Returns the product type for callers that
 * need it. Throws a clean message on any failure.
 */
async function validateApplicationInput(
  supabase: ReturnType<typeof createClient>,
  args: { fieldId: string; productId: number; dateApplied: string; rateValue: number; rateUnit: string; method: string | null },
): Promise<{ productType: keyof typeof RATE_UNITS_BY_TYPE }> {
  if (!isValidIsoDate(args.dateApplied)) throw new Error('Invalid date — use the date picker');
  if (!Number.isFinite(args.rateValue) || args.rateValue <= 0) throw new Error('Rate must be a number greater than 0');
  if (args.method != null && !VALID_APPLICATION_METHODS.includes(args.method)) {
    throw new Error('Unknown application method');
  }
  const [{ data: fieldRow }, { data: productRow }] = await Promise.all([
    supabase.from('fields').select('id').eq('id', args.fieldId).maybeSingle(),
    supabase.from('products').select('id, type').eq('id', args.productId).maybeSingle(),
  ]);
  if (!fieldRow) throw new Error('That field was not found on your farm');
  if (!productRow) throw new Error('That product was not found');
  const productType = (productRow as { type: string }).type as keyof typeof RATE_UNITS_BY_TYPE;
  const allowed = RATE_UNITS_BY_TYPE[productType];
  if (!allowed || !allowed.includes(args.rateUnit)) {
    throw new Error(`'${args.rateUnit}' is not a valid rate unit for this product`);
  }
  return { productType };
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
  const seasonStart = getSeasonStart();
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
  const notes = clampNotes(formData.get('notes'));

  if (!fieldId || !productId || !dateApplied || !rateValue || rateValue <= 0) {
    throw new Error('Missing required fields');
  }
  await validateApplicationInput(supabase, { fieldId, productId, dateApplied, rateValue, rateUnit, method });

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
export async function reconcileFieldPartials(fieldId: string) {
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
  // Coverage threshold is configurable in Settings -> Part-field spreading.
  const settings = await loadSettings();
  const threshold = (settings.spreadCoverageThresholdPct ?? Math.round(RECONCILE_COVERAGE_THRESHOLD * 100)) / 100;
  const reconciled =
    !!boundary && geoms.length > 0 &&
    coverageFraction(boundary, geoms) >= threshold;

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
  const notes = clampNotes(formData.get('notes'));

  if (!productId || !isValidIsoDate(dateApplied)) {
    throw new Error('Pick a product and a valid date');
  }
  if (method != null && !VALID_APPLICATION_METHODS.includes(method)) {
    throw new Error('Unknown application method');
  }
  // The product must exist (RLS-scoped read) and every row's unit must be
  // legal for ITS type — the global unit list alone let a slurry go in as
  // kg/ha, which silently wrecks the nutrient maths.
  const { data: batchProduct } = await supabase.from('products').select('id, type').eq('id', productId).maybeSingle();
  if (!batchProduct) throw new Error('That product was not found');
  const batchUnits = RATE_UNITS_BY_TYPE[(batchProduct as { type: string }).type as keyof typeof RATE_UNITS_BY_TYPE] ?? [];

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
    if (!VALID_UNITS.has(r.rate_unit) || !batchUnits.includes(r.rate_unit)) {
      throw new Error(`Invalid rate unit for this product: ${r.rate_unit}`);
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
  const notes = clampNotes(formData.get('notes'));

  if (!id || !fieldId || !productId || !dateApplied || !rateValue || rateValue <= 0) {
    throw new Error('Missing required fields');
  }
  await validateApplicationInput(supabase, { fieldId, productId, dateApplied, rateValue, rateUnit, method });

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

const NEXT_ACTION_TO_KIND: Record<string, 'silage' | 'grazing' | 'maintenance'> = {
  another_cut_silage: 'silage',
  another_cut_bales: 'silage',
  rotational_grazing: 'grazing',
  maintenance_grazing: 'maintenance',
};

/**
 * Keep a field's allocation TYPE in step with how it's being run. After any cut
 * change we read the field's most-recent cut; its next_action implies a kind
 * (silage / grazing / maintenance) and we switch the field's allocation_type_id
 * to a type of that kind — UNLESS the current type is already that kind (so a
 * deliberately-chosen custom of the right kind is left alone). Picks the seeded
 * type of the kind for predictability; if none exists, any of that kind. No
 * matching type → no change. Uses the service client (owner-scoped) so it works
 * whoever logged the cut, since it's an automatic consequence of logging rather
 * than a manual type edit.
 */
async function syncFieldAllocationTypeFromCuts(ownerId: string, fieldId: string): Promise<void> {
  if (!ownerId || !fieldId) return;
  const svc = createServiceClient();

  const { data: cuts } = await svc
    .from('cuts').select('cut_date, cut_number, next_action')
    .eq('user_id', ownerId).eq('field_id', fieldId);
  if (!cuts || cuts.length === 0) return;
  const latest = [...cuts].sort((a, b) =>
    a.cut_date !== b.cut_date
      ? String(b.cut_date).localeCompare(String(a.cut_date))
      : (b.cut_number as number) - (a.cut_number as number),
  )[0];
  const targetKind = latest.next_action ? NEXT_ACTION_TO_KIND[latest.next_action as string] : undefined;
  if (!targetKind) return; // null next_action (pre-feature data) → leave as-is

  const { data: field } = await svc
    .from('fields').select('allocation_type_id').eq('id', fieldId).eq('user_id', ownerId).maybeSingle();
  if (!field) return;
  const currentTypeId = (field as { allocation_type_id: string | null }).allocation_type_id;

  if (currentTypeId) {
    const { data: cur } = await svc
      .from('allocation_types').select('kind, dressing_rhythm').eq('id', currentTypeId).maybeSingle();
    const curRow = cur as { kind: string; dressing_rhythm: string } | null;
    // Review-only types (e.g. Low input) are a deliberate manual choice that a
    // cut can't express — never auto-reclassify a field away from them.
    if (curRow?.dressing_rhythm === 'none') return;
    if (curRow?.kind === targetKind) return; // already the right kind
  }

  const { data: candidates } = await svc
    .from('allocation_types').select('id, user_id, sort_order')
    .eq('kind', targetKind).or(`user_id.is.null,user_id.eq.${ownerId}`)
    .order('sort_order', { ascending: true });
  if (!candidates || candidates.length === 0) return; // nothing of that kind to switch to
  const seeded = candidates.find((c) => (c as { user_id: string | null }).user_id === null);
  const targetId = ((seeded ?? candidates[0]) as { id: string }).id;
  if (targetId === currentTypeId) return;

  await svc.from('fields')
    .update({ allocation_type_id: targetId, updated_at: new Date().toISOString() })
    .eq('id', fieldId).eq('user_id', ownerId);
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
  const notes = clampNotes(formData.get('notes'));
  // What's next for this field. Stays nullable for legacy callers / older
  // forms that don't post the field; defaults to null then.
  const VALID_NEXT_ACTIONS = ['another_cut_silage','another_cut_bales','rotational_grazing','maintenance_grazing'];
  const rawNextAction = String(formData.get('next_action') ?? '');
  const nextAction: string | null = VALID_NEXT_ACTIONS.includes(rawNextAction) ? rawNextAction : null;

  if (!fieldId || !cutNumber || !cutDate) throw new Error('Missing required fields');
  if (!isValidIsoDate(cutDate)) throw new Error('Invalid date — use the date picker');
  if (!['silage', 'bales', 'grazing'].includes(cutType)) throw new Error('Unknown cut type');
  if (!['light', 'average', 'heavy'].includes(yieldClass)) throw new Error('Unknown yield class');
  if (!Number.isFinite(cutNumber) || cutNumber < 1 || cutNumber > 10) throw new Error('Cut number must be 1–10');

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
  await syncFieldAllocationTypeFromCuts(ctx.ownerId, fieldId);

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
  const notes = clampNotes(formData.get('notes'));
  // Same as saveCut — accept next_action, fall back to null when missing.
  const VALID_NEXT_ACTIONS = ['another_cut_silage','another_cut_bales','rotational_grazing','maintenance_grazing'];
  const rawNextAction = String(formData.get('next_action') ?? '');
  const nextAction: string | null = VALID_NEXT_ACTIONS.includes(rawNextAction) ? rawNextAction : null;

  if (!id || !fieldId || !cutNumber || !cutDate) throw new Error('Missing required fields');
  if (!isValidIsoDate(cutDate)) throw new Error('Invalid date — use the date picker');
  if (!['silage', 'bales', 'grazing'].includes(cutType)) throw new Error('Unknown cut type');
  if (!['light', 'average', 'heavy'].includes(yieldClass)) throw new Error('Unknown yield class');
  if (!Number.isFinite(cutNumber) || cutNumber < 1 || cutNumber > 10) throw new Error('Cut number must be 1–10');

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
  await syncFieldAllocationTypeFromCuts(ctx.ownerId, fieldId);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
  revalidatePath('/activity');

  // Return to where the edit was launched from (a filtered activity view or a
  // field tab), falling back to the field view. Internal relative paths only.
  const returnTo = formData.get('return_to') ? String(formData.get('return_to')) : '';
  const dest = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : `/fields/${fieldId}`;
  redirect(dest);
}

/** "I'm happy this cut ran short of N" — hide the After-cut N prompt for this
 *  cut window. Window-scoped by design: the next logged cut is a new row with
 *  a null stamp, so the prompt returns automatically. */
export async function dismissAftercutN(cutId: string) {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  if (!cutId) throw new Error('Missing cut id');
  const { error } = await supabase.from('cuts')
    .update({ n_dismissed_at: new Date().toISOString() })
    .eq('id', cutId);
  if (error) throw new Error(error.message);
  revalidatePath('/');
}

/** Undo for dismissAftercutN — the prompt comes straight back. */
export async function undismissAftercutN(cutId: string) {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  if (!cutId) throw new Error('Missing cut id');
  const { error } = await supabase.from('cuts')
    .update({ n_dismissed_at: null })
    .eq('id', cutId);
  if (error) throw new Error(error.message);
  revalidatePath('/');
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
  if (fieldId) await syncFieldAllocationTypeFromCuts(ctx.ownerId, fieldId);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
  redirect(`/fields/${fieldId}`);
}

export async function saveSoil(formData: FormData) {
  const ctx = await getFarmContext();
  if (!ctx) throw new Error('Not signed in');
  // Soil & grass can be set by the farm admin, OR by a linked agronomist on the
  // farm's behalf. An agronomist has no write RLS, so their edit goes through
  // the service client — scoped in code to the farm they're reviewing and to
  // the agronomic columns only (no notes/history, no field create/delete).
  const isAgronomistEdit = !ctx.isAdmin && ctx.accountType === 'agronomist';
  if (!ctx.isAdmin && !isAgronomistEdit) {
    throw new Error('Only the farm admin or a linked agronomist can change soil and grass.');
  }
  if (isAgronomistEdit) await requireAgronomistFor(ctx.ownerId);
  const supabase = isAgronomistEdit ? createServiceClient() : createClient();

  const fieldId = String(formData.get('field_id'));
  // parseFloat('abc') is NaN, and NaN serialises to null in JSON — so a typo
  // used to be SILENTLY saved as “not sampled”. Reject it instead.
  const num = (key: string): number | null => {
    const raw = formData.get(key);
    if (raw == null || String(raw).trim() === '') return null;
    const n = parseFloat(String(raw));
    if (!Number.isFinite(n)) throw new Error(`'${raw}' is not a number`);
    return n;
  };
  const isoOrNull = (key: string): string | null => {
    const raw = formData.get(key);
    if (raw == null || String(raw).trim() === '') return null;
    const v = String(raw);
    if (!isValidIsoDate(v)) throw new Error('Invalid date — use the date picker');
    return v;
  };
  const ph = num('ph');
  const pIdx = num('p_idx');
  const kIdx = num('k_idx');
  const mgIdx = num('mg_idx');
  const sampleDate = isoOrNull('sample_date');
  const lastPloughed = isoOrNull('last_ploughed');
  const lastReseeded = isoOrNull('last_reseeded');
  const notes = clampNotes(formData.get('notes'));
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

  // For an agronomist: verify the field belongs to the farm they're reviewing
  // (the service client bypasses RLS, so this ownership check is the guard),
  // and write ONLY the agronomic columns — never notes/ploughed/reseeded.
  let writeUpdate: Record<string, unknown> = update;
  if (isAgronomistEdit) {
    const { data: f } = await supabase.from('fields').select('user_id').eq('id', fieldId).maybeSingle();
    if (!f || (f as { user_id: string }).user_id !== ctx.ownerId) {
      throw new Error('That field is not on the farm you are reviewing.');
    }
    const allowed = new Set(['soil_type', 'grass_system_id', 'ph', 'p_idx', 'k_idx', 'mg_idx', 'sample_date', 'sampled', 'last_ploughed', 'last_reseeded', 'notes', 'updated_at']);
    writeUpdate = Object.fromEntries(Object.entries(update).filter(([k]) => allowed.has(k)));
  }

  const { error } = await supabase.from('fields').update(writeUpdate).eq('id', fieldId);
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

  // Grazing yield band: '' / absent → null (legacy cut_profile-derived N).
  const rawBand = String(formData.get('grazing_yield_band') ?? '').trim();
  const grazingBand = rawBand === '' ? null : Math.max(0, Math.min(6, parseInt(rawBand, 10)));

  const { error } = await supabase.from('fields').update({
    cut_profile: cutProfile,
    planned_cuts: plannedCuts,
    grazing_yield_band: grazingBand,
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
    businessName: (String(formData.get('business_name') || '').trim()) || null,
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
    spreadCoverageThresholdPct: Math.max(50, Math.min(100,
      parseInt(String(formData.get('spread_coverage_pct') || '80'), 10) || 80
    )),
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
  const ctx = await getFarmContext();
  if (!ctx) throw new Error('Not signed in');
  // The advanced RB209 overrides can be set by the farm admin, OR by a linked
  // agronomist on the farm's behalf (service client, scoped to that farm).
  const isAgronomistEdit = !ctx.isAdmin && ctx.accountType === 'agronomist';
  if (!ctx.isAdmin && !isAgronomistEdit) {
    throw new Error('Only the farm admin or a linked agronomist can change agronomy settings.');
  }
  if (isAgronomistEdit) await requireAgronomistFor(ctx.ownerId);
  const supabase = isAgronomistEdit ? createServiceClient() : createClient();
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
  const cappedNotes = clampNotes(notes);

  // Validation: name required, acres/ha inside the HARD limits (a typoed area
  // breaks every per-ha calculation downstream — this is the one range the
  // client treats as a hard block, so the server must too), cut profile 1-4.
  if (!name) throw new Error('Field name is required');
  if (name.length > 80) throw new Error('Field name is too long (80 characters max)');
  if (!Number.isFinite(acres) || acres < FIELD_RANGES.acres.min || acres > FIELD_RANGES.acres.max) {
    throw new Error(`Acres must be between ${FIELD_RANGES.acres.min} and ${FIELD_RANGES.acres.max}`);
  }
  if (!Number.isFinite(ha) || ha < FIELD_RANGES.ha.min || ha > FIELD_RANGES.ha.max) {
    throw new Error(`Hectares must be between ${FIELD_RANGES.ha.min} and ${FIELD_RANGES.ha.max}`);
  }
  if (!cutProfile || cutProfile < 1 || cutProfile > 4) throw new Error('Cut profile must be 1–4');

  const rawBand = String(formData.get('grazing_yield_band') ?? '').trim();
  const grazingBand = rawBand === '' ? null : Math.max(0, Math.min(6, parseInt(rawBand, 10)));

  const { data, error } = await supabase.from('fields').insert({
    user_id: user.id,
    group_id: groupId,
    name,
    acres,
    ha,
    cut_profile: cutProfile,
    planned_cuts: plannedCuts,
    grazing_yield_band: grazingBand,
    soil_type: soilType,
    grass_system_id: grassSystemId,
    sampled: false,
    notes: cappedNotes,
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

// Lighter onboarding for a contractor-only account: no farm setup — just a
// business name, a self-admin membership (so their own RLS works), and a
// contractor profile (with a shareable code). Lands them on their jobs.
export async function completeContractorOnboarding(businessName?: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  await supabase.from('farm_members').insert({ owner_id: user.id, member_id: user.id, role: 'admin' });

  const name = businessName && businessName.trim() ? businessName.trim() : null;
  const { data: prof } = await supabase.from('contractor_profiles').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!prof) {
    let lastErr: string | null = null;
    for (let i = 0; i < 4; i++) {
      const { error } = await supabase.from('contractor_profiles').insert({ user_id: user.id, code: makeContractorCode(), business_name: name });
      if (!error) { lastErr = null; break; }
      lastErr = error.message;
      if (!/duplicate|unique/i.test(error.message)) break;
    }
    if (lastErr) throw new Error(lastErr);
  } else if (name) {
    await supabase.from('contractor_profiles').update({ business_name: name }).eq('user_id', user.id);
  }

  const { data: existing } = await supabase.from('settings').select('data').eq('user_id', user.id).maybeSingle();
  const current = (existing?.data as Record<string, unknown>) || {};
  const next = {
    ...current,
    accountType: 'contractor',
    unitSystem: current.unitSystem ?? 'hectares',
    onboarded: true,
    ...(name ? { farmName: name } : {}),
  };
  const { error } = await supabase.from('settings').upsert({ user_id: user.id, data: next, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save: ${error.message}`);

  revalidatePath('/');
  redirect('/jobs');
}

// ---- Agronomist accounts -------------------------------------------------
// An agronomist advises multiple farms. Onboarding mirrors the contractor:
// create a self-admin row (so their own settings write is allowed) and stamp
// accountType='agronomist'. They then accept farm invites (role 'agronomist')
// and review each farm via the switcher.
export async function completeAgronomistOnboarding(displayName?: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  await supabase.from('farm_members').insert({ owner_id: user.id, member_id: user.id, role: 'admin' });

  const { data: existing } = await supabase.from('settings').select('data').eq('user_id', user.id).maybeSingle();
  const current = (existing?.data as Record<string, unknown>) || {};
  const next = {
    ...current,
    accountType: 'agronomist',
    unitSystem: current.unitSystem ?? 'hectares',
    onboarded: true,
    ...(displayName && displayName.trim() ? { farmName: displayName.trim().slice(0, 120) } : {}),
  };
  const { error } = await supabase.from('settings').upsert({ user_id: user.id, data: next, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save: ${error.message}`);

  revalidatePath('/');
  redirect('/agronomist');
}

// Switch which client farm the agronomist is reviewing (sets the cookie that
// getFarmContext reads). Verifies the link first.
export async function setAgronomistFarm(formData: FormData) {
  const ownerId = String(formData.get('owner_id') ?? '');
  if (!ownerId) throw new Error('Missing farm');
  await requireAgronomistFor(ownerId); // throws unless linked
  cookies().set(AGRONOMIST_FARM_COOKIE, ownerId, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/', 'layout');
  redirect('/fields');
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

  // Keep the field's allocation type in step with the new next-action choice.
  if (fieldId) {
    const ctx = await getFarmContext();
    if (ctx) await syncFieldAllocationTypeFromCuts(ctx.ownerId, fieldId);
  }

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
  const roleRaw = String(formData.get('role') ?? 'staff');
  const role = roleRaw === 'agronomist' ? 'agronomist' : 'staff';

  // Try a few times in the vanishingly unlikely event of a code collision.
  let lastErr: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode();
    const { error } = await supabase.from('farm_invites').insert({
      owner_id: ctx.ownerId,
      code,
      role,
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
  const result = data as { ok: boolean; error?: string; role?: string };
  if (!result?.ok) {
    throw new Error(result?.error || 'Could not join farm');
  }

  // Stamp the display name on the membership the RPC just created.
  const name = String(formData.get('name') ?? '').trim().slice(0, 60);
  if (name) {
    await supabase.from('farm_members').update({ member_name: name }).eq('member_id', user.id);
  }

  revalidatePath('/');
  revalidatePath('/settings');
  // An agronomist who just linked a farm lands on their farms list, not the
  // farm home (which is for farm/staff accounts).
  if (result.role === 'agronomist') redirect('/agronomist');
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

export async function seedStarterProducts() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await requireAdmin();

  const { data: existing } = await supabase
    .from('products')
    .select('name')
    .eq('user_id', user.id);
  const have = new Set((existing ?? []).map((r: { name: string }) => String(r.name).trim().toLowerCase()));

  const rows = STARTER_PRODUCTS
    .filter((p) => !have.has(p.name.trim().toLowerCase()))
    .map((p, i) => ({
      user_id: user.id,
      name: p.name,
      type: p.type,
      category: p.category,
      sort_order: 900 + i,
      dm_pct: p.dm_pct ?? null,
      form: p.form ?? (p.type === 'bag_fert' ? 'granular' : null),
      n_pct: p.n_pct ?? null,
      p2o5_pct: p.p2o5_pct ?? null,
      k2o_pct: p.k2o_pct ?? null,
      s_pct: p.s_pct ?? null,
      n_kg_per_m3: p.n_kg_per_m3 ?? null,
      p2o5_kg_per_m3: p.p2o5_kg_per_m3 ?? null,
      k2o_kg_per_m3: p.k2o_kg_per_m3 ?? null,
      so3_kg_per_m3: p.so3_kg_per_m3 ?? null,
      mgo_kg_per_m3: p.mgo_kg_per_m3 ?? null,
      n_kg_per_t: p.n_kg_per_t ?? null,
      p2o5_kg_per_t: p.p2o5_kg_per_t ?? null,
      k2o_kg_per_t: p.k2o_kg_per_t ?? null,
      so3_kg_per_t: p.so3_kg_per_t ?? null,
      mgo_kg_per_t: p.mgo_kg_per_t ?? null,
    }));

  if (rows.length > 0) {
    const { error } = await supabase.from('products').insert(rows);
    if (error) throw new Error(`Could not add starter products: ${error.message}`);
  }

  revalidatePath('/products');
  revalidatePath('/');
  revalidatePath('/', 'layout');
}

// ---------------------------------------------------------------------------
// Editing a custom product: write a new dated analysis version (backdatable)
// so past applications keep the values they were spread with, while the
// product's base values move to the most-recent version for future plans.
// ---------------------------------------------------------------------------
function analysisFieldsFromProduct(p: Product) {
  return {
    dm_pct: p.dm_pct, form: p.form, density_kg_per_l: p.density_kg_per_l,
    n_pct: p.n_pct, p2o5_pct: p.p2o5_pct, k2o_pct: p.k2o_pct, s_pct: p.s_pct,
    n_kg_per_m3: p.n_kg_per_m3, p2o5_kg_per_m3: p.p2o5_kg_per_m3, k2o_kg_per_m3: p.k2o_kg_per_m3,
    so3_kg_per_m3: p.so3_kg_per_m3, mgo_kg_per_m3: p.mgo_kg_per_m3,
    n_kg_per_t: p.n_kg_per_t, p2o5_kg_per_t: p.p2o5_kg_per_t, k2o_kg_per_t: p.k2o_kg_per_t,
    so3_kg_per_t: p.so3_kg_per_t, mgo_kg_per_t: p.mgo_kg_per_t,
  };
}
function analysisFieldsFromVersion(a: ProductAnalysis) {
  return {
    dm_pct: a.dm_pct, form: a.form, density_kg_per_l: a.density_kg_per_l,
    n_pct: a.n_pct, p2o5_pct: a.p2o5_pct, k2o_pct: a.k2o_pct, s_pct: a.s_pct,
    n_kg_per_m3: a.n_kg_per_m3, p2o5_kg_per_m3: a.p2o5_kg_per_m3, k2o_kg_per_m3: a.k2o_kg_per_m3,
    so3_kg_per_m3: a.so3_kg_per_m3, mgo_kg_per_m3: a.mgo_kg_per_m3,
    n_kg_per_t: a.n_kg_per_t, p2o5_kg_per_t: a.p2o5_kg_per_t, k2o_kg_per_t: a.k2o_kg_per_t,
    so3_kg_per_t: a.so3_kg_per_t, mgo_kg_per_t: a.mgo_kg_per_t,
  };
}

export async function updateCustomProduct(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await requireAdmin();

  const id = parseInt(String(formData.get('product_id')), 10);
  if (!Number.isFinite(id)) throw new Error('Invalid product id');

  const { data: existing } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
  if (!existing) throw new Error('Product not found');
  const ex = existing as Product;

  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw new Error('Name is required');

  const returnTo = String(formData.get('return_to') ?? '/products');
  const type = ex.type; // type is fixed once a product exists

  // Lime carries no nutrient values — allow a rename only, no analysis version.
  if (type === 'lime') {
    const { error } = await supabase.from('products').update({ name }).eq('id', id);
    if (error) throw new Error(`Could not save product: ${error.message}`);
    revalidatePath('/products'); revalidatePath('/'); revalidatePath('/', 'layout');
    redirect(returnTo);
  }

  // Effective date of the new version (backdatable). Defaults to today.
  const today = new Date().toISOString().slice(0, 10);
  let effectiveFrom = String(formData.get('effective_from') ?? '').trim() || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) effectiveFrom = today;

  const newVals: Record<string, unknown> = { dm_pct: optionalNonNegative(formData, 'dm_pct') };
  if (type === 'bag_fert') {
    const bagForm = String(formData.get('form') ?? 'granular') === 'liquid' ? 'liquid' : 'granular';
    newVals.form = bagForm;
    newVals.n_pct = optionalNonNegative(formData, 'n_pct');
    newVals.p2o5_pct = optionalNonNegative(formData, 'p2o5_pct');
    newVals.k2o_pct = optionalNonNegative(formData, 'k2o_pct');
    newVals.s_pct = optionalNonNegative(formData, 's_pct');
    if (bagForm === 'liquid') {
      const density = optionalNonNegative(formData, 'density_kg_per_l');
      if (!density || density <= 0) throw new Error('Liquid fertiliser needs a density in kg/L (from the product label)');
      newVals.density_kg_per_l = density;
    }
  } else if (type === 'slurry') {
    newVals.n_kg_per_m3 = optionalNonNegative(formData, 'n_kg_per_m3');
    newVals.p2o5_kg_per_m3 = optionalNonNegative(formData, 'p2o5_kg_per_m3');
    newVals.k2o_kg_per_m3 = optionalNonNegative(formData, 'k2o_kg_per_m3');
    newVals.so3_kg_per_m3 = optionalNonNegative(formData, 'so3_kg_per_m3');
    newVals.mgo_kg_per_m3 = optionalNonNegative(formData, 'mgo_kg_per_m3');
  } else if (type === 'solid_manure') {
    newVals.n_kg_per_t = optionalNonNegative(formData, 'n_kg_per_t');
    newVals.p2o5_kg_per_t = optionalNonNegative(formData, 'p2o5_kg_per_t');
    newVals.k2o_kg_per_t = optionalNonNegative(formData, 'k2o_kg_per_t');
    newVals.so3_kg_per_t = optionalNonNegative(formData, 'so3_kg_per_t');
    newVals.mgo_kg_per_t = optionalNonNegative(formData, 'mgo_kg_per_t');
  }

  // Preserve pre-edit values as a far-past v1 if no history exists yet, so any
  // application dated before this edit keeps the values it was spread with.
  const { data: existingVersions } = await supabase
    .from('product_analyses').select('id').eq('product_id', id).limit(1);
  if (!existingVersions || existingVersions.length === 0) {
    const { error: v1Err } = await supabase.from('product_analyses').insert({
      product_id: id, user_id: ex.user_id, effective_from: '2000-01-01',
      ...analysisFieldsFromProduct(ex),
    });
    if (v1Err) throw new Error(`Could not record prior analysis: ${v1Err.message}`);
  }

  const { error: insErr } = await supabase.from('product_analyses').insert({
    product_id: id, user_id: ex.user_id, effective_from: effectiveFrom, ...newVals,
  });
  if (insErr) throw new Error(`Could not save analysis: ${insErr.message}`);

  // Sync the product's base values to the most-recent version.
  const { data: latest } = await supabase
    .from('product_analyses').select('*').eq('product_id', id)
    .order('effective_from', { ascending: false }).order('created_at', { ascending: false })
    .limit(1).maybeSingle();
  const baseUpdate: Record<string, unknown> = { name };
  if (latest) Object.assign(baseUpdate, analysisFieldsFromVersion(latest as ProductAnalysis));
  const { error: updErr } = await supabase.from('products').update(baseUpdate).eq('id', id);
  if (updErr) throw new Error(`Could not update product: ${updErr.message}`);

  revalidatePath('/products'); revalidatePath('/'); revalidatePath('/', 'layout');
  redirect(returnTo);
}

export async function deleteProductAnalysis(formData: FormData) {
  const supabase = createClient();
  await requireAdmin();
  const analysisId = String(formData.get('analysis_id') ?? '');
  const productId = parseInt(String(formData.get('product_id')), 10);
  if (!analysisId || !Number.isFinite(productId)) throw new Error('Invalid request');

  const { count } = await supabase.from('product_analyses')
    .select('id', { count: 'exact', head: true }).eq('product_id', productId);
  if ((count ?? 0) <= 1) throw new Error('A product must keep at least one analysis version.');

  const { error } = await supabase.from('product_analyses').delete().eq('id', analysisId);
  if (error) throw new Error(`Could not delete version: ${error.message}`);

  const { data: latest } = await supabase.from('product_analyses').select('*')
    .eq('product_id', productId).order('effective_from', { ascending: false })
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (latest) {
    await supabase.from('products').update(analysisFieldsFromVersion(latest as ProductAnalysis)).eq('id', productId);
  }
  revalidatePath('/products'); revalidatePath('/'); revalidatePath('/', 'layout');
  redirect(`/products/${productId}/edit`);
}

// ---------------------------------------------------------------------------
// Spray records (plant protection). Separate from applications — never touches
// nutrient maths. Optional drawn sprayed area stored inline on the row.
// ---------------------------------------------------------------------------
function parseTargets(raw: FormDataEntryValue | null): string[] | null {
  if (raw == null) return null;
  const txt = String(raw).trim();
  if (!txt) return null;
  let arr: string[] = [];
  try {
    const parsed = JSON.parse(txt);
    if (Array.isArray(parsed)) arr = parsed.map((t) => String(t).trim()).filter(Boolean);
  } catch {
    // Fallback: comma-separated string.
    arr = txt.split(',').map((t) => t.trim()).filter(Boolean);
  }
  // de-dupe, cap length
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of arr) { const k = t.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(t); } }
  return out.length ? out.slice(0, 12) : null;
}

export async function createSprayRecord(formData: FormData): Promise<{ error: string } | void> {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');

  const fieldId = String(formData.get('field_id') ?? '');
  const dateApplied = String(formData.get('date_applied') ?? '');

  const numOrNull = (key: string): number | null => {
    const raw = formData.get(key);
    if (raw == null || String(raw).trim() === '') return null;
    const n = parseFloat(String(raw));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const strOrNull = (key: string): string | null => {
    const raw = formData.get(key);
    const v = raw == null ? '' : String(raw).trim();
    return v === '' ? null : v;
  };

  // A spray "event" can be a tank mix of several products. Each product becomes
  // its own spray_records row sharing the field, date, water rate, area,
  // weather and targets — so stock draws down per product but weather/targets
  // are entered once. Falls back to the single product_name field if no lines.
  type LineIn = { name?: string; spray_product_id?: string | null; litres?: number | null };
  let lines: { name: string; spray_product_id: string | null; product_litres: number | null }[] = [];
  const linesRaw = formData.get('product_lines');
  if (linesRaw) {
    try {
      const arr = JSON.parse(String(linesRaw)) as LineIn[];
      lines = (Array.isArray(arr) ? arr : [])
        .map((l) => {
          const litresNum = l.litres == null ? NaN : Number(l.litres);
          return {
            name: String(l.name ?? '').trim(),
            spray_product_id: l.spray_product_id ? String(l.spray_product_id) : null,
            product_litres: Number.isFinite(litresNum) && litresNum >= 0 ? litresNum : null,
          };
        })
        .filter((l) => l.name !== '');
    } catch { /* fall back below */ }
  }
  if (lines.length === 0) {
    const single = String(formData.get('product_name') ?? '').trim();
    if (single) lines = [{ name: single, spray_product_id: strOrNull('spray_product_id'), product_litres: numOrNull('product_litres') }];
  }
  if (!fieldId) return { error: 'Choose a field for this spray.' };
  if (!dateApplied) return { error: 'Add the date the spray was applied.' };
  if (lines.length === 0) return { error: 'Add at least one spray before saving.' };

  // Optional drawn sprayed area (only part of the field treated).
  const isPartial = String(formData.get('coverage')) === 'partial';
  let polygon: FieldGeometry | null = null;
  let areaHa: number | null = numOrNull('area_ha');
  if (isPartial) {
    const areaJson = formData.get('spray_area') ? String(formData.get('spray_area')) : null;
    if (!areaJson) return { error: 'Draw the sprayed area for a part-field spray.' };
    try {
      polygon = JSON.parse(areaJson) as FieldGeometry;
    } catch {
      return { error: 'Could not read the drawn area — draw it again and retry.' };
    }
    areaHa = polygonAreaHectares(polygon);
    if (!(areaHa > 0)) return { error: 'The drawn area is empty — draw the sprayed area and try again.' };
  }

  const shared = {
    user_id: ctx.ownerId,
    created_by: ctx.userId,
    field_id: fieldId,
    date_applied: dateApplied,
    water_l_per_ha: numOrNull('water_l_per_ha'),
    area_ha: areaHa,
    coverage: isPartial ? 'partial' : 'whole',
    polygon: polygon ?? null,
    wind_dir: strOrNull('wind_dir'),
    wind_speed_mph: numOrNull('wind_speed_mph'),
    temp_c: numOrNull('temp_c'),
    weather_note: strOrNull('weather_note'),
    targets: parseTargets(formData.get('targets')),
    notes: strOrNull('notes'),
  };
  // One field spray = one record. A tank mix lists every product here; each
  // still draws down its own stock. product_name/litres mirror the primary
  // (or a joined summary) for the existing list/map display.
  const primary = lines[0];
  const productName = lines.length === 1 ? primary.name : lines.map((l) => l.name).join(' + ');
  const { error } = await supabase.from('spray_records').insert({
    ...shared,
    product_name: productName,
    product_litres: lines.length === 1 ? primary.product_litres : null,
    spray_product_id: lines.length === 1 ? primary.spray_product_id : null,
    products: lines.map((l) => ({ name: l.name, spray_product_id: l.spray_product_id, litres: l.product_litres })),
  });
  if (error) return { error: `Couldn't save the spray record: ${error.message}` };

  revalidatePath('/spray');
  revalidatePath('/');
  const returnTo = formData.get('return_to') ? String(formData.get('return_to')) : '/spray';
  const dest = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/spray';
  redirect(dest);
}

export async function deleteSprayRecord(formData: FormData) {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing record id');
  const { error } = await supabase.from('spray_records').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/spray');
  revalidatePath('/');
  redirect('/spray');
}

// ---------------------------------------------------------------------------
// Spray stock: products, purchases, and sprayer calibration settings.
// Catalogue + purchases are farm config (admin-managed); stock is computed.
// ---------------------------------------------------------------------------
function numOrNullField(formData: FormData, key: string): number | null {
  const raw = formData.get(key);
  if (raw == null || String(raw).trim() === '') return null;
  const n = parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

export async function createSprayProduct(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw new Error('Name is required');
  const defRaw = numOrNullField(formData, 'default_l_per_ha');
  const { error } = await supabase.from('spray_products').insert({
    user_id: ctx.ownerId,
    created_by: ctx.userId,
    name,
    default_l_per_ha: defRaw != null && defRaw >= 0 ? defRaw : null,
    notes: (() => { const v = String(formData.get('notes') ?? '').trim(); return v === '' ? null : v; })(),
  });
  if (error) throw new Error(error.message);
  revalidatePath('/spray/stock');
  revalidatePath('/spray');
  redirect('/spray/stock');
}

export async function updateSprayProduct(formData: FormData) {
  const supabase = createClient();
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing product id');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw new Error('Name is required');
  const defRaw = numOrNullField(formData, 'default_l_per_ha');
  const { error } = await supabase.from('spray_products').update({
    name,
    default_l_per_ha: defRaw != null && defRaw >= 0 ? defRaw : null,
    notes: (() => { const v = String(formData.get('notes') ?? '').trim(); return v === '' ? null : v; })(),
  }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/spray/stock');
  revalidatePath(`/spray/stock/${id}`);
  revalidatePath('/spray');
  redirect(`/spray/stock/${id}`);
}

export async function deleteSprayProduct(formData: FormData) {
  const supabase = createClient();
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing product id');
  const { error } = await supabase.from('spray_products').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/spray/stock');
  revalidatePath('/spray');
  redirect('/spray/stock');
}

export async function addSprayPurchase(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const productId = String(formData.get('product_id') ?? '');
  const purchaseDate = String(formData.get('purchase_date') ?? '');
  const litres = numOrNullField(formData, 'litres');
  if (!productId || !purchaseDate) throw new Error('Product and date are required');
  if (litres == null || litres <= 0) throw new Error('Enter the litres purchased');
  const unitCost = numOrNullField(formData, 'unit_cost');
  const { error } = await supabase.from('spray_purchases').insert({
    user_id: ctx.ownerId,
    created_by: ctx.userId,
    product_id: productId,
    purchase_date: purchaseDate,
    litres,
    unit_cost: unitCost != null && unitCost >= 0 ? unitCost : null,
    supplier: (() => { const v = String(formData.get('supplier') ?? '').trim(); return v === '' ? null : v; })(),
    notes: (() => { const v = String(formData.get('notes') ?? '').trim(); return v === '' ? null : v; })(),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/spray/stock/${productId}`);
  revalidatePath('/spray/stock');
  revalidatePath('/spray');
  redirect(`/spray/stock/${productId}`);
}

export async function deleteSprayPurchase(formData: FormData) {
  const supabase = createClient();
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const productId = String(formData.get('product_id') ?? '');
  if (!id) throw new Error('Missing purchase id');
  const { error } = await supabase.from('spray_purchases').delete().eq('id', id);
  if (error) throw new Error(error.message);
  if (productId) revalidatePath(`/spray/stock/${productId}`);
  revalidatePath('/spray/stock');
  revalidatePath('/spray');
  redirect(productId ? `/spray/stock/${productId}` : '/spray/stock');
}

export async function saveSprayerSettings(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const { data: existingRow } = await supabase.from('settings').select('data').eq('user_id', ctx.ownerId).maybeSingle();
  const existing = (existingRow?.data as Record<string, unknown>) || {};
  const sprayer = {
    widthM: numOrNullField(formData, 'width_m'),
    totalFlowLMin: numOrNullField(formData, 'total_flow_l_min'),
    defaultSpeedKmh: numOrNullField(formData, 'default_speed_kmh'),
    tankLitres: numOrNullField(formData, 'tank_l'),
  };
  const data = { ...existing, sprayer };
  const { error } = await supabase.from('settings').upsert({
    user_id: ctx.ownerId,
    data,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  revalidatePath('/spray/sprayer');
  revalidatePath('/spray');
  redirect('/spray');
}


// ---------------------------------------------------------------------------
// Job sheets — Phase 1: create + delete (admin). Recipient completion, review
// → commit, share links and contractor accounts follow in later phases.
// ---------------------------------------------------------------------------
export async function createJob(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const strOrNull = (k: string): string | null => {
    const v = String(formData.get(k) ?? '').trim();
    return v === '' ? null : v;
  };

  const title = String(formData.get('title') ?? '').trim();
  const jobType = String(formData.get('job_type') ?? '').trim();
  const def = jobTypeDef(jobType);
  if (!def) throw new Error('Pick a job type');
  if (!title) throw new Error('Give the job a title');

  let fieldRows: { field_id?: string; field_name?: string; boundary?: unknown; area_ha?: number }[];
  try {
    fieldRows = JSON.parse(String(formData.get('fields') ?? ''));
  } catch {
    throw new Error('Could not read the selected fields — try again');
  }
  if (!Array.isArray(fieldRows) || fieldRows.length === 0) throw new Error('Pick at least one field');

  let productId: number | null = null;
  if (def.commitsTo === 'applications') {
    const v = parseInt(String(formData.get('product_id') ?? ''), 10);
    productId = Number.isFinite(v) ? v : null;
    if (!productId) throw new Error('Choose a product for this job');
  }

  const rateValue = numOrNullField(formData, 'rate_value');
  const rateUnit = def.defaultUnit ? (String(formData.get('rate_unit') ?? '').trim() || def.defaultUnit) : null;

  let spraySpec: unknown = null;
  if (def.id === 'spray') {
    try {
      const arr = JSON.parse(String(formData.get('spray_spec') ?? '[]'));
      if (Array.isArray(arr) && arr.length > 0) spraySpec = arr;
    } catch { /* ignore */ }
  }

  const { data: stRow } = await supabase.from('settings').select('data').eq('user_id', ctx.ownerId).maybeSingle();
  const farmName = (stRow?.data as { farmName?: string } | null)?.farmName ?? null;

  const { data: job, error } = await supabase.from('jobs').insert({
    user_id: ctx.ownerId,
    created_by: ctx.userId,
    farm_name: farmName,
    title,
    job_type: jobType,
    status: 'sent',
    product_id: productId,
    rate_value: rateValue,
    rate_unit: rateUnit,
    water_l_per_ha: def.id === 'spray' ? numOrNullField(formData, 'water_l_per_ha') : null,
    spray_spec: spraySpec,
    instruction: strOrNull('instruction'),
    notes: strOrNull('notes'),
    due_date: strOrNull('due_date'),
    assignee_user_id: strOrNull('assignee_user_id'),
    contractor_label: strOrNull('contractor_label'),
  }).select('id').single();
  if (error || !job) throw new Error(error?.message ?? 'Could not create the job');

  const fieldsInsert = fieldRows.map((f, i) => ({
    job_id: job.id as string,
    field_id: f.field_id ?? null,
    field_name: String(f.field_name ?? 'Field'),
    boundary: f.boundary ?? null,
    area_ha: typeof f.area_ha === 'number' ? f.area_ha : null,
    planned_rate_value: rateValue,
    planned_rate_unit: rateUnit,
    sort_order: i,
  }));
  const { error: fErr } = await supabase.from('job_fields').insert(fieldsInsert);
  if (fErr) throw new Error(fErr.message);

  const notifyAssignee = strOrNull('assignee_user_id');
  if (notifyAssignee) await sendPushToUser(notifyAssignee, { title: 'New job', body: `${farmName ?? 'A farm'}: ${title}`, url: '/jobs', tag: `job-${job.id}` });

  revalidatePath('/jobs');
  revalidatePath('/');
  redirect(`/jobs/${job.id}`);
}

export async function createJobsFromPlan(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();

  let items: { field_id: string; product_id: number; rate_kg_ha: number }[];
  try {
    items = JSON.parse(String(formData.get('items') ?? ''));
  } catch {
    throw new Error('Could not read the plan — try again');
  }
  items = (Array.isArray(items) ? items : []).filter(
    (i) => i && typeof i.field_id === 'string' && Number.isFinite(i.product_id) && Number.isFinite(i.rate_kg_ha) && i.rate_kg_ha > 0,
  );

  // Optional: manure/slurry items. Rate is the native VOLUME rate (e.g. m3/ha or
  // gal/ac), not kg/ha, so these become 'slurry'/'manure' sheets, not 'fertiliser'.
  let organicItems: { field_id: string; product_id: number; rate_value: number; rate_unit: string }[] = [];
  try { organicItems = JSON.parse(String(formData.get('organicItems') ?? '[]')); } catch { organicItems = []; }
  organicItems = (Array.isArray(organicItems) ? organicItems : []).filter(
    (i) => i && typeof i.field_id === 'string' && Number.isFinite(i.product_id) && Number.isFinite(i.rate_value) && i.rate_value > 0 && typeof i.rate_unit === 'string',
  );
  if (items.length === 0 && organicItems.length === 0) throw new Error('Nothing to turn into a job');

  // Enrich fields (name / boundary / area) and products from the DB so the
  // created job sheets carry map polygons and readable titles.
  const fieldIds = [...new Set([...items.map((i) => i.field_id), ...organicItems.map((i) => i.field_id)])];
  const { data: fieldRows } = await supabase
    .from('fields').select('id, name, boundary, ha').in('id', fieldIds);
  const fieldById = new Map((fieldRows ?? []).map((f) => [f.id as string, f]));

  const productIds = [...new Set([...items.map((i) => i.product_id), ...organicItems.map((i) => i.product_id)])];
  const { data: prodRows } = await supabase
    .from('products').select('id, name, type').in('id', productIds);
  const prodById = new Map((prodRows ?? []).map((p) => [p.id as number, { name: p.name as string, type: p.type as string }]));

  const { data: stRow } = await supabase.from('settings').select('data').eq('user_id', ctx.ownerId).maybeSingle();
  const farmName = (stRow?.data as { farmName?: string } | null)?.farmName ?? null;

  // One job sheet per product; fields ride together, each carrying its own rate.
  const groups = new Map<number, { fieldId: string; rate: number }[]>();
  for (const it of items) {
    const arr = groups.get(it.product_id) ?? [];
    if (!arr.some((r) => r.fieldId === it.field_id)) arr.push({ fieldId: it.field_id, rate: it.rate_kg_ha });
    groups.set(it.product_id, arr);
  }

  for (const [productId, rows] of groups.entries()) {
    const pName = prodById.get(productId)?.name ?? 'Fertiliser';
    const rates = [...new Set(rows.map((r) => r.rate))];
    const uniform = rates.length === 1 ? rates[0] : null;
    const { data: job, error } = await supabase.from('jobs').insert({
      user_id: ctx.ownerId,
      created_by: ctx.userId,
      farm_name: farmName,
      title: uniform != null ? `Spread ${pName} @ ${uniform} kg/ha` : `Spread ${pName}`,
      job_type: 'fertiliser',
      status: 'sent',
      product_id: productId,
      rate_value: uniform,
      rate_unit: 'kg/ha',
      water_l_per_ha: null,
      spray_spec: null,
      instruction: null,
      notes: 'Created from the fert plan.',
      due_date: null,
      assignee_user_id: null,
      contractor_label: null,
    }).select('id').single();
    if (error || !job) continue;

    const fieldsInsert = rows.map((r, i) => {
      const f = fieldById.get(r.fieldId);
      return {
        job_id: job.id as string,
        field_id: r.fieldId,
        field_name: (f?.name as string) ?? 'Field',
        boundary: f?.boundary ?? null,
        area_ha: typeof f?.ha === 'number' ? f.ha : null,
        planned_rate_value: r.rate,
        planned_rate_unit: 'kg/ha',
        sort_order: i,
      };
    });
    await supabase.from('job_fields').insert(fieldsInsert);
  }

  // Manure / slurry sheets — one per product, rate in its native volume unit.
  const orgGroups = new Map<number, { fieldId: string; rate: number; unit: string }[]>();
  for (const it of organicItems) {
    const arr = orgGroups.get(it.product_id) ?? [];
    if (!arr.some((r) => r.fieldId === it.field_id)) arr.push({ fieldId: it.field_id, rate: it.rate_value, unit: it.rate_unit });
    orgGroups.set(it.product_id, arr);
  }
  for (const [productId, rows] of orgGroups.entries()) {
    const prod = prodById.get(productId);
    const pName = prod?.name ?? 'Manure';
    const jobType = prod?.type === 'solid_manure' ? 'manure' : 'slurry';
    const unit = rows[0]?.unit ?? '';
    const rates = [...new Set(rows.map((r) => r.rate))];
    const uniform = rates.length === 1 ? rates[0] : null;
    const { data: job, error } = await supabase.from('jobs').insert({
      user_id: ctx.ownerId,
      created_by: ctx.userId,
      farm_name: farmName,
      title: uniform != null ? `Spread ${pName} @ ${uniform} ${unit}` : `Spread ${pName}`,
      job_type: jobType,
      status: 'sent',
      product_id: productId,
      rate_value: uniform,
      rate_unit: unit,
      water_l_per_ha: null,
      spray_spec: null,
      instruction: null,
      notes: 'Created from the fert plan.',
      due_date: null,
      assignee_user_id: null,
      contractor_label: null,
    }).select('id').single();
    if (error || !job) continue;
    const fieldsInsert = rows.map((r, i) => {
      const f = fieldById.get(r.fieldId);
      return {
        job_id: job.id as string,
        field_id: r.fieldId,
        field_name: (f?.name as string) ?? 'Field',
        boundary: f?.boundary ?? null,
        area_ha: typeof f?.ha === 'number' ? f.ha : null,
        planned_rate_value: r.rate,
        planned_rate_unit: r.unit,
        sort_order: i,
      };
    });
    await supabase.from('job_fields').insert(fieldsInsert);
  }

  revalidatePath('/jobs');
  revalidatePath('/');
  redirect('/jobs');
}

export async function deleteJob(formData: FormData) {
  const supabase = createClient();
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing job id');
  const { error } = await supabase.from('jobs').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/jobs');
  revalidatePath('/');
  redirect('/jobs');
}

// ---------------------------------------------------------------------------
// Job sheets — Phase 2: recipient completion, admin review/approve, and the
// shared commit that writes the real records. Farm staff (and the admin)
// auto-log on submit; anyone else (contractor / share-link, later) lands as
// 'submitted' and waits for admin approval.
// ---------------------------------------------------------------------------

const JOB_VALID_UNITS = new Set(['kg/ha', 'kg/ac', 'lb/ac', 'gal/ac', 'm3/ha', 't/ac', 't/ha', 'l/ha', 'l/ac']);

interface JobRowForCommit {
  id: string; user_id: string; job_type: string; status: string;
  product_id: number | null; rate_value: number | null; rate_unit: string | null;
  water_l_per_ha: number | null; spray_spec: { name: string; spray_product_id: string | null; l_per_ha: number | null }[] | null;
  title: string; contractor_label: string | null;
  assignee_user_id: string | null;
  approved_at: string | null;
}
interface JobFieldRowForCommit {
  id: string; field_id: string | null; field_name: string; area_ha: number | null;
  planned_rate_value: number | null; status: string; actual_rate_value: number | null;
  logged_at: string | null;
}

// Writes the records for an approved job. Idempotent-by-caller: only invoke on
// the transition into 'approved'. actingUserId = whoever triggered it.
async function commitJobRecords(
  supabase: ReturnType<typeof createClient>,
  actingUserId: string,
  job: JobRowForCommit,
  fields: JobFieldRowForCommit[],
) {
  // Name the person on the record when the job was assigned to a known member.
  let assigneeName: string | null = null;
  if (job.assignee_user_id) {
    const { data: mem } = await supabase.from('farm_members').select('member_name').eq('owner_id', job.user_id).eq('member_id', job.assignee_user_id).maybeSingle();
    assigneeName = (mem as { member_name: string | null } | null)?.member_name ?? null;
  }

  const def = jobTypeDef(job.job_type);
  if (!def) return;
  const today = new Date().toISOString().slice(0, 10);
  // Only fields that are done AND not already logged (logged_at null). This is
  // what makes re-approval after a reopen idempotent — already-logged fields
  // are never written a second time.
  const done = fields.filter((f) => (f.status === 'done' || f.status === 'partial') && f.field_id && f.logged_at == null);

  if (def.commitsTo === 'applications') {
    if (!job.product_id) return;
    const unit = job.rate_unit && JOB_VALID_UNITS.has(job.rate_unit) ? job.rate_unit : (def.defaultUnit ?? 'kg/ha');
    const inserts = done
      .map((f) => {
        const rate = f.actual_rate_value ?? f.planned_rate_value ?? job.rate_value;
        if (rate == null || !(rate > 0)) return null;
        return {
          user_id: job.user_id,
          created_by: actingUserId,
          field_id: f.field_id as string,
          product_id: job.product_id as number,
          date_applied: today,
          rate_value: rate,
          rate_unit: unit,
          method: null,
          notes: `From job sheet: ${job.title}`,
          applied_by: job.contractor_label ?? assigneeName ?? 'Job sheet',
          job_id: job.id,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (inserts.length > 0) {
      const { error } = await supabase.from('applications').insert(inserts);
      if (error) throw new Error(`Could not log applications: ${error.message}`);
    }
  } else if (def.commitsTo === 'spray_records') {
    const spec = Array.isArray(job.spray_spec) ? job.spray_spec : [];
    const names = spec.map((s) => s.name).filter(Boolean);
    const productName = names.length === 1 ? names[0] : (names.join(' + ') || 'Spray');
    const rows = done.map((f) => {
      const area = f.area_ha ?? null;
      const products = spec.map((s) => ({
        name: s.name,
        spray_product_id: s.spray_product_id ?? null,
        litres: s.l_per_ha != null && area != null ? Math.round(s.l_per_ha * area * 10) / 10 : null,
      }));
      const single = products.length === 1 ? products[0] : null;
      return {
        user_id: job.user_id,
        created_by: actingUserId,
        field_id: f.field_id as string,
        date_applied: today,
        product_name: productName,
        product_litres: single ? single.litres : null,
        spray_product_id: single ? single.spray_product_id : null,
        products,
        water_l_per_ha: job.water_l_per_ha,
        area_ha: area,
        coverage: 'whole',
        polygon: null,
        wind_dir: null,
        wind_speed_mph: null,
        temp_c: null,
        weather_note: null,
        targets: null,
        notes: `From job sheet: ${job.title}`,
      };
    });
    if (rows.length > 0) {
      const { error } = await supabase.from('spray_records').insert(rows);
      if (error) throw new Error(`Could not log spray records: ${error.message}`);
    }
  }
  // 'none' (generic) writes nothing.

  // Stamp every field we just logged so a later reopen + re-approve can't write
  // it again. 'none'-type jobs commit no records, so nothing to stamp there.
  if (def.commitsTo !== 'none' && done.length > 0) {
    const stamp = new Date().toISOString();
    await supabase.from('job_fields')
      .update({ logged_at: stamp })
      .in('id', done.map((f) => f.id));
  }
}

async function loadJobForAction(supabase: ReturnType<typeof createClient>, id: string) {
  const { data: job } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle();
  if (!job) throw new Error('Job not found');
  const { data: fields } = await supabase.from('job_fields').select('*').eq('job_id', id).order('sort_order');
  return { job: job as JobRowForCommit & { assignee_user_id: string | null; delegated_to_user_id: string | null }, fields: (fields ?? []) as JobFieldRowForCommit[] };
}

export async function saveJobCompletion(formData: FormData) {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) throw new Error('Not signed in');
  const id = String(formData.get('job_id') ?? '');
  if (!id) throw new Error('Missing job id');

  const { job, fields } = await loadJobForAction(supabase, id);
  const isAssignee = job.assignee_user_id === ctx.userId;
  const isDelegate = job.delegated_to_user_id === ctx.userId;
  const isFarmMember = job.user_id === ctx.ownerId; // staff or admin of this farm
  if (!isAssignee && !isDelegate && !isFarmMember) throw new Error('You cannot complete this job');
  if (job.status === 'approved') redirect(`/jobs/${id}`); // already logged

  let completions: { id: string; status: string; actual_rate?: number | null; note?: string | null }[];
  try {
    completions = JSON.parse(String(formData.get('completions') ?? '[]'));
  } catch {
    throw new Error('Could not read the completion — try again');
  }
  const valid = new Set(['pending', 'done', 'partial', 'skipped']);
  const byId = new Map(fields.map((f) => [f.id, f]));
  for (const c of completions) {
    if (!byId.has(c.id) || !valid.has(c.status)) continue;
    // A field already logged (from an earlier approval, before a reopen) is
    // immutable — its record is written. Ignore any attempt to change it.
    if (byId.get(c.id)!.logged_at != null) continue;
    const rate = c.actual_rate == null || !Number.isFinite(Number(c.actual_rate)) ? null : Number(c.actual_rate);
    await supabase.from('job_fields').update({
      status: c.status,
      actual_rate_value: rate,
      completion_note: c.note && String(c.note).trim() !== '' ? String(c.note).trim().slice(0, 500) : null,
    }).eq('id', c.id);
    const f = byId.get(c.id)!;
    f.status = c.status;
    f.actual_rate_value = rate;
  }

  if (isFarmMember) {
    // Trusted: log immediately.
    await commitJobRecords(supabase, ctx.userId, job, fields);
    await supabase.from('jobs').update({ status: 'approved', submitted_at: new Date().toISOString(), approved_at: new Date().toISOString() }).eq('id', id);
  } else {
    await supabase.from('jobs').update({ status: 'submitted', submitted_at: new Date().toISOString() }).eq('id', id);
    await sendPushToUser(job.user_id, { title: 'Job submitted for approval', body: 'A contractor has finished a job — tap to review.', url: `/jobs/${id}`, tag: `job-${id}` });
  }
  revalidatePath(`/jobs/${id}`);
  revalidatePath('/jobs');
  redirect(`/jobs/${id}`);
}

export async function approveJob(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing job id');
  const { job, fields } = await loadJobForAction(supabase, id);
  if (job.user_id !== ctx.ownerId) throw new Error('Not your job');
  if (job.status === 'approved') redirect(`/jobs/${id}`);
  await commitJobRecords(supabase, ctx.userId, job, fields);
  await supabase.from('jobs').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', id);
  revalidatePath(`/jobs/${id}`);
  revalidatePath('/jobs');
  redirect(`/jobs/${id}`);
}

export async function reopenJob(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing job id');
  const { job } = await loadJobForAction(supabase, id);
  if (job.user_id !== ctx.ownerId) throw new Error('Not your job');
  await supabase.from('jobs').update({ status: 'sent', submitted_at: null, declined_reason: null, declined_at: null }).eq('id', id);
  revalidatePath(`/jobs/${id}`);
  redirect(`/jobs/${id}`);
}

// The contractor/operator a job was sent to declines it (instead of completing
// it). Only valid from 'sent'; records an optional reason and notifies the
// farm so they can re-assign. The column guard (20260618) permits the
// status → 'declined' move for the assignee/delegate.
/** Dismiss a computed home-page warning (admin acknowledges it). Farm-scoped:
 *  hidden for all admins of the farm. Idempotent via the unique constraint. */
export async function dismissNotification(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const warningId = String(formData.get('warning_id') ?? '').trim();
  if (!warningId) throw new Error('Missing warning id');
  const { error } = await supabase.from('dismissed_notifications')
    .upsert({ owner_id: ctx.ownerId, warning_id: warningId, dismissed_by: ctx.userId },
            { onConflict: 'owner_id,warning_id' });
  if (error) throw new Error(error.message);
  revalidatePath('/');
}

/** Undo a notification dismissal — the warning reappears if still live. */
export async function restoreNotification(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const warningId = String(formData.get('warning_id') ?? '').trim();
  if (!warningId) throw new Error('Missing warning id');
  const { error } = await supabase.from('dismissed_notifications')
    .delete().eq('owner_id', ctx.ownerId).eq('warning_id', warningId);
  if (error) throw new Error(error.message);
  revalidatePath('/');
}

/** Edit the completion date of a logged (approved) job. Moves the job's
 *  approved_at AND the date_applied of every application record this job wrote,
 *  so the job and the Activity feed always agree. Admin only. */
export async function updateJobCompletionDate(formData: FormData) {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) throw new Error('Not signed in');
  await requireAdmin();
  const id = String(formData.get('job_id') ?? '');
  const dateStr = String(formData.get('completed_on') ?? '').trim();
  if (!id) throw new Error('Missing job id');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error('Enter a valid date');

  const { job } = await loadJobForAction(supabase, id);
  if (job.status !== 'approved') throw new Error('Only a logged job’s date can be edited');

  // Preserve the original time-of-day; only shift the calendar date.
  const prevTime = job.approved_at ? job.approved_at.slice(10) : 'T12:00:00.000Z';
  const newApprovedAt = `${dateStr}${prevTime}`;

  const { error: jobErr } = await supabase.from('jobs')
    .update({ approved_at: newApprovedAt }).eq('id', id);
  if (jobErr) throw new Error(jobErr.message);

  // Cascade to the application records this job wrote.
  const { error: appErr } = await supabase.from('applications')
    .update({ date_applied: dateStr }).eq('job_id', id);
  if (appErr) throw new Error(appErr.message);

  revalidatePath(`/jobs/${id}`);
  revalidatePath('/');
  redirect(`/jobs/${id}`);
}

export async function declineJob(formData: FormData) {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) throw new Error('Not signed in');
  const id = String(formData.get('job_id') ?? '');
  if (!id) throw new Error('Missing job id');

  const { job } = await loadJobForAction(supabase, id);
  const isAssignee = job.assignee_user_id === ctx.userId;
  const isDelegate = job.delegated_to_user_id === ctx.userId;
  if (!isAssignee && !isDelegate) throw new Error('Only the contractor this job was sent to can decline it');
  if (job.status !== 'sent') throw new Error('This job can no longer be declined');

  const reason = String(formData.get('reason') ?? '').trim().slice(0, 500) || null;
  const { error } = await supabase
    .from('jobs')
    .update({ status: 'declined', declined_reason: reason, declined_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);

  await sendPushToUser(job.user_id, {
    title: 'Job declined',
    body: `A contractor declined "${job.title}"${reason ? ` — ${reason}` : ''}. Tap to re-assign.`,
    url: `/jobs/${id}`,
    tag: `job-${id}`,
  });
  revalidatePath(`/jobs/${id}`);
  redirect('/jobs');
}

// ---------------------------------------------------------------------------
// Job sheets — Phase 3: no-account share links. The admin generates a token
// (optional PIN + expiry); an unauthenticated recipient opens it in a browser.
// Anonymous reads/writes go through the SERVICE client (RLS can't scope an
// anonymous user), with the token validated in code. Share submissions always
// land as 'submitted' and wait for admin approval.
// ---------------------------------------------------------------------------
export async function createShareLink(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing job id');
  const { data: job } = await supabase.from('jobs').select('id, user_id').eq('id', id).maybeSingle();
  if (!job || (job as { user_id: string }).user_id !== ctx.ownerId) throw new Error('Not your job');

  const pinRaw = String(formData.get('pin') ?? '').trim();
  const expiry = String(formData.get('expiry_days') ?? '30');
  let expiresAt: string | null = null;
  if (expiry !== 'never') {
    const days = parseInt(expiry, 10);
    if (Number.isFinite(days) && days > 0) expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  }
  const token = randomBytes(18).toString('base64url');
  const { error } = await supabase.from('jobs').update({
    share_token: token,
    share_pin: pinRaw === '' ? null : pinRaw,
    share_expires_at: expiresAt,
    share_pin_attempts: 0,
    share_pin_locked_until: null,
  }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath(`/jobs/${id}`);
  redirect(`/jobs/${id}`);
}

export async function revokeShareLink(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing job id');
  const { data: job } = await supabase.from('jobs').select('id, user_id').eq('id', id).maybeSingle();
  if (!job || (job as { user_id: string }).user_id !== ctx.ownerId) throw new Error('Not your job');
  const { error } = await supabase.from('jobs').update({ share_token: null, share_pin: null, share_expires_at: null }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath(`/jobs/${id}`);
  redirect(`/jobs/${id}`);
}

interface SharedJobResult {
  status?: 'ok' | 'needpin' | 'badpin' | 'locked' | 'notfound' | 'expired' | 'closed';
  job?: {
    id: string; title: string; job_type: string; instruction: string | null;
    product_name: string | null; rate_value: number | null; rate_unit: string | null; rate_noun: string | null;
    water_l_per_ha: number | null; spray_spec: { name: string; l_per_ha: number | null }[] | null;
    notes: string | null; due_date: string | null; contractor_label: string | null; status: string; farm_name: string | null; business_name: string | null;
  };
  fields?: { id: string; field_name: string; boundary: unknown | null; area_ha: number | null; planned_rate_value: number | null; planned_rate_unit: string | null; status: string; actual_rate_value: number | null }[];
}

// ---- Share-link PIN protection -------------------------------------
// The token (randomBytes(18)) is the real secret; the optional PIN is a
// second factor for a link pasted into the wrong WhatsApp group. Two fixes
// over v1: (a) constant-time comparison, (b) an attempt counter — 10 wrong
// PINs locks the link for 15 minutes, so a 4-digit PIN can no longer be
// brute-forced in one sitting by anyone holding the URL.
const PIN_MAX_ATTEMPTS = 10;
const PIN_LOCK_MINUTES = 15;

function pinsMatch(supplied: string, stored: string): boolean {
  // Pad both to a fixed width so timingSafeEqual gets equal-length buffers
  // and length itself leaks nothing. PINs are short; 64 bytes is plenty.
  const norm = (x: string) => Buffer.concat([Buffer.from(x, 'utf8'), Buffer.alloc(64)]).subarray(0, 64);
  return timingSafeEqual(norm(supplied), norm(stored));
}

/** Returns 'locked' if this link is currently PIN-locked, else null. */
function pinLockStatus(j: Record<string, unknown>): 'locked' | null {
  const until = j.share_pin_locked_until ? new Date(j.share_pin_locked_until as string).getTime() : 0;
  return until > Date.now() ? 'locked' : null;
}

/** Count a wrong PIN; returns the status to surface ('badpin' or 'locked'). */
async function recordBadPin(svc: ReturnType<typeof createServiceClient>, j: Record<string, unknown>): Promise<'badpin' | 'locked'> {
  const attempts = (typeof j.share_pin_attempts === 'number' ? j.share_pin_attempts : 0) + 1;
  const lock = attempts >= PIN_MAX_ATTEMPTS;
  // Best-effort: if the 20260616 migration hasn't been run yet these columns
  // don't exist and the update no-ops with an error — behaviour then degrades
  // to the old (uncounted) one rather than breaking the link.
  await svc.from('jobs').update({
    share_pin_attempts: lock ? 0 : attempts,
    share_pin_locked_until: lock ? new Date(Date.now() + PIN_LOCK_MINUTES * 60000).toISOString() : null,
  }).eq('id', j.id as string);
  return lock ? 'locked' : 'badpin';
}

// Anonymous read of a shared job by token (validates PIN + expiry in code).
export async function loadSharedJob(token: string, pin?: string): Promise<SharedJobResult> {
  if (!token) return { status: 'notfound' };
  const svc = createServiceClient();
  const { data: job } = await svc.from('jobs').select('*').eq('share_token', token).maybeSingle();
  if (!job) return { status: 'notfound' };
  const j = job as Record<string, unknown>;
  if (j.share_expires_at && new Date(j.share_expires_at as string).getTime() < Date.now()) return { status: 'expired' };
  if (j.share_pin) {
    if (pinLockStatus(j)) return { status: 'locked' };
    if (pin == null || pin === '') return { status: 'needpin' };
    if (!pinsMatch(String(pin), String(j.share_pin))) {
      return { status: await recordBadPin(svc, j) };
    }
    if ((typeof j.share_pin_attempts === 'number' && j.share_pin_attempts > 0) || j.share_pin_locked_until) {
      await svc.from('jobs').update({ share_pin_attempts: 0, share_pin_locked_until: null }).eq('id', j.id as string);
    }
  }
  const def = jobTypeDef(j.job_type as string);
  let productName: string | null = null;
  if (def?.commitsTo === 'applications' && j.product_id != null) {
    const { data: p } = await svc.from('products').select('name').eq('id', j.product_id).maybeSingle();
    productName = (p as { name: string } | null)?.name ?? null;
  }
  const { data: fields } = await svc.from('job_fields').select('*').eq('job_id', j.id as string).order('sort_order');
  const spec = Array.isArray(j.spray_spec) ? (j.spray_spec as { name: string; l_per_ha: number | null }[]).map((s) => ({ name: s.name, l_per_ha: s.l_per_ha })) : null;
  // Submitting farm's identity, read live from the owner's settings so the
  // contractor/worker sees who sent the sheet (business name + farm name).
  let businessName: string | null = null;
  let ownerFarmName: string | null = null;
  if (j.user_id) {
    const { data: st } = await svc.from('settings').select('data').eq('user_id', j.user_id as string).maybeSingle();
    const sd = (st?.data ?? {}) as { businessName?: string; farmName?: string };
    businessName = (sd.businessName ?? '').trim() || null;
    ownerFarmName = (sd.farmName ?? '').trim() || null;
  }
  return {
    status: 'ok',
    job: {
      id: j.id as string,
      title: j.title as string,
      job_type: j.job_type as string,
      instruction: (j.instruction as string) ?? null,
      product_name: productName,
      rate_value: (j.rate_value as number) ?? null,
      rate_unit: (j.rate_unit as string) ?? null,
      rate_noun: def?.rateNoun ?? null,
      water_l_per_ha: (j.water_l_per_ha as number) ?? null,
      spray_spec: spec,
      notes: (j.notes as string) ?? null,
      due_date: (j.due_date as string) ?? null,
      contractor_label: (j.contractor_label as string) ?? null,
      status: j.status as string,
      farm_name: (j.farm_name as string) ?? ownerFarmName,
      business_name: businessName,
    },
    fields: ((fields ?? []) as Record<string, unknown>[]).map((f) => ({
      id: f.id as string,
      field_name: f.field_name as string,
      boundary: f.boundary ?? null,
      area_ha: (f.area_ha as number) ?? null,
      planned_rate_value: (f.planned_rate_value as number) ?? null,
      planned_rate_unit: (f.planned_rate_unit as string) ?? null,
      status: f.status as string,
      actual_rate_value: (f.actual_rate_value as number) ?? null,
    })),
  };
}

export async function submitSharedJob(token: string, pin: string | undefined, completionsJson: string): Promise<{ ok: boolean; error?: string }> {
  if (!token) return { ok: false, error: 'Invalid link' };
  const svc = createServiceClient();
  const { data: job } = await svc.from('jobs').select('*').eq('share_token', token).maybeSingle();
  if (!job) return { ok: false, error: 'This link is no longer valid' };
  const j = job as Record<string, unknown>;
  if (j.share_expires_at && new Date(j.share_expires_at as string).getTime() < Date.now()) return { ok: false, error: 'This link has expired' };
  if (j.share_pin) {
    if (pinLockStatus(j)) return { ok: false, error: 'Too many wrong PINs — this link is locked for a few minutes' };
    if (!pinsMatch(String(pin ?? ''), String(j.share_pin))) {
      const st = await recordBadPin(svc, j);
      return { ok: false, error: st === 'locked' ? 'Too many wrong PINs — this link is locked for a few minutes' : 'Wrong PIN' };
    }
  }
  if (j.status === 'approved') return { ok: false, error: 'This job has already been logged' };

  let completions: { id: string; status: string; actual_rate?: number | null; note?: string | null }[];
  try { completions = JSON.parse(completionsJson); } catch { return { ok: false, error: 'Could not read the completion' }; }
  if (!Array.isArray(completions)) return { ok: false, error: 'Could not read the completion' };
  const { data: fieldRows } = await svc.from('job_fields').select('id').eq('job_id', j.id as string);
  const ownIds = new Set(((fieldRows ?? []) as { id: string }[]).map((f) => f.id));
  const valid = new Set(['pending', 'done', 'partial', 'skipped']);
  for (const c of completions) {
    if (!ownIds.has(c.id) || !valid.has(c.status)) continue;
    // Rate sanity: finite, positive, and not a fat-fingered nonsense number.
    const rateNum = Number(c.actual_rate);
    const rate = c.actual_rate == null || !Number.isFinite(rateNum) || rateNum <= 0 || rateNum >= 100000 ? null : rateNum;
    const note = c.note && String(c.note).trim() !== '' ? String(c.note).trim().slice(0, 500) : null;
    await svc.from('job_fields').update({
      status: c.status,
      actual_rate_value: rate,
      completion_note: note,
    }).eq('id', c.id);
  }
  // Re-submission before approval is allowed (fixing a mistake), but only the
  // FIRST submission pushes a notification — holding the link no longer lets
  // someone ping the farmer's phone on a loop.
  const firstSubmission = j.status !== 'submitted';
  await svc.from('jobs').update({ status: 'submitted', submitted_at: new Date().toISOString() }).eq('id', j.id as string);
  if (firstSubmission) {
    await sendPushToUser(j.user_id as string, { title: 'Job submitted for approval', body: 'A shared job sheet was completed — tap to review.', url: `/jobs/${j.id}`, tag: `job-${j.id}` });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Job sheets — Phase 4: contractor accounts by ID + forwarding to operators.
// A contractor opts in (gets a code); a farm connects to that code and can
// then assign jobs to the contractor. The contractor receives the job in their
// app (via the assignee mechanism + RLS) and can complete it OR forward it to
// one of their own staff. All contractor submissions need farm approval.
// ---------------------------------------------------------------------------

function makeContractorCode(): string {
  return randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 8).toUpperCase();
}

export async function becomeContractor(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const businessName = String(formData.get('business_name') ?? '').trim() || null;

  const { data: existing } = await supabase.from('contractor_profiles').select('user_id, code').eq('user_id', user.id).maybeSingle();
  if (existing) {
    const { error } = await supabase.from('contractor_profiles').update({ business_name: businessName }).eq('user_id', user.id);
    if (error) throw new Error(error.message);
  } else {
    let lastErr: string | null = null;
    for (let i = 0; i < 4; i++) {
      const { error } = await supabase.from('contractor_profiles').insert({ user_id: user.id, code: makeContractorCode(), business_name: businessName });
      if (!error) { lastErr = null; break; }
      lastErr = error.message;
      if (!/duplicate|unique/i.test(error.message)) break; // only retry on code collision
    }
    if (lastErr) throw new Error(lastErr);
  }
  revalidatePath('/settings/contractors');
  redirect('/settings/contractors');
}

export async function connectContractor(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const code = String(formData.get('code') ?? '').trim().toUpperCase();
  if (!code) throw new Error('Enter a contractor code');

  // Look up the code with the service client (contractor profiles are private).
  const svc = createServiceClient();
  const { data: prof } = await svc.from('contractor_profiles').select('user_id, business_name').eq('code', code).maybeSingle();
  if (!prof) throw new Error('No contractor found with that code');
  const contractorUserId = (prof as { user_id: string }).user_id;
  if (contractorUserId === ctx.ownerId) throw new Error('That code is your own account');

  const label = String(formData.get('label') ?? '').trim() || (prof as { business_name: string | null }).business_name || 'Contractor';
  const { error } = await supabase.from('farm_contractors').upsert({
    owner_id: ctx.ownerId,
    contractor_user_id: contractorUserId,
    label,
  }, { onConflict: 'owner_id,contractor_user_id' });
  if (error) throw new Error(error.message);
  revalidatePath('/settings/contractors');
  revalidatePath('/jobs/new');
  redirect('/settings/contractors');
}

export async function removeContractor(formData: FormData) {
  const supabase = createClient();
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing id');
  const { error } = await supabase.from('farm_contractors').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/settings/contractors');
  redirect('/settings/contractors');
}

// Contractor admin forwards a received job to one of their own operators.
export async function forwardJob(formData: FormData) {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) throw new Error('Not signed in');
  const id = String(formData.get('id') ?? '');
  const target = String(formData.get('operator_id') ?? '');
  if (!id) throw new Error('Missing job id');

  const { data: job } = await supabase.from('jobs').select('id, assignee_user_id, status').eq('id', id).maybeSingle();
  if (!job) throw new Error('Job not found');
  if ((job as { assignee_user_id: string | null }).assignee_user_id !== ctx.userId) throw new Error('Only the contractor this job was sent to can forward it');

  let delegate: string | null = null;
  if (target) {
    // Validate the target is a staff member of THIS contractor's account.
    const { data: member } = await supabase.from('farm_members').select('member_id').eq('owner_id', ctx.ownerId).eq('member_id', target).maybeSingle();
    if (!member) throw new Error('That operator is not on your team');
    delegate = target;
  }
  const { error } = await supabase.from('jobs').update({ delegated_to_user_id: delegate }).eq('id', id);
  if (error) throw new Error(error.message);
  if (delegate) await sendPushToUser(delegate, { title: 'Job forwarded to you', body: 'You have a new job to do — tap to open.', url: '/jobs', tag: `job-${id}` });
  revalidatePath(`/jobs/${id}`);
  redirect(`/jobs/${id}`);
}

// ---------------------------------------------------------------------------
// Job sheets — Phase 5: time tracking. The person doing the job (assignee,
// forwarded operator, or a farm member) runs a timer or enters minutes by hand.
// ---------------------------------------------------------------------------

async function canWorkJob(supabase: ReturnType<typeof createClient>, jobId: string) {
  const ctx = await getFarmContext();
  if (!ctx) throw new Error('Not signed in');
  const { data: job } = await supabase.from('jobs').select('id, user_id, assignee_user_id, delegated_to_user_id, work_started_at, work_minutes').eq('id', jobId).maybeSingle();
  if (!job) throw new Error('Job not found');
  const j = job as { user_id: string; assignee_user_id: string | null; delegated_to_user_id: string | null; work_started_at: string | null; work_minutes: number | null };
  const allowed = j.assignee_user_id === ctx.userId || j.delegated_to_user_id === ctx.userId || j.user_id === ctx.ownerId;
  if (!allowed) throw new Error('You cannot record time on this job');
  return j;
}

export async function startJobTimer(formData: FormData) {
  const supabase = createClient();
  const id = String(formData.get('id') ?? '');
  const j = await canWorkJob(supabase, id);
  if (!j.work_started_at) {
    const { error } = await supabase.from('jobs').update({ work_started_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/jobs/${id}`);
  redirect(`/jobs/${id}`);
}

export async function stopJobTimer(formData: FormData) {
  const supabase = createClient();
  const id = String(formData.get('id') ?? '');
  const j = await canWorkJob(supabase, id);
  if (j.work_started_at) {
    const elapsedMin = Math.max(0, Math.floor((Date.now() - new Date(j.work_started_at).getTime()) / 60000));
    const total = (j.work_minutes ?? 0) + elapsedMin;
    const { error } = await supabase.from('jobs').update({ work_started_at: null, work_minutes: total }).eq('id', id);
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/jobs/${id}`);
  redirect(`/jobs/${id}`);
}

export async function setJobMinutes(formData: FormData) {
  const supabase = createClient();
  const id = String(formData.get('id') ?? '');
  await canWorkJob(supabase, id);
  const raw = String(formData.get('minutes') ?? '').trim();
  const mins = raw === '' ? null : Math.max(0, Math.round(Number(raw)));
  if (raw !== '' && !Number.isFinite(Number(raw))) throw new Error('Invalid minutes');
  const { error } = await supabase.from('jobs').update({ work_minutes: mins, work_started_at: null }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath(`/jobs/${id}`);
  redirect(`/jobs/${id}`);
}

// ---------------------------------------------------------------------------
// Web push subscriptions — store/remove the browser's push endpoint.
// ---------------------------------------------------------------------------
export async function savePushSubscription(subJson: string): Promise<{ ok: boolean }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  let sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try { sub = JSON.parse(subJson); } catch { return { ok: false }; }
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return { ok: false };
  const { error } = await supabase.from('push_subscriptions').upsert(
    { user_id: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    { onConflict: 'endpoint' },
  );
  return { ok: !error };
}

export async function deletePushSubscription(endpoint: string): Promise<{ ok: boolean }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  return { ok: !error };
}


// Rename a team member (admins for their farm; anyone for their own row).
export async function renameFarmMember(formData: FormData) {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) throw new Error('Not signed in');
  const memberId = String(formData.get('member_id') ?? '');
  const name = String(formData.get('name') ?? '').trim().slice(0, 60);
  if (!memberId) throw new Error('Missing member');
  const { error } = await supabase
    .from('farm_members')
    .update({ member_name: name || null })
    .eq('owner_id', ctx.ownerId)
    .eq('member_id', memberId);
  if (error) throw new Error(error.message);
  revalidatePath('/settings/team');
  redirect('/settings/team');
}

// Duplicate a job: fresh copy of the spec + field snapshots, statuses reset,
// share link / timestamps / forwarding cleared. "Same round as last month."
export async function duplicateJob(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing job id');

  const { data: src } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle();
  if (!src || (src as { user_id: string }).user_id !== ctx.ownerId) throw new Error('Not your job');
  const j = src as Record<string, unknown>;

  const { data: stRow } = await supabase.from('settings').select('data').eq('user_id', ctx.ownerId).maybeSingle();
  const farmName = (stRow?.data as { farmName?: string } | null)?.farmName ?? (j.farm_name as string) ?? null;

  const { data: created, error } = await supabase.from('jobs').insert({
    user_id: ctx.ownerId,
    created_by: ctx.userId,
    farm_name: farmName,
    title: j.title,
    job_type: j.job_type,
    status: 'sent',
    product_id: j.product_id,
    rate_value: j.rate_value,
    rate_unit: j.rate_unit,
    water_l_per_ha: j.water_l_per_ha,
    spray_spec: j.spray_spec,
    instruction: j.instruction,
    notes: j.notes,
    due_date: null,
    assignee_user_id: j.assignee_user_id,
    contractor_label: j.contractor_label,
  }).select('id').single();
  if (error || !created) throw new Error(error?.message ?? 'Could not duplicate');
  const newId = (created as { id: string }).id;

  const { data: fields } = await supabase.from('job_fields').select('*').eq('job_id', id).order('sort_order');
  const copies = ((fields ?? []) as Record<string, unknown>[]).map((f) => ({
    job_id: newId,
    field_id: f.field_id,
    field_name: f.field_name,
    boundary: f.boundary,
    area_ha: f.area_ha,
    planned_rate_value: f.planned_rate_value,
    planned_rate_unit: f.planned_rate_unit,
    status: 'pending',
    sort_order: f.sort_order,
  }));
  if (copies.length > 0) {
    const { error: fErr } = await supabase.from('job_fields').insert(copies);
    if (fErr) throw new Error(fErr.message);
  }

  if (j.assignee_user_id) await sendPushToUser(j.assignee_user_id as string, { title: 'New job', body: `${farmName ?? 'A farm'}: ${j.title}`, url: '/jobs', tag: `job-${newId}` });

  revalidatePath('/jobs');
  redirect(`/jobs/${newId}`);
}

// =====================================================================
// Crops — allocate a field to a crop, and manage the allocation lifecycle.
// Allocating/terminating a crop is a LOGGING action: admin/staff only (the
// agronomist is a read-only advisor). RLS enforces this too (can_log_of).
// =====================================================================

const CROP_SEASON_MIN = 2020;
const CROP_SEASON_MAX = 2100;

function parseOptionalYield(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Expected yield must be a number greater than 0');
  return n;
}

function parseOptionalDate(raw: string): string | null {
  const s = raw.trim();
  if (s === '') return null;
  if (!isValidIsoDate(s)) throw new Error('Invalid date — use the date picker');
  return s;
}

/** Allocate a field to a crop for a season. Becomes the field's ACTIVE crop if
 *  none is active; otherwise it's queued as 'planned' (one active occupant is
 *  enforced by a partial unique index — activate it once the current crop is
 *  harvested). */
export async function allocateFieldToCrop(formData: FormData) {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  if (ctx.role === 'agronomist') throw new Error('Agronomists cannot allocate crops');
  const supabase = createClient();

  const fieldId = String(formData.get('field_id') ?? '').trim();
  const cropId = String(formData.get('crop_id') ?? '').trim();
  if (!fieldId) throw new Error('Field is required');
  if (!cropId) throw new Error('Crop is required');

  const season = parseInt(String(formData.get('season') ?? ''), 10);
  if (!Number.isInteger(season) || season < CROP_SEASON_MIN || season > CROP_SEASON_MAX) {
    throw new Error('Invalid season');
  }
  const expectedYield = parseOptionalYield(String(formData.get('expected_yield') ?? ''));
  const sownDate = parseOptionalDate(String(formData.get('sown_date') ?? ''));
  const harvestDate = parseOptionalDate(String(formData.get('harvest_date') ?? ''));
  const notes = clampNotes(String(formData.get('notes') ?? ''));

  // The field and crop must both exist on/visible to this farm (RLS scopes the
  // reads; a foreign uuid comes back null).
  const { data: field } = await supabase.from('fields').select('id').eq('id', fieldId).eq('user_id', ctx.ownerId).maybeSingle();
  if (!field) throw new Error('Field not found');
  const { data: crop } = await supabase.from('crops').select('id, seed_key, yield_unit').eq('id', cropId).maybeSingle();
  if (!crop) throw new Error('Crop not found');

  // One active occupant per field (unique index). The per-field form omits
  // 'status' and we auto-decide (planned if a crop is already active, else
  // active). The crops-menu allocator passes an explicit 'planned'/'active';
  // forcing 'active' over an existing active crop performs the catch-crop ->
  // main-crop handover (the current active is marked harvested first).
  const { data: active } = await supabase
    .from('field_crop_allocations').select('id')
    .eq('field_id', fieldId).eq('status', 'active').maybeSingle();

  const requested = String(formData.get('status') ?? '').trim();
  const status: 'planned' | 'active' =
    requested === 'planned' || requested === 'active'
      ? requested
      : (active ? 'planned' : 'active');

  if (status === 'active' && active) {
    const { error: handoverErr } = await supabase
      .from('field_crop_allocations')
      .update({ status: 'harvested' })
      .eq('id', (active as { id: string }).id);
    if (handoverErr) throw new Error(`Could not hand over the current crop: ${handoverErr.message}`);
  }

  const { error } = await supabase.from('field_crop_allocations').insert({
    user_id: ctx.ownerId,
    field_id: fieldId,
    crop_id: cropId,
    crop_key: (crop as { seed_key: string | null }).seed_key ?? null,
    season,
    expected_yield: expectedYield,
    expected_yield_unit: expectedYield != null ? (crop as { yield_unit: string }).yield_unit : null,
    sown_date: sownDate,
    harvest_date: harvestDate,
    status,
    notes,
    created_by: ctx.userId,
  });
  if (error) throw new Error(`Could not allocate crop: ${error.message}`);

  revalidatePath(`/fields/${fieldId}/crop`);
  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/crops');
  revalidatePath('/');
}

/** Change an allocation's lifecycle status. Activating a crop first marks any
 *  other active crop on the same field 'harvested' (the catch → main-crop
 *  transition). */
export async function setCropAllocationStatus(formData: FormData) {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  if (ctx.role === 'agronomist') throw new Error('Agronomists cannot change crop allocations');
  const supabase = createClient();

  const id = String(formData.get('allocation_id') ?? '').trim();
  const status = String(formData.get('status') ?? '').trim();
  if (!id) throw new Error('Allocation is required');
  if (!['planned', 'active', 'harvested', 'terminated'].includes(status)) throw new Error('Invalid status');

  const { data: alloc } = await supabase
    .from('field_crop_allocations').select('id, field_id')
    .eq('id', id).eq('user_id', ctx.ownerId).maybeSingle();
  if (!alloc) throw new Error('Allocation not found');
  const fieldId = (alloc as { field_id: string }).field_id;

  if (status === 'active') {
    // Demote any other active crop on this field so the unique index is happy.
    const { error: demoteErr } = await supabase
      .from('field_crop_allocations')
      .update({ status: 'harvested', updated_at: new Date().toISOString() })
      .eq('field_id', fieldId).eq('status', 'active').neq('id', id);
    if (demoteErr) throw new Error(`Could not update the current crop: ${demoteErr.message}`);
  }

  const { error } = await supabase
    .from('field_crop_allocations')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', ctx.ownerId);
  if (error) throw new Error(`Could not update crop status: ${error.message}`);

  revalidatePath(`/fields/${fieldId}/crop`);
  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/crops');
  revalidatePath('/');
}

/** Edit an allocation's expected yield, sown/harvest dates and notes. */
export async function updateCropAllocation(formData: FormData) {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  if (ctx.role === 'agronomist') throw new Error('Agronomists cannot edit crop allocations');
  const supabase = createClient();

  const id = String(formData.get('allocation_id') ?? '').trim();
  if (!id) throw new Error('Allocation is required');

  const { data: alloc } = await supabase
    .from('field_crop_allocations').select('id, field_id, crop_id')
    .eq('id', id).eq('user_id', ctx.ownerId).maybeSingle();
  if (!alloc) throw new Error('Allocation not found');
  const fieldId = (alloc as { field_id: string }).field_id;

  const expectedYield = parseOptionalYield(String(formData.get('expected_yield') ?? ''));
  const sownDate = parseOptionalDate(String(formData.get('sown_date') ?? ''));
  const harvestDate = parseOptionalDate(String(formData.get('harvest_date') ?? ''));
  const notes = clampNotes(String(formData.get('notes') ?? ''));

  // Keep expected_yield_unit consistent with the crop when a yield is set.
  let yieldUnit: string | null = null;
  if (expectedYield != null) {
    const { data: crop } = await supabase.from('crops').select('yield_unit').eq('id', (alloc as { crop_id: string }).crop_id).maybeSingle();
    yieldUnit = crop ? (crop as { yield_unit: string }).yield_unit : null;
  }

  const { error } = await supabase
    .from('field_crop_allocations')
    .update({
      expected_yield: expectedYield,
      expected_yield_unit: yieldUnit,
      sown_date: sownDate,
      harvest_date: harvestDate,
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id).eq('user_id', ctx.ownerId);
  if (error) throw new Error(`Could not update allocation: ${error.message}`);

  revalidatePath(`/fields/${fieldId}/crop`);
  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
}

/** Remove a crop allocation entirely. */
export async function deleteCropAllocation(formData: FormData) {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  if (ctx.role === 'agronomist') throw new Error('Agronomists cannot delete crop allocations');
  const supabase = createClient();

  const id = String(formData.get('allocation_id') ?? '').trim();
  if (!id) throw new Error('Allocation is required');

  const { data: alloc } = await supabase
    .from('field_crop_allocations').select('id, field_id')
    .eq('id', id).eq('user_id', ctx.ownerId).maybeSingle();
  if (!alloc) throw new Error('Allocation not found');
  const fieldId = (alloc as { field_id: string }).field_id;

  const { error } = await supabase.from('field_crop_allocations').delete().eq('id', id).eq('user_id', ctx.ownerId);
  if (error) throw new Error(`Could not delete allocation: ${error.message}`);

  revalidatePath(`/fields/${fieldId}/crop`);
  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/crops');
  revalidatePath('/');
}

// ===== Agreements: field membership (third grouping axis) =====
//
// Set the full set of agreements a field belongs to in one shot. Mirrors
// setGroupMembership, but agreements are MANY-to-many, so we diff the current
// memberships against the requested set and apply adds/removes rather than
// overwrite a single FK. Assigning a field to a scheme is a logging-style
// action, so the read-only agronomist is excluded (consistent with crops).
export async function setFieldAgreements(formData: FormData) {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  if (ctx.role === 'agronomist') throw new Error('Agronomists cannot change agreements');
  const supabase = createClient();

  const fieldId = String(formData.get('field_id') ?? '').trim();
  if (!fieldId) throw new Error('Field is required');

  // Empty string is valid — means "no agreements on this field".
  const raw = String(formData.get('agreement_ids') ?? '').trim();
  const targetIds = raw === '' ? [] : raw.split(',').map((s) => s.trim()).filter(Boolean);

  // Field must belong to this farm (RLS scopes the read; a foreign uuid is null).
  const { data: field } = await supabase
    .from('fields').select('id').eq('id', fieldId).eq('user_id', ctx.ownerId).maybeSingle();
  if (!field) throw new Error('Field not found');

  // Current memberships for this field.
  const { data: current, error: curErr } = await supabase
    .from('field_agreements').select('id, agreement_id')
    .eq('field_id', fieldId).eq('user_id', ctx.ownerId);
  if (curErr) throw new Error(curErr.message);

  const currentRows = (current ?? []) as { id: string; agreement_id: string }[];
  const haveAgreement = new Set(currentRows.map((r) => r.agreement_id));
  const targetSet = new Set(targetIds);

  // Remove memberships no longer wanted.
  const removeRowIds = currentRows.filter((r) => !targetSet.has(r.agreement_id)).map((r) => r.id);
  if (removeRowIds.length) {
    const { error } = await supabase.from('field_agreements').delete().in('id', removeRowIds);
    if (error) throw new Error(`Could not remove agreements: ${error.message}`);
  }

  // Add newly-ticked agreements — validate they're visible to this farm first
  // (a shared seed or one of this farm's customs).
  const addIds = targetIds.filter((id) => !haveAgreement.has(id));
  if (addIds.length) {
    const { data: valid } = await supabase.from('agreements').select('id').in('id', addIds);
    const validSet = new Set(((valid ?? []) as { id: string }[]).map((a) => a.id));
    const rows = addIds.filter((id) => validSet.has(id)).map((id) => ({
      user_id: ctx.ownerId,
      field_id: fieldId,
      agreement_id: id,
      created_by: ctx.userId,
    }));
    if (rows.length) {
      const { error } = await supabase.from('field_agreements').insert(rows);
      if (error) throw new Error(`Could not add agreements: ${error.message}`);
    }
  }

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/fields');
  revalidatePath('/settings/agreements');
  revalidatePath('/');
}

// =====================================================================
// Grouping axes — allocation types & agreements (catalogue + assignment)
// =====================================================================

// Small typed form readers, local to this block.
function gStr(fd: FormData, k: string): string { return String(fd.get(k) ?? '').trim(); }
function gNum(fd: FormData, k: string): number | null { const r = gStr(fd, k); if (r === '') return null; const n = parseFloat(r); return Number.isFinite(n) ? n : null; }
function gInt(fd: FormData, k: string): number | null { const r = gStr(fd, k); if (r === '') return null; const n = parseInt(r, 10); return Number.isFinite(n) ? n : null; }
function gBool(fd: FormData, k: string): boolean { const r = gStr(fd, k); return r === 'on' || r === 'true' || r === '1'; }
function gMd(fd: FormData, k: string): string | null {
  const m = gStr(fd, k).match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const mm = String(Math.min(12, Math.max(1, parseInt(m[1], 10)))).padStart(2, '0');
  const dd = String(Math.min(31, Math.max(1, parseInt(m[2], 10)))).padStart(2, '0');
  return `${mm}-${dd}`;
}

async function requireAdminCtx(action: string) {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  if (!(ctx.isAdmin || ctx.role === 'admin')) throw new Error(`Only an admin can ${action}`);
  return ctx;
}

// ---- Allocation types --------------------------------------------------
export async function createAllocationType(formData: FormData) {
  const ctx = await requireAdminCtx('add an allocation type');
  const supabase = createClient();
  const label = gStr(formData, 'label');
  if (!label) throw new Error('A name is required');
  const kindRaw = gStr(formData, 'kind') || 'custom';
  const kind = ['silage', 'grazing', 'maintenance', 'low_input', 'custom'].includes(kindRaw) ? kindRaw : 'custom';
  const regime = gStr(formData, 'regime_default') === 'grazing' ? 'grazing' : 'silage';
  const { error } = await supabase.from('allocation_types').insert({
    user_id: ctx.ownerId, seed_key: null, label, kind, regime_default: regime,
    earliest_fert_md: gMd(formData, 'earliest_fert_md'),
    n_cap_kg_per_ha: gNum(formData, 'n_cap_kg_per_ha'),
    low_input: gBool(formData, 'low_input'),
    dressing_rhythm: ['after_cut','recurring','none'].includes(gStr(formData, 'dressing_rhythm')) ? gStr(formData, 'dressing_rhythm') : 'after_cut',
    note: gStr(formData, 'note') || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/settings/allocation-types');
}

export async function updateAllocationType(formData: FormData) {
  const ctx = await requireAdminCtx('edit an allocation type');
  const supabase = createClient();
  const id = gStr(formData, 'id');
  if (!id) throw new Error('Allocation type id is required');
  const regime = gStr(formData, 'regime_default') === 'grazing' ? 'grazing' : 'silage';
  // Only the user's own rows are editable (a shared seed is forked first).
  const { error } = await supabase.from('allocation_types').update({
    label: gStr(formData, 'label'),
    regime_default: regime,
    earliest_fert_md: gMd(formData, 'earliest_fert_md'),
    n_cap_kg_per_ha: gNum(formData, 'n_cap_kg_per_ha'),
    low_input: gBool(formData, 'low_input'),
    dressing_rhythm: ['after_cut','recurring','none'].includes(gStr(formData, 'dressing_rhythm')) ? gStr(formData, 'dressing_rhythm') : 'after_cut',
    note: gStr(formData, 'note') || null,
  }).eq('id', id).eq('user_id', ctx.ownerId);
  if (error) throw new Error(error.message);
  revalidatePath('/settings/allocation-types');
}

/** Copy a seed (or any visible type) into an editable user-owned row. */
export async function forkAllocationType(formData: FormData) {
  const ctx = await requireAdminCtx('customise an allocation type');
  const supabase = createClient();
  const sourceId = gStr(formData, 'source_id');
  if (!sourceId) throw new Error('Source id is required');
  const { data: src } = await supabase.from('allocation_types').select('*').eq('id', sourceId).maybeSingle();
  if (!src) throw new Error('Allocation type not found');
  const s = src as Record<string, unknown>;
  // Unique (user_id,label): if the user already has this label, suffix it.
  let label = String(s.label);
  const { data: clash } = await supabase.from('allocation_types').select('id').eq('user_id', ctx.ownerId).eq('label', label).maybeSingle();
  if (clash) label = `${label} (copy)`;
  const { error } = await supabase.from('allocation_types').insert({
    user_id: ctx.ownerId, seed_key: null, label, kind: s.kind, regime_default: s.regime_default,
    earliest_fert_md: s.earliest_fert_md, n_cap_kg_per_ha: s.n_cap_kg_per_ha, low_input: s.low_input,
    dressing_rhythm: s.dressing_rhythm ?? 'after_cut', note: s.note,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/settings/allocation-types');
}

export async function deleteAllocationType(formData: FormData) {
  const ctx = await requireAdminCtx('delete an allocation type');
  const supabase = createClient();
  const id = gStr(formData, 'id');
  if (!id) throw new Error('Allocation type id is required');
  // FK on fields is ON DELETE SET NULL, so this un-assigns fields automatically.
  const { error } = await supabase.from('allocation_types').delete().eq('id', id).eq('user_id', ctx.ownerId);
  if (error) throw new Error(error.message);
  revalidatePath('/settings/allocation-types');
  revalidatePath('/fields');
}

/** Set (or clear, with empty value) a field's one allocation type. */
export async function setFieldAllocationType(formData: FormData) {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  if (ctx.role === 'agronomist') throw new Error('Agronomists cannot change allocation types');
  const supabase = createClient();
  const fieldId = gStr(formData, 'field_id');
  if (!fieldId) throw new Error('Field is required');
  const typeId = gStr(formData, 'allocation_type_id'); // '' clears
  // Validate the type is visible to this farm (seed or own custom).
  if (typeId) {
    const { data: ty } = await supabase.from('allocation_types').select('id').eq('id', typeId).maybeSingle();
    if (!ty) throw new Error('Allocation type not found');
  }
  const { error } = await supabase.from('fields')
    .update({ allocation_type_id: typeId || null, updated_at: new Date().toISOString() })
    .eq('id', fieldId).eq('user_id', ctx.ownerId);
  if (error) throw new Error(error.message);
  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/fields');
  revalidatePath('/');
}

/** Bulk-assign one allocation type to a set of fields (one-per-field). */
export async function setAllocationTypeMembership(formData: FormData) {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  if (ctx.role === 'agronomist') throw new Error('Agronomists cannot change allocation types');
  const supabase = createClient();
  const typeId = gStr(formData, 'allocation_type_id');
  if (!typeId) throw new Error('Allocation type id is required');
  const raw = gStr(formData, 'field_ids');
  const fieldIds = raw === '' ? [] : raw.split(',').filter(Boolean);

  // Clear this type from fields that have it but aren't in the new list.
  if (fieldIds.length === 0) {
    const { error } = await supabase.from('fields')
      .update({ allocation_type_id: null, updated_at: new Date().toISOString() })
      .eq('user_id', ctx.ownerId).eq('allocation_type_id', typeId);
    if (error) throw new Error(error.message);
  } else {
    const { error: clearErr } = await supabase.from('fields')
      .update({ allocation_type_id: null, updated_at: new Date().toISOString() })
      .eq('user_id', ctx.ownerId).eq('allocation_type_id', typeId)
      .not('id', 'in', `(${fieldIds.map((id) => `"${id}"`).join(',')})`);
    if (clearErr) throw new Error(clearErr.message);
    const { error: setErr } = await supabase.from('fields')
      .update({ allocation_type_id: typeId, updated_at: new Date().toISOString() })
      .eq('user_id', ctx.ownerId).in('id', fieldIds);
    if (setErr) throw new Error(setErr.message);
  }
  revalidatePath('/settings/allocation-types');
  revalidatePath('/fields');
  revalidatePath('/');
}

// ---- Agreements (catalogue) -------------------------------------------
function readAgreementFields(formData: FormData) {
  return {
    code: gStr(formData, 'code') || '—',
    name: gStr(formData, 'name'),
    scheme: (['sfi', 'cs', 'es', 'custom'].includes(gStr(formData, 'scheme')) ? gStr(formData, 'scheme') : 'custom'),
    summary: gStr(formData, 'summary') || '',
    no_manufactured_fert: gBool(formData, 'no_manufactured_fert'),
    manufactured_n_cap_kg_ha: gNum(formData, 'manufactured_n_cap_kg_ha'),
    total_n_cap_kg_ha: gNum(formData, 'total_n_cap_kg_ha'),
    organic_manure_cap_t_ha: gNum(formData, 'organic_manure_cap_t_ha'),
    manure_cut_years_only: gBool(formData, 'manure_cut_years_only'),
    organic_n_field_cap_kg_ha: gNum(formData, 'organic_n_field_cap_kg_ha'),
    no_phosphate: gBool(formData, 'no_phosphate'),
    no_potash: gBool(formData, 'no_potash'),
    closed_cut_start_md: gMd(formData, 'closed_cut_start_md'),
    closed_cut_end_md: gMd(formData, 'closed_cut_end_md'),
    earliest_cut_md: gMd(formData, 'earliest_cut_md'),
    manufactured_n_closed_start_md: gMd(formData, 'manufactured_n_closed_start_md'),
    manufactured_n_closed_end_md: gMd(formData, 'manufactured_n_closed_end_md'),
    livestock_exclusion_weeks_pre_cut: gInt(formData, 'livestock_exclusion_weeks_pre_cut'),
    grazing_closed_start_md: gMd(formData, 'grazing_closed_start_md'),
    grazing_closed_end_md: gMd(formData, 'grazing_closed_end_md'),
    max_stocking_lu_ha: gNum(formData, 'max_stocking_lu_ha'),
    no_supplementary_feeding: gBool(formData, 'no_supplementary_feeding'),
    mineral_blocks_allowed: gBool(formData, 'mineral_blocks_allowed'),
    min_ph: gNum(formData, 'min_ph'),
    note: gStr(formData, 'note') || null,
  };
}

export async function createAgreement(formData: FormData) {
  const ctx = await requireAdminCtx('add an agreement');
  const supabase = createClient();
  const fields = readAgreementFields(formData);
  if (!fields.name) throw new Error('A name is required');
  const { error } = await supabase.from('agreements').insert({ user_id: ctx.ownerId, seed_key: null, ...fields });
  if (error) throw new Error(error.message);
  revalidatePath('/settings/agreements');
}

export async function updateAgreement(formData: FormData) {
  const ctx = await requireAdminCtx('edit an agreement');
  const supabase = createClient();
  const id = gStr(formData, 'id');
  if (!id) throw new Error('Agreement id is required');
  const fields = readAgreementFields(formData);
  const { error } = await supabase.from('agreements').update(fields).eq('id', id).eq('user_id', ctx.ownerId);
  if (error) throw new Error(error.message);
  revalidatePath('/settings/agreements');
}

/** Copy a seed (or any visible agreement) into an editable user-owned row. */
export async function forkAgreement(formData: FormData) {
  const ctx = await requireAdminCtx('customise an agreement');
  const supabase = createClient();
  const sourceId = gStr(formData, 'source_id');
  if (!sourceId) throw new Error('Source id is required');
  const { data: src } = await supabase.from('agreements').select('*').eq('id', sourceId).maybeSingle();
  if (!src) throw new Error('Agreement not found');
  const s = src as Record<string, unknown>;
  delete s.id; delete s.created_at;
  let code = String(s.code);
  const { data: clash } = await supabase.from('agreements').select('id').eq('user_id', ctx.ownerId).eq('code', code).maybeSingle();
  if (clash) code = `${code} (copy)`;
  const { error } = await supabase.from('agreements').insert({ ...s, code, user_id: ctx.ownerId, seed_key: null });
  if (error) throw new Error(error.message);
  revalidatePath('/settings/agreements');
}

export async function deleteAgreement(formData: FormData) {
  const ctx = await requireAdminCtx('delete an agreement');
  const supabase = createClient();
  const id = gStr(formData, 'id');
  if (!id) throw new Error('Agreement id is required');
  // field_agreements cascade on delete.
  const { error } = await supabase.from('agreements').delete().eq('id', id).eq('user_id', ctx.ownerId);
  if (error) throw new Error(error.message);
  revalidatePath('/settings/agreements');
  revalidatePath('/fields');
}

/** Bulk-set which fields are in one agreement (many-to-many membership). */
export async function setAgreementMembership(formData: FormData) {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  if (ctx.role === 'agronomist') throw new Error('Agronomists cannot change agreements');
  const supabase = createClient();
  const agreementId = gStr(formData, 'agreement_id');
  if (!agreementId) throw new Error('Agreement id is required');
  const raw = gStr(formData, 'field_ids');
  const fieldIds = raw === '' ? [] : raw.split(',').filter(Boolean);

  const { data: current } = await supabase.from('field_agreements')
    .select('id, field_id').eq('agreement_id', agreementId).eq('user_id', ctx.ownerId);
  const rows = (current ?? []) as { id: string; field_id: string }[];
  const have = new Set(rows.map((r) => r.field_id));
  const want = new Set(fieldIds);

  const removeIds = rows.filter((r) => !want.has(r.field_id)).map((r) => r.id);
  if (removeIds.length) {
    const { error } = await supabase.from('field_agreements').delete().in('id', removeIds);
    if (error) throw new Error(error.message);
  }
  const addFieldIds = fieldIds.filter((id) => !have.has(id));
  if (addFieldIds.length) {
    // Validate the fields belong to this farm.
    const { data: validFields } = await supabase.from('fields').select('id').eq('user_id', ctx.ownerId).in('id', addFieldIds);
    const valid = new Set(((validFields ?? []) as { id: string }[]).map((f) => f.id));
    const insertRows = addFieldIds.filter((id) => valid.has(id)).map((fid) => ({
      user_id: ctx.ownerId, field_id: fid, agreement_id: agreementId, created_by: ctx.userId,
    }));
    if (insertRows.length) {
      const { error } = await supabase.from('field_agreements').insert(insertRows);
      if (error) throw new Error(error.message);
    }
  }
  revalidatePath('/settings/agreements');
  revalidatePath('/fields');
}

// =============================================================================
// Crop catalogue editor — fork a seed/crop into an editable user copy, edit the
// practical fields, or delete a custom crop. Admin-only (a catalogue change).
// The N-stage and micronutrient arrays are carried from the source on fork and
// preserved on edit (advanced array editing is intentionally out of this form).
// =============================================================================

/** Duplicate any crop (shared seed or custom) into the farm's own editable copy. */
export async function forkCrop(formData: FormData) {
  const ctx = await requireAdminCtx('add a crop');
  const supabase = createClient();
  const cropId = gStr(formData, 'crop_id');
  if (!cropId) throw new Error('Crop is required');
  const { data: src, error: e1 } = await supabase.from('crops').select('*').eq('id', cropId).maybeSingle();
  if (e1) throw new Error(e1.message);
  if (!src) throw new Error('Crop not found');
  const r = src as Record<string, unknown>;

  // Default the duplicate's name to "<farm name> <crop>" (e.g. "Mill Farm Maize")
  // so the name box is never blank — the user lands on the editor and can rename
  // it to a variety if they prefer. Falls back to "<crop> (copy)" when no farm
  // name has been set in settings.
  const { data: settingsRow } = await supabase
    .from('settings').select('data').eq('user_id', ctx.ownerId).maybeSingle();
  const farmName = ((settingsRow?.data as { farmName?: string } | null)?.farmName ?? '').trim();
  const baseLabel = String(r.label);
  const newLabel = farmName ? `${farmName} ${baseLabel}` : `Custom ${baseLabel}`;

  const { data: inserted, error } = await supabase.from('crops').insert({
    user_id: ctx.ownerId,
    seed_key: null,
    label: newLabel,
    category: r.category,
    yield_default: r.yield_default,
    yield_unit: r.yield_unit,
    yield_range: r.yield_range,
    offtake: r.offtake,
    total_n: r.total_n,
    n_target_kg_per_ha: r.n_target_kg_per_ha,
    pk_regime: r.pk_regime,
    n_stages: r.n_stages,
    target_ph: r.target_ph,
    ph_note: r.ph_note,
    soil_fit: r.soil_fit,
    manure_fit: r.manure_fit,
    needs_mg: r.needs_mg,
    needs_na: r.needs_na,
    needs_s: r.needs_s,
    sulphur_note: r.sulphur_note,
    micros: r.micros,
    family: r.family,
    k_lift_top_up_note: r.k_lift_top_up_note,
    evidence: r.evidence,
    sources: r.sources,
    summary: r.summary,
    sort_order: r.sort_order,
  }).select('id').single();
  if (error) throw new Error(error.message);
  revalidatePath('/settings/crops');
  revalidatePath('/crops');
  // Drop the user straight into the editor for the new duplicate so they can
  // tune its figures and rename it in one move (the "duplicate → customise"
  // flow). redirect() throws NEXT_REDIRECT, so it must stay outside try/catch.
  redirect(`/settings/crops/${(inserted as { id: string }).id}`);
}

/** Edit a custom crop's scalar + offtake fields. N stages / micros preserved. */
export async function updateCrop(formData: FormData) {
  await requireAdminCtx('edit a crop');
  const supabase = createClient();
  const id = gStr(formData, 'id');
  if (!id) throw new Error('Missing crop id');
  const label = gStr(formData, 'label');
  if (!label) throw new Error('A name is required');

  const offtake: Record<string, unknown> = {
    p2o5: gNum(formData, 'offtake_p2o5') ?? 0,
    k2o: gNum(formData, 'offtake_k2o') ?? 0,
    basis: gStr(formData, 'offtake_basis') || 'per unit of yield',
  };
  const offN = gNum(formData, 'offtake_n'); if (offN != null) offtake.n = offN;
  const offMg = gNum(formData, 'offtake_mgo'); if (offMg != null) offtake.mgo = offMg;
  const offNa = gNum(formData, 'offtake_na2o'); if (offNa != null) offtake.na2o = offNa;

  const patch = {
    label,
    category: gStr(formData, 'category'),
    yield_default: gNum(formData, 'yield_default') ?? 0,
    yield_unit: gStr(formData, 'yield_unit'),
    yield_range: gStr(formData, 'yield_range'),
    offtake,
    total_n: gStr(formData, 'total_n'),
    n_target_kg_per_ha: gNum(formData, 'n_target_kg_per_ha') ?? 0,
    pk_regime: gStr(formData, 'pk_regime'),
    target_ph: gNum(formData, 'target_ph') ?? 6.0,
    ph_note: gStr(formData, 'ph_note') || null,
    soil_fit: gStr(formData, 'soil_fit'),
    manure_fit: gStr(formData, 'manure_fit'),
    needs_mg: gBool(formData, 'needs_mg'),
    needs_na: gBool(formData, 'needs_na'),
    needs_s: gBool(formData, 'needs_s'),
    family: gBool(formData, 'is_brassica') ? 'brassica' : null,
    sulphur_note: gStr(formData, 'sulphur_note') || null,
    evidence: gStr(formData, 'evidence'),
    sources: gStr(formData, 'sources'),
    summary: gStr(formData, 'summary'),
  };
  // RLS scopes to the owner; the user_id guard prevents touching shared seeds.
  const { error } = await supabase.from('crops').update(patch).eq('id', id).not('user_id', 'is', null);
  if (error) throw new Error(error.message);
  revalidatePath('/settings/crops');
  revalidatePath(`/settings/crops/${id}`);
  revalidatePath('/crops');
}

/** Delete a custom crop. Blocked by the DB if any allocation still uses it. */
export async function deleteCrop(formData: FormData) {
  await requireAdminCtx('delete a crop');
  const supabase = createClient();
  const id = gStr(formData, 'id');
  if (!id) throw new Error('Missing crop id');
  const { error } = await supabase.from('crops').delete().eq('id', id).not('user_id', 'is', null);
  if (error) {
    throw new Error('Could not delete this crop — it may be allocated to a field. Remove those allocations first.');
  }
  revalidatePath('/settings/crops');
}


/**
 * Replace the drawn area of an existing part-application (edit flow). Swaps the
 * polygon, recomputes drawn_ha, and re-runs reconciliation since coverage may
 * have changed — then returns to the field's part-applications view.
 */
export async function updatePartApplicationArea(formData: FormData) {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');

  const applicationId = String(formData.get('application_id') || '');
  const fieldId = String(formData.get('field_id') || '');
  const areaJson = formData.get('application_area') ? String(formData.get('application_area')) : null;
  if (!applicationId || !fieldId || !areaJson) throw new Error('Missing required fields');

  let geometry: FieldGeometry;
  try {
    geometry = JSON.parse(areaJson) as FieldGeometry;
  } catch {
    throw new Error('Could not read the drawn area');
  }
  const ha = polygonAreaHectares(geometry);
  if (!(ha > 0)) throw new Error('The drawn area is empty — draw the spread area and try again');

  // Verify it's the owner's part-application on this field.
  const { data: app } = await supabase
    .from('applications')
    .select('id, coverage')
    .eq('id', applicationId).eq('user_id', ctx.ownerId).eq('field_id', fieldId)
    .maybeSingle();
  if (!app) throw new Error('Application not found');
  if ((app as { coverage: string }).coverage !== 'partial') {
    throw new Error('Only part applications have an editable area');
  }

  // One area row per part-application: clear then write the new shape.
  await supabase.from('application_areas')
    .delete().eq('application_id', applicationId).eq('user_id', ctx.ownerId);
  const { error: areaErr } = await supabase.from('application_areas').insert({
    user_id: ctx.ownerId,
    created_by: ctx.userId,
    application_id: applicationId,
    field_id: fieldId,
    polygon: geometry,
    area_ha: ha,
  });
  if (areaErr) throw new Error(areaErr.message);

  const { error: appErr } = await supabase
    .from('applications')
    .update({ drawn_ha: ha })
    .eq('id', applicationId).eq('user_id', ctx.ownerId);
  if (appErr) throw new Error(appErr.message);

  await reconcileFieldPartials(fieldId);
  revalidatePath(`/fields/${fieldId}`);
  revalidatePath(`/fields/${fieldId}/part-applications`);
}

// ---- Diary: to-dos + notes ---------------------------------------

/** Create a to-do. Admin only (RLS enforces too). Optional assignee + due date. */
export async function createTodo(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const title = String(formData.get('title') ?? '').trim().slice(0, 300);
  if (!title) throw new Error('Give the to-do a title');
  const assignedTo = String(formData.get('assigned_to') ?? '').trim() || null;
  const dueRaw = String(formData.get('due_date') ?? '').trim();
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : null;
  const notes = String(formData.get('notes') ?? '').trim().slice(0, 2000) || null;

  const { error } = await supabase.from('todos').insert({
    user_id: ctx.ownerId,
    created_by: ctx.userId,
    title,
    notes,
    assigned_to: assignedTo,
    due_date: dueDate,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/diary');
}

/** Tick a to-do off (or untick). Admins on any; staff on their own assigned
 *  rows (RLS gates that). Only flips done fields — nothing else. */
export async function toggleTodoDone(formData: FormData) {
  const supabase = createClient();
  const ctx = await getFarmContext();
  if (!ctx) throw new Error('Not signed in');
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing to-do id');
  const nowDone = String(formData.get('done') ?? '') === 'true';
  const { error } = await supabase.from('todos')
    .update(nowDone
      ? { done_at: new Date().toISOString(), done_by: ctx.userId }
      : { done_at: null, done_by: null })
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/diary');
}

/** Reassign a to-do (or clear the assignment). Admin only. */
export async function reassignTodo(formData: FormData) {
  const supabase = createClient();
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing to-do id');
  const assignedTo = String(formData.get('assigned_to') ?? '').trim() || null;
  const { error } = await supabase.from('todos')
    .update({ assigned_to: assignedTo }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/diary');
}

/** Delete a to-do. Admin only. */
export async function deleteTodo(formData: FormData) {
  const supabase = createClient();
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing to-do id');
  const { error } = await supabase.from('todos').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/diary');
}

/** Create or update a note. Admin only. Pass id to update. */
export async function saveNote(formData: FormData) {
  const supabase = createClient();
  const ctx = await requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim().slice(0, 8000);
  if (!body) throw new Error('Write something first');
  const pinned = String(formData.get('pinned') ?? '') === 'true';

  if (id) {
    const { error } = await supabase.from('farm_notes')
      .update({ body, pinned, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('farm_notes').insert({
      user_id: ctx.ownerId, created_by: ctx.userId, body, pinned,
    });
    if (error) throw new Error(error.message);
  }
  revalidatePath('/diary');
}

/** Toggle a note's pin. Admin only. */
export async function toggleNotePin(formData: FormData) {
  const supabase = createClient();
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing note id');
  const pinned = String(formData.get('pinned') ?? '') === 'true';
  const { error } = await supabase.from('farm_notes')
    .update({ pinned, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/diary');
}

/** Delete a note. Admin only. */
export async function deleteNote(formData: FormData) {
  const supabase = createClient();
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Missing note id');
  const { error } = await supabase.from('farm_notes').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/diary');
}
