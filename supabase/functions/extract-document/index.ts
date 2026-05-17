// Supabase Edge Function: extract-document
//
// SESSION 3: Real Anthropic-powered extraction.
//
// Flow:
//   1. Accept { document_id } in the request body
//   2. Load the documents row using service-role (bypass RLS for the worker)
//   3. Mark status = 'processing'
//   4. Download the PDF from Supabase Storage
//   5. Call the Anthropic Messages API with the PDF + extraction prompt
//   6. Parse and validate the JSON response
//   7. Insert extracted_samples rows
//   8. Mark status = 'ready_for_review'
//
// On any error: mark status = 'failed' with a useful error_message,
// leave the PDF in Storage so the user can retry.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const BUCKET = 'documents-scratch';

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MAX_TOKENS = 8192;       // Plenty for ~29-sample output JSON
const ANTHROPIC_TIMEOUT_MS = 120_000;    // 2 minutes — bigger PDFs can take ~60s

interface RequestBody {
  document_id: string;
}

// =============================================================================
// Extraction prompt
// =============================================================================
//
// Engineered specifically for Lancrop / Yara Megalab soil reports. Critical
// guardrails baked in:
//
//   - The "18 (Index 2.2)" trap: every P/K/Mg line shows BOTH a ppm value and an
//     Index value in the Comments column. We tell the model explicitly which is
//     which.
//   - Don't split composite refs ("DOCTORS AND BACK FIELD"): the model returns
//     exactly what appears on the page; the review UI handles splitting.
//   - Two schemas in one document: 24 samples have 6 named analytes, 3 have 16.
//     The model must capture everything beyond the named columns into `extras`.
//   - Don't hallucinate: if a value isn't on the page, output null. Crop is
//     usually blank, sample_date is usually NOT on the page (the Date Received
//     header is for the whole batch).
//   - One PDF page = one sample. 29 pages → 29 samples.
//   - Output strict JSON only, no preamble, no code fences.

const EXTRACTION_PROMPT = `
You are extracting soil sample data from a Lancrop Laboratories / Yara Megalab soil
analysis report. Each PDF page is one sample. Read every page carefully and return
ONE JSON object with a "samples" array containing one entry per page.

For each page, extract these named fields where they appear:

- lab_sample_label  (string)  — the "Sample Ref" value, EXACTLY as printed on the
                                page, including punctuation and case. Examples:
                                "LOW GILL MEADOW", "DOCTORS AND BACK FIELD",
                                "SWANS & 3 CORNERS", "MORRIS'S". Do NOT split or
                                normalise these — even if a label looks composite,
                                preserve it as a single string.
- lab_sample_ref    (string)  — the "Sample No" value, e.g. "ORI023162/01".
- sample_date       (string)  — YYYY-MM-DD if shown, otherwise null. Use the
                                "Date Received" if and only if it's the only
                                date visible on a per-sample basis.
- ph                (number)  — the "pH" Result value.
- p_ppm             (number)  — the "Phosphorus (ppm)" Result value (NOT the Index).
                                E.g. for "Phosphorus (ppm) 18 (Index 2.2)", p_ppm = 18.
- p_index           (number)  — the value inside "(Index X.X)" next to Phosphorus.
                                E.g. for the line above, p_index = 2.2.
- k_ppm             (number)  — the "Potassium (ppm)" Result value (NOT the Index).
- k_index           (number)  — the value inside "(Index X.X)" next to Potassium.
- mg_ppm            (number)  — the "Magnesium (ppm)" Result value (NOT the Index).
- mg_index          (number)  — the value inside "(Index X.X)" next to Magnesium.
- extras            (object)  — everything else with a value, as snake_case keys:
                                organic_matter_loi_pct, calcium_ppm, sulphur_ppm,
                                manganese_ppm, copper_ppm, boron_ppm, zinc_ppm,
                                molybdenum_ppm, iron_ppm, sodium_ppm,
                                cec_meq_per_100g, and any others present.

Hard rules:

1. **Do not split composite labels.** "DOCTORS AND BACK FIELD" is one sample with
   that exact label. The downstream UI handles whether to split.
2. **Distinguish ppm from index.** The ppm value is always larger and appears in
   the Result column. The index is the small decimal in parentheses after "Index".
   Never put an index into a ppm field or vice versa.
3. **No hallucination.** If a field is not visible on a page, output null for
   named fields, or omit it from extras. Do not invent values.
4. **One page = one sample.** If the document has 29 pages, return 29 samples,
   in page order.
5. **Output strict JSON.** No preamble, no commentary, no markdown fences. Just a
   JSON object with this shape:

{
  "samples": [
    {
      "lab_sample_label": "...",
      "lab_sample_ref": "...",
      "sample_date": "YYYY-MM-DD" or null,
      "ph": number or null,
      "p_ppm": number or null,
      "p_index": number or null,
      "k_ppm": number or null,
      "k_index": number or null,
      "mg_ppm": number or null,
      "mg_index": number or null,
      "extras": { ... }
    }
  ]
}

If the document is not a soil report, return {"samples": []} and nothing else.
`.trim();

