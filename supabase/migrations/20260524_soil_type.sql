-- =============================================================================
-- Migration: Soil type on fields
-- Purpose:   Categorise each field by soil type so the app can apply
--            light-soil K adjustments, light-sand S risk flags, and
--            cold-clay N timing nudges in reports.
-- =============================================================================
--
-- Design notes:
--   * Four-way enum exposed in the UI: light_sand / medium_loam / heavy_clay /
--     deep_silt. Stored as text (Postgres enums are awkward to extend later;
--     a CHECK constraint catches typos but lets us add values via migration).
--   * Existing fields default to 'medium_loam' so every field has a soil
--     type from day one. Users can adjust per field on the edit form.
--   * Skipped: organic/peat — rare for UK dairy grass and not worth the
--     extra UI complexity. Add later if anyone genuinely needs it.
-- =============================================================================

begin;

alter table public.fields
  add column if not exists soil_type text not null default 'medium_loam'
    check (soil_type in ('light_sand', 'medium_loam', 'heavy_clay', 'deep_silt'));

commit;
