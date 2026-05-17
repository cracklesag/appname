// Supabase Edge Function: extract-document
//
// SESSION 1 SCOPE: dummy extractor.
//
// This function:
//   1. Accepts { document_id } in the request body
//   2. Loads the documents row (using service-role to bypass RLS)
//   3. Sets status to 'processing'
//   4. Sleeps 5 seconds to simulate work
//   5. Inserts 3 hard-coded dummy extracted_samples rows
//   6. Deletes the PDF from Storage
//   7. Sets status to 'ready_for_review'
//
// Session 3 replaces the sleep+dummy block with a real Anthropic API call
// against the PDF downloaded from Storage.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'documents-scratch';

interface RequestBody {
  document_id: string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!body.document_id) {
    return new Response('Missing document_id', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Load the document
  const { data: doc, error: loadErr } = await supabase
    .from('documents')
    .select('*')
    .eq('id', body.document_id)
    .maybeSingle();

  if (loadErr || !doc) {
    return new Response(`Document not found: ${loadErr?.message ?? 'no row'}`, {
      status: 404,
    });
  }

  // Idempotency guard: don't reprocess a document that's already moved on
  if (doc.status !== 'queued' && doc.status !== 'processing') {
    return new Response(
      JSON.stringify({ skipped: true, current_status: doc.status }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Mark as processing
  await supabase
    .from('documents')
    .update({ status: 'processing', processed_at: new Date().toISOString() })
    .eq('id', body.document_id);

  try {
    // ----------------------------------------------------------------
    // SESSION 1 DUMMY WORK
    // Sleep 5s to simulate real extraction latency
    // ----------------------------------------------------------------
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const today = new Date().toISOString().slice(0, 10);
    const dummyRows = [
      {
        document_id: doc.id,
        user_id: doc.user_id,
        raw_payload: { dummy: true, sample_index: 1 },
        lab_sample_label: 'LOW GILL MEADOW',
        lab_sample_ref: 'ORI023162/01',
        sample_date: today,
        ph: 5.4,
        p_ppm: 18,
        p_index: 2.2,
        k_ppm: 124,
        k_index: 2.0,
        mg_ppm: 74,
        mg_index: 2.5,
        extras: { organic_matter_loi_pct: 14.2, calcium_ppm: 938 },
        confidence: { all: 1.0 },
        suggested_field_matches: [],
        user_decision: 'pending',
        user_overrides: {},
      },
      {
        document_id: doc.id,
        user_id: doc.user_id,
        raw_payload: { dummy: true, sample_index: 2 },
        lab_sample_label: 'DOCTORS AND BACK FIELD',
        lab_sample_ref: 'ORI023162/02',
        sample_date: today,
        ph: 5.8,
        p_ppm: 46,
        p_index: 4.0,
        k_ppm: 281,
        k_index: 3.3,
        mg_ppm: 207,
        mg_index: 4.4,
        extras: { organic_matter_loi_pct: 11.0, calcium_ppm: 1464 },
        confidence: { all: 1.0 },
        suggested_field_matches: [],
        user_decision: 'pending',
        user_overrides: {},
      },
      {
        document_id: doc.id,
        user_id: doc.user_id,
        raw_payload: { dummy: true, sample_index: 3 },
        lab_sample_label: 'BIG MEADOW',
        lab_sample_ref: 'ORI023164/04',
        sample_date: today,
        ph: 6.2,
        p_ppm: 22,
        p_index: 2.6,
        k_ppm: 151,
        k_index: 2.3,
        mg_ppm: 146,
        mg_index: 3.6,
        extras: {
          organic_matter_loi_pct: 7.1,
          calcium_ppm: 1707,
          sulphur_ppm: 9,
          manganese_ppm: 49,
          copper_ppm: 9.8,
          boron_ppm: 0.95,
          zinc_ppm: 37.6,
          iron_ppm: 1100,
          sodium_ppm: 34,
          cec_meq_per_100g: 12.5,
        },
        confidence: { all: 1.0 },
        suggested_field_matches: [],
        user_decision: 'pending',
        user_overrides: {},
      },
    ];

    const { error: insertErr } = await supabase
      .from('extracted_samples')
      .insert(dummyRows);

    if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);

    // PDF retention policy: keep the file in Storage during the review session.
    // It will be deleted on Finalise (Session 2) or by a TTL cleanup job (Session 4).
    // For Session 1 we DO NOT delete here — leaving the file in place is the
    // simpler test of the upload→storage→insert pipeline.

    await supabase
      .from('documents')
      .update({
        status: 'ready_for_review',
        extractor_name: 'session1-dummy',
        extractor_version: '0.1',
        processed_at: new Date().toISOString(),
      })
      .eq('id', doc.id);

    return new Response(
      JSON.stringify({ ok: true, rows_inserted: dummyRows.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    const message = err?.message ?? String(err);
    await supabase
      .from('documents')
      .update({
        status: 'failed',
        error_message: message,
        processed_at: new Date().toISOString(),
      })
      .eq('id', doc.id);
    return new Response(`Extraction failed: ${message}`, { status: 500 });
  }
});