// =============================================================================
// Helpers
// =============================================================================

interface ExtractedSampleInput {
  lab_sample_label: string | null;
  lab_sample_ref: string | null;
  sample_date: string | null;
  ph: number | null;
  p_ppm: number | null;
  p_index: number | null;
  k_ppm: number | null;
  k_index: number | null;
  mg_ppm: number | null;
  mg_index: number | null;
  extras: Record<string, unknown>;
}

/**
 * Convert raw bytes to base64 (Deno standard).
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Call the Anthropic Messages API with the base64 PDF and extraction prompt.
 * Returns the model's text response.
 */
async function callAnthropic(pdfBase64: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set in Edge Function secrets');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: pdfBase64,
                },
              },
              {
                type: 'text',
                text: EXTRACTION_PROMPT,
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '<no body>');
      throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 500)}`);
    }

    const data = await res.json();
    // Response shape: { content: [{ type: 'text', text: '...' }], ... }
    const block = Array.isArray(data?.content)
      ? data.content.find((b: any) => b?.type === 'text')
      : null;
    if (!block?.text) {
      throw new Error('Anthropic response had no text block');
    }
    return block.text as string;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parse the model's response into a strict shape. Tolerant of code fences in
 * case the model occasionally wraps despite our instructions.
 */
function parseExtractionResponse(raw: string): ExtractedSampleInput[] {
  let cleaned = raw.trim();
  // Strip ```json ... ``` fences if present
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Model output was not valid JSON: ${(err as Error).message}. First 200 chars: ${cleaned.slice(0, 200)}`);
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.samples)) {
    throw new Error('Model output did not contain a "samples" array');
  }

  return parsed.samples.map((s: any, idx: number): ExtractedSampleInput => {
    if (!s || typeof s !== 'object') {
      throw new Error(`Sample at index ${idx} is not an object`);
    }
    return {
      lab_sample_label: nullableString(s.lab_sample_label),
      lab_sample_ref: nullableString(s.lab_sample_ref),
      sample_date: nullableString(s.sample_date),
      ph: nullableNumber(s.ph),
      p_ppm: nullableNumber(s.p_ppm),
      p_index: nullableNumber(s.p_index),
      k_ppm: nullableNumber(s.k_ppm),
      k_index: nullableNumber(s.k_index),
      mg_ppm: nullableNumber(s.mg_ppm),
      mg_index: nullableNumber(s.mg_index),
      extras: typeof s.extras === 'object' && s.extras !== null ? s.extras : {},
    };
  });
}

function nullableString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function nullableNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

// =============================================================================
// Handler
// =============================================================================

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

  // Idempotency guard
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
    // 1. Download the PDF from Storage
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from(BUCKET)
      .download(doc.storage_path);
    if (dlErr || !fileBlob) {
      throw new Error(`PDF download failed: ${dlErr?.message ?? 'no blob'}`);
    }
    const pdfBytes = new Uint8Array(await fileBlob.arrayBuffer());
    const pdfBase64 = bytesToBase64(pdfBytes);

    // 2. Call Anthropic
    const rawText = await callAnthropic(pdfBase64);

    // 3. Parse & validate
    const parsed = parseExtractionResponse(rawText);

    if (parsed.length === 0) {
      throw new Error('No samples were extracted from this document. It may not be a soil report, or the format may not match.');
    }

    // 4. Insert rows. Each row carries the FULL raw text in raw_payload for
    //    audit — same value on every row, but storage is cheap and it preserves
    //    a single source of truth for the whole document's extraction.
    const rows = parsed.map((s) => ({
      document_id: doc.id,
      user_id: doc.user_id,
      raw_payload: {
        source: 'anthropic',
        model: ANTHROPIC_MODEL,
        full_response: rawText,
        sample_input: s,
      },
      lab_sample_label: s.lab_sample_label,
      lab_sample_ref: s.lab_sample_ref,
      sample_date: s.sample_date,
      ph: s.ph,
      p_ppm: s.p_ppm,
      p_index: s.p_index,
      k_ppm: s.k_ppm,
      k_index: s.k_index,
      mg_ppm: s.mg_ppm,
      mg_index: s.mg_index,
      extras: s.extras,
      confidence: { all: 1.0 },          // Reserved column — unused in MVP
      suggested_field_matches: [],       // Computed client-side from fields list
      user_decision: 'pending',
      user_overrides: {},
    }));

    const { error: insertErr } = await supabase
      .from('extracted_samples')
      .insert(rows);
    if (insertErr) {
      throw new Error(`Insert failed: ${insertErr.message}`);
    }

    // 5. Mark ready for review. PDF stays in Storage — deletion happens on
    //    Finalise in the review UI.
    await supabase
      .from('documents')
      .update({
        status: 'ready_for_review',
        extractor_name: ANTHROPIC_MODEL,
        extractor_version: 'session3-v1',
        processed_at: new Date().toISOString(),
      })
      .eq('id', doc.id);

    return new Response(
      JSON.stringify({ ok: true, rows_inserted: rows.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    const message = (err?.message ?? String(err)).slice(0, 2000);
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
