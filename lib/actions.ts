'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CutType, YieldClass, SlurryMethod, RateUnit } from '@/lib/types';

export async function saveApplication(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const fieldId = String(formData.get('field_id'));
  const productId = parseInt(String(formData.get('product_id')), 10);
  const dateApplied = String(formData.get('date_applied'));
  const rateValue = parseFloat(String(formData.get('rate_value')));
  const rateUnit = String(formData.get('rate_unit')) as RateUnit;
  const method = (formData.get('method') ? String(formData.get('method')) : null) as SlurryMethod | null;
  const notes = formData.get('notes') ? String(formData.get('notes')) : null;

  if (!fieldId || !productId || !dateApplied || !rateValue || rateValue <= 0) {
    throw new Error('Missing required fields');
  }

  const { error } = await supabase.from('applications').insert({
    user_id: user.id,
    field_id: fieldId,
    product_id: productId,
    date_applied: dateApplied,
    rate_value: rateValue,
    rate_unit: rateUnit,
    method,
    notes,
    applied_by: 'me',
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
  revalidatePath('/activity');
  redirect(`/fields/${fieldId}`);
}

export async function saveCut(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const fieldId = String(formData.get('field_id'));
  const cutNumber = parseInt(String(formData.get('cut_number')), 10);
  const cutDate = String(formData.get('cut_date'));
  const cutType = String(formData.get('cut_type')) as CutType;
  const yieldClass = String(formData.get('yield_class')) as YieldClass;
  const notes = formData.get('notes') ? String(formData.get('notes')) : null;

  if (!fieldId || !cutNumber || !cutDate) throw new Error('Missing required fields');

  const { error } = await supabase.from('cuts').insert({
    user_id: user.id,
    field_id: fieldId,
    cut_number: cutNumber,
    cut_date: cutDate,
    cut_type: cutType,
    yield_class: yieldClass,
    notes,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
  redirect(`/fields/${fieldId}`);
}

export async function saveSoil(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const fieldId = String(formData.get('field_id'));
  const ph = formData.get('ph') ? parseFloat(String(formData.get('ph'))) : null;
  const pIdx = formData.get('p_idx') ? parseFloat(String(formData.get('p_idx'))) : null;
  const kIdx = formData.get('k_idx') ? parseFloat(String(formData.get('k_idx'))) : null;
  const sampleDate = formData.get('sample_date') ? String(formData.get('sample_date')) : null;
  const lastPloughed = formData.get('last_ploughed') ? String(formData.get('last_ploughed')) : null;
  const lastReseeded = formData.get('last_reseeded') ? String(formData.get('last_reseeded')) : null;
  const notes = formData.get('notes') ? String(formData.get('notes')) : null;

  const sampled = ph != null || pIdx != null || kIdx != null;

  const { error } = await supabase.from('fields').update({
    ph, p_idx: pIdx, k_idx: kIdx,
    sample_date: sampleDate, last_ploughed: lastPloughed, last_reseeded: lastReseeded,
    notes, sampled,
    updated_at: new Date().toISOString(),
  }).eq('id', fieldId);
  if (error) throw new Error(error.message);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
  redirect(`/fields/${fieldId}`);
}

export async function savePlan(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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
  redirect(`/fields/${fieldId}`);
}

export async function saveSettings(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const data = {
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
    bagFertUnit: String(formData.get('bag_fert_unit')) as 'kg/ha' | 'kg/ac' | 'lb/ac',
    slurryUnit: String(formData.get('slurry_unit')) as 'gal/ac' | 'm3/ha',
    limeUnit: String(formData.get('lime_unit')) as 't/ac' | 't/ha',
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

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
