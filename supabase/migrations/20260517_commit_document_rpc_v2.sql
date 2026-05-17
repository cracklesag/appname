-- =============================================================================
-- Migration: commit_document RPC v2 — replace-existing-sample support
-- =============================================================================
--
-- Extends the per-link payload to support a `replace_existing` flag. When set,
-- the RPC deletes the field's most recent soil_sample (and its junction row)
-- before inserting the new one. The auto-cache trigger then refreshes the
-- field's cached pH/P/K values to point at the newly-inserted sample.
--
-- Payload shape (existing keys unchanged, new optional flag in italics):
--
--   {
--     "decisions": [
--       {
--         "extracted_sample_id": "uuid",
--         "decision": "accepted" | "edited" | "rejected",
--         "overrides": { ... },
--         "field_links": [
--           {
--             "existing_field_id": "uuid",
--             "replace_existing": true     -- NEW, optional, default false
--           },
--           {
--             "new_field": { ... }         -- replace_existing meaningless here,
--                                         -- new fields have nothing to replace
--           }
--         ]
--       }
--     ]
--   }
--
-- Replace semantics: when replace_existing=true on an existing-field link, the
-- RPC finds the most recent soil_sample currently linked to that field (by
-- sample_date desc, created_at desc), deletes it, and lets the cascade clear
-- the soil_sample_fields row. Then proceeds with the normal insert. Net effect:
-- the field ends up with exactly one new sample replacing the old.
-- =============================================================================

begin;

