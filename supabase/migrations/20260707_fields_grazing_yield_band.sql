-- Title: add fields.grazing_yield_band
-- suggested filename: 20260707_fields_grazing_yield_band.sql
--
-- Grazing N was being driven off cut_profile (a SILAGE cut-count) as a proxy
-- for sward yield — so a 2-cut grazing field was read as a 7 t/ha sward and
-- under-recommended N. This adds an explicit, grazing-only RB209 yield band.
-- Null = fall back to the old cut_profile-derived band, so every existing
-- field behaves exactly as before until a band is chosen (no silent movement).
--
-- Band index maps to RB209 Table (grazing N by yield):
--   0: 4–5 t/ha (30)   1: 5–7 (50)    2: 6–8 (80)    3: 7–9 (130)
--   4: 9–12 (180)      5: 10–13 (230) 6: 12–15+ (270)  [kg N/ha season]
alter table public.fields
  add column if not exists grazing_yield_band smallint
  check (grazing_yield_band is null or (grazing_yield_band >= 0 and grazing_yield_band <= 6));
