import { createClient } from './supabase/server';
import { Application, Cut, DEFAULT_SETTINGS, Field, Product, Settings } from './types';

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
  const { data, error } = await supabase.from('settings').select('data').eq('user_id', user.id).maybeSingle();
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
  };
  // For users whose settings predate the unitSystem field: infer from slurryUnit
  // (gal/ac is acres-style, m3/ha is hectares-style). Saved on first explicit
  // Settings save thereafter.
  if (!('unitSystem' in saved)) {
    merged.unitSystem = merged.slurryUnit === 'gal/ac' ? 'acres' : 'hectares';
  }
  return merged;
}