create or replace function public.commit_document(
  p_document_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id              uuid := auth.uid();
  v_doc                  public.documents%rowtype;
  v_decision             jsonb;
  v_extracted            public.extracted_samples%rowtype;
  v_decision_kind        text;
  v_overrides            jsonb;
  v_field_links          jsonb;
  v_link                 jsonb;
  v_new_field_spec       jsonb;
  v_field_id             uuid;
  v_new_sample_id        uuid;
  v_acres                numeric;
  v_ha                   numeric;
  v_skip_size            boolean;
  v_needs_setup          boolean;
  v_samples_committed    int := 0;
  v_fields_created       int := 0;
  v_samples_replaced     int := 0;
  v_resolved_field_ids   uuid[];
  v_resolved_replace     boolean[];
  v_replace_flag         boolean;
  v_idx                  int;
  v_old_sample_id        uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- 1. Load the document, verify ownership and status
  select * into v_doc
    from public.documents
   where id = p_document_id
   for update;

  if not found then
    raise exception 'Document % not found', p_document_id;
  end if;

  if v_doc.user_id <> v_user_id then
    raise exception 'Not authorised';
  end if;

  if v_doc.status <> 'ready_for_review' then
    raise exception 'Document % is not ready for review (current status: %)', p_document_id, v_doc.status;
  end if;

  -- 2. Iterate over decisions
  for v_decision in select * from jsonb_array_elements(p_payload -> 'decisions')
  loop
    v_decision_kind := v_decision ->> 'decision';
    v_overrides     := coalesce(v_decision -> 'overrides', '{}'::jsonb);
    v_field_links   := coalesce(v_decision -> 'field_links', '[]'::jsonb);

    select * into v_extracted
      from public.extracted_samples
     where id = (v_decision ->> 'extracted_sample_id')::uuid
       and document_id = p_document_id
       and user_id = v_user_id
     for update;

    if not found then
      raise exception 'Extracted sample % not found or not yours', v_decision ->> 'extracted_sample_id';
    end if;

    if v_decision_kind = 'rejected' then
      update public.extracted_samples
         set user_decision = 'rejected',
             user_overrides = v_overrides,
             updated_at = now()
       where id = v_extracted.id;
      continue;
    end if;

    if v_decision_kind not in ('accepted', 'edited') then
      raise exception 'Invalid decision kind: %', v_decision_kind;
    end if;

    -- Resolve field links: existing field IDs verified, new fields created on
    -- demand. Track per-link replace_existing flag in a parallel array.
    v_resolved_field_ids := array[]::uuid[];
    v_resolved_replace   := array[]::boolean[];

    for v_link in select * from jsonb_array_elements(v_field_links)
    loop
      v_replace_flag := coalesce((v_link ->> 'replace_existing')::boolean, false);

      if v_link ? 'existing_field_id' then
        v_field_id := (v_link ->> 'existing_field_id')::uuid;
        if not exists (
          select 1 from public.fields
           where id = v_field_id and user_id = v_user_id
        ) then
          raise exception 'Field % not found or not yours', v_field_id;
        end if;
        v_resolved_field_ids := array_append(v_resolved_field_ids, v_field_id);
        v_resolved_replace   := array_append(v_resolved_replace, v_replace_flag);
      elsif v_link ? 'new_field' then
        v_new_field_spec := v_link -> 'new_field';
        v_skip_size := coalesce((v_new_field_spec ->> 'skip_size')::boolean, false);

        if v_skip_size then
          v_acres := 0.01;
          v_ha := 0.01;
          v_needs_setup := true;
        else
          v_acres := nullif(v_new_field_spec ->> 'acres', '')::numeric;
          v_ha    := nullif(v_new_field_spec ->> 'ha', '')::numeric;
          if v_acres is null and v_ha is null then
            raise exception 'New field must have acres or ha, or skip_size=true';
          end if;
          if v_acres is null then v_acres := v_ha * 2.4711; end if;
          if v_ha    is null then v_ha    := v_acres / 2.4711; end if;
          v_needs_setup := false;
        end if;

        insert into public.fields (
          user_id, name, acres, ha, cut_profile, planned_cuts, needs_setup
        ) values (
          v_user_id,
          trim(v_new_field_spec ->> 'name'),
          v_acres,
          v_ha,
          1,
          '["silage"]'::jsonb,
          v_needs_setup
        )
        returning id into v_field_id;

        v_fields_created := v_fields_created + 1;
        v_resolved_field_ids := array_append(v_resolved_field_ids, v_field_id);
        -- New fields by definition have nothing to replace
        v_resolved_replace   := array_append(v_resolved_replace, false);
      else
        raise exception 'Field link must specify existing_field_id or new_field';
      end if;
    end loop;

    if cardinality(v_resolved_field_ids) = 0 then
      raise exception 'Sample % has no field links — every accepted/edited sample must link to at least one field', v_extracted.id;
    end if;

    -- 2a. For each field marked replace_existing=true, delete the prior most
    -- recent soil_sample tied to that field. The junction row goes with it
    -- via ON DELETE CASCADE.
    for v_idx in 1 .. cardinality(v_resolved_field_ids)
    loop
      if v_resolved_replace[v_idx] then
        v_field_id := v_resolved_field_ids[v_idx];
        select s.id into v_old_sample_id
        from public.soil_samples s
        join public.soil_sample_fields sf on sf.sample_id = s.id
        where sf.field_id = v_field_id
          and s.user_id = v_user_id
        order by s.sample_date desc nulls last, s.created_at desc
        limit 1;
        if v_old_sample_id is not null then
          delete from public.soil_samples where id = v_old_sample_id;
          v_samples_replaced := v_samples_replaced + 1;
        end if;
      end if;
    end loop;

    -- 2b. Insert the new soil_samples row, merging overrides over extracted values
    insert into public.soil_samples (
      user_id, document_id, sample_date, lab_name, lab_sample_ref, lab_sample_label,
      ph, p_ppm, p_index, k_ppm, k_index, mg_ppm, mg_index,
      extras, created_by
    ) values (
      v_user_id,
      p_document_id,
      coalesce(nullif(v_overrides ->> 'sample_date', '')::date, v_extracted.sample_date, current_date),
      v_doc.extractor_name,
      v_extracted.lab_sample_ref,
      v_extracted.lab_sample_label,
      coalesce(nullif(v_overrides ->> 'ph', '')::numeric, v_extracted.ph),
      coalesce(nullif(v_overrides ->> 'p_ppm', '')::numeric, v_extracted.p_ppm),
      coalesce(nullif(v_overrides ->> 'p_index', '')::numeric, v_extracted.p_index),
      coalesce(nullif(v_overrides ->> 'k_ppm', '')::numeric, v_extracted.k_ppm),
      coalesce(nullif(v_overrides ->> 'k_index', '')::numeric, v_extracted.k_index),
      coalesce(nullif(v_overrides ->> 'mg_ppm', '')::numeric, v_extracted.mg_ppm),
      coalesce(nullif(v_overrides ->> 'mg_index', '')::numeric, v_extracted.mg_index),
      v_extracted.extras,
      v_user_id
    )
    returning id into v_new_sample_id;

    -- Link the new sample to each resolved field
    insert into public.soil_sample_fields (sample_id, field_id)
    select v_new_sample_id, unnest(v_resolved_field_ids);

    update public.extracted_samples
       set user_decision = v_decision_kind,
           user_overrides = v_overrides,
           committed_sample_id = v_new_sample_id,
           updated_at = now()
     where id = v_extracted.id;

    v_samples_committed := v_samples_committed + 1;
  end loop;

  -- 3. Mark the document committed
  update public.documents
     set status = 'committed',
         committed_at = now()
   where id = p_document_id;

  return jsonb_build_object(
    'samples_committed', v_samples_committed,
    'fields_created',    v_fields_created,
    'samples_replaced',  v_samples_replaced
  );
end;
$$;

revoke all on function public.commit_document(uuid, jsonb) from public;
grant execute on function public.commit_document(uuid, jsonb) to authenticated;

commit;
