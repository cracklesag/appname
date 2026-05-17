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
  const method = (formData.get('method') ? String(formData.get('method')) : null) as SlurryMethod | null;
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
  redirect(`/fields/${fieldId}`);
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

export async function updateCut(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const id = String(formData.get('id'));
  const fieldId = String(formData.get('field_id'));
  const cutNumber = parseInt(String(formData.get('cut_number')), 10);
  const cutDate = String(formData.get('cut_date'));
  const cutType = String(formData.get('cut_type')) as CutType;
  const yieldClass = String(formData.get('yield_class')) as YieldClass;
  const notes = formData.get('notes') ? String(formData.get('notes')) : null;

  if (!id || !fieldId || !cutNumber || !cutDate) throw new Error('Missing required fields');

  const { error } = await supabase
    .from('cuts')
    .update({
      cut_number: cutNumber,
      cut_date: cutDate,
      cut_type: cutType,
      yield_class: yieldClass,
      notes,
    })
    .eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath(`/fields/${fieldId}`);
  revalidatePath('/');
  redirect(`/fields/${fieldId}`);
}

export async function deleteCut(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const id = String(formData.get('id'));
  const fieldId = String(formData.get('field_id'));
  if (!id) throw new Error('Missing cut id');

  const { error } = await supabase.from('cuts').delete().eq('id', id);
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

export async function createField(formData: FormData) {
  const supabase = createClient();
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

  // Validation: name required, acres > 0, ha > 0, cut profile 1-4
  if (!name) throw new Error('Field name is required');
  if (!acres || acres <= 0) throw new Error('Acres must be greater than 0');
  if (!ha || ha <= 0) throw new Error('Hectares must be greater than 0');
  if (!cutProfile || cutProfile < 1 || cutProfile > 4) throw new Error('Cut profile must be 1–4');

  const { data, error } = await supabase.from('fields').insert({
    user_id: user.id,
    name,
    acres,
    ha,
    cut_profile: cutProfile,
    planned_cuts: plannedCuts,
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const fieldId = String(formData.get('field_id'));
  const confirmName = String(formData.get('confirm_name') || '').trim();
  if (!fieldId) throw new Error('Missing field id');
  if (!confirmName) throw new Error('Type the field name to confirm');

  // Verify the name matches before we cascade-delete
  const { data: field, error: fetchErr } = await supabase
    .from('fields')
    .select('name')
    .eq('id', fieldId)
    .maybeSingle();
  if (fetchErr || !field) throw new Error('Field not found');
  if (field.name.trim() !== confirmName) {
    throw new Error(`Name didn't match. Type "${field.name}" exactly to confirm.`);
  }

  // FK constraints on applications and cuts have ON DELETE CASCADE
  const { error } = await supabase.from('fields').delete().eq('id', fieldId);
  if (error) throw new Error(error.message);

  revalidatePath('/');
  revalidatePath('/activity');
  redirect('/');
}

export async function resetAllData(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

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
        | { existing_field_id: string }
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
