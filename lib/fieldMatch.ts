// Field-name matching utilities for document ingestion review UI.
//
// Two responsibilities:
//   1. Levenshtein-based similarity scoring to suggest existing fields for
//      each extracted sample.
//   2. Composite-ref splitting — detect when a single sample ref covers
//      multiple fields (e.g. "DOCTORS AND BACK FIELD") and split into
//      candidate parts so each can be matched independently.
//
// These are pure functions, no DB access, no React. Designed to run client-side
// against the user's full fields list.

import { Field } from './types';

// ---- Normalisation ------------------------------------------------------

/**
 * Normalise a field name for comparison. Strip case, possessives, punctuation,
 * extra whitespace. Used for both extracted refs and existing field names.
 */
export function normaliseFieldName(s: string): string {
  return s
    .toLowerCase()
    .replace(/['']/g, '')           // drop apostrophes (REEDYS vs Reedy's)
    .replace(/[^a-z0-9\s]/g, ' ')   // punctuation to spaces
    .replace(/\s+/g, ' ')           // collapse whitespace
    .trim();
}

// ---- Levenshtein --------------------------------------------------------

/**
 * Standard Levenshtein edit distance. Returns the number of single-character
 * insertions/deletions/substitutions to transform a into b.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost,     // substitution
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }

  return prev[b.length];
}

/**
 * Similarity score 0..1. 1 = identical (after normalisation), 0 = completely
 * different. Computed as 1 - distance / max(len).
 */
export function similarity(a: string, b: string): number {
  const na = normaliseFieldName(a);
  const nb = normaliseFieldName(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}

// ---- Composite-ref splitting --------------------------------------------

/**
 * Detect whether a sample ref looks like a pooled sample covering multiple
 * fields. Returns the list of split parts (length 1 if not composite, length >1
 * if it is).
 *
 * Splits on:
 *   - " AND " / " and "  (whitespace-bounded, so we don't split "ANDREWS FIELD")
 *   - " & "
 *   - " + "
 *   - ", "
 *
 * Examples:
 *   "DOCTORS AND BACK FIELD"     -> ["DOCTORS", "BACK FIELD"]
 *   "SWANS & 3 CORNERS"          -> ["SWANS", "3 CORNERS"]
 *   "CALF FIELD + BOG"           -> ["CALF FIELD", "BOG"]
 *   "PEN & WIRED OFF FIELD"      -> ["PEN", "WIRED OFF FIELD"]
 *   "LOW GILL MEADOW"            -> ["LOW GILL MEADOW"]  (no split)
 */
export function splitComposite(ref: string): string[] {
  if (!ref) return [];
  // Single regex with alternation; the ' AND ' is case-insensitive
  const parts = ref.split(/\s+(?:AND|and|&|\+)\s+|\s*,\s*/);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Convenience: tells the UI whether to render in single-select or multi-select
 * mode for a given sample ref.
 */
export function isCompositeRef(ref: string | null | undefined): boolean {
  if (!ref) return false;
  return splitComposite(ref).length > 1;
}

// ---- Ranked match lookup ------------------------------------------------

export interface FieldMatchCandidate {
  field: Field;
  score: number;
}

/**
 * Given a single sample ref and the user's full field list, return the top
 * candidates ranked by similarity. Caller decides whether to use the top hit
 * as a pre-selection.
 *
 * @param ref          The sample ref string (already-split if composite)
 * @param fields       The user's fields
 * @param topN         How many candidates to return (default 5)
 */
export function rankFieldMatches(
  ref: string,
  fields: Field[],
  topN: number = 5,
): FieldMatchCandidate[] {
  if (!ref || fields.length === 0) return [];
  const scored = fields.map((field) => ({
    field,
    score: similarity(ref, field.name),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

/**
 * Threshold for "this is probably the same field — pre-select it confidently".
 * Below this, we still show the dropdown but pre-select "Create new field"
 * instead.
 *
 * 0.6 is a starting guess to be tuned against real Mill Farm data on first
 * use. Worth revisiting after the first real import.
 */
export const MATCH_THRESHOLD = 0.6;
