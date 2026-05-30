-- Add soil magnesium index to fields (drives Mg-based lime type on the lime report).
-- Safe to run multiple times.
alter table public.fields
  add column if not exists mg_idx numeric;

comment on column public.fields.mg_idx is
  'Soil magnesium index (decimal, e.g. 1.0). Used by the lime report to choose magnesian vs calcium lime. Null = not sampled for Mg.';
