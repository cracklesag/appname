-- 20260607_soil_samples_read.sql
-- Read access to imported soil samples, for the per-field soil-sample history
-- and micronutrient views. The soil_sample_fields junction has no user_id and
-- we don't want to alter the existing table RLS, so expose a membership-checked
-- SECURITY DEFINER function that returns a field's committed soil samples,
-- newest first. Depends on public.is_member_of (farm roles). Idempotent.

create or replace function public.get_field_soil_samples(p_field_id uuid)
returns setof public.soil_samples
language sql
security definer
set search_path = public
as $$
  select s.*
  from public.soil_samples s
  join public.soil_sample_fields sf on sf.sample_id = s.id
  join public.fields f on f.id = sf.field_id
  where sf.field_id = p_field_id
    and public.is_member_of(f.user_id)
  order by s.sample_date desc nulls last;
$$;

revoke all on function public.get_field_soil_samples(uuid) from public;
grant execute on function public.get_field_soil_samples(uuid) to authenticated;
