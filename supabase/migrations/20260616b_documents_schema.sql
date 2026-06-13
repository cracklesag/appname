-- =====================================================================
-- Swardly · Schema backfill — soil-import pipeline tables
-- Run in the Supabase SQL editor. Idempotent and a NO-OP on the live
-- database (all four tables already exist there).
-- =====================================================================
--
-- WHY THIS EXISTS: documents, extracted_samples, soil_samples and
-- soil_sample_fields are used throughout the app (upload pipeline, review
-- UI, commit_document RPC, per-field soil history) but their CREATE TABLE
-- statements were run once in the SQL editor and never committed. The repo
-- therefore could not rebuild the database from source (no staging env, no
-- disaster recovery beyond pg_dump). This file restores that.
--
-- PROVENANCE: column lists reconstructed from lib/types.ts (ImportDocument,
-- ExtractedSample, SoilSample), the extract-document Edge Function, and the
-- commit_document RPC. If you ever rebuild from scratch, cross-check column
-- types against a recent pg_dump from the nightly backup — the dump is the
-- byte-exact truth; this file is the faithful-from-code reconstruction.
--
-- POLICIES: created ONLY when a table currently has none (i.e. on a fresh
-- rebuild). On the live database, whatever policies exist are left exactly
-- as they are — this migration never replaces live policies.

begin;

-- ---------------------------------------------------------------------
-- documents — one uploaded soil-report PDF and its processing lifecycle
-- ---------------------------------------------------------------------
create table if not exists public.documents (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  storage_path       text not null,
  original_filename  text,
  mime_type          text,
  byte_size          bigint,
  doc_type           text not null default 'soil_report',
  status             text not null default 'queued'
                       check (status in ('queued','processing','ready_for_review','committed','failed','discarded')),
  extractor_name     text,
  extractor_version  text,
  error_message      text,
  created_at         timestamptz not null default now(),
  processed_at       timestamptz,
  committed_at       timestamptz
);
create index if not exists documents_user_idx   on public.documents (user_id);
create index if not exists documents_status_idx on public.documents (status);

-- ---------------------------------------------------------------------
-- extracted_samples — one row per sample the extractor found in a document
-- ---------------------------------------------------------------------
create table if not exists public.extracted_samples (
  id                       uuid primary key default gen_random_uuid(),
  document_id              uuid not null references public.documents(id) on delete cascade,
  user_id                  uuid not null references auth.users(id) on delete cascade,
  raw_payload              jsonb not null default '{}'::jsonb,
  lab_sample_label         text,
  lab_sample_ref           text,
  sample_date              date,
  ph                       numeric,
  p_ppm                    numeric,
  p_index                  numeric,
  k_ppm                    numeric,
  k_index                  numeric,
  mg_ppm                   numeric,
  mg_index                 numeric,
  extras                   jsonb not null default '{}'::jsonb,
  confidence               jsonb not null default '{}'::jsonb,
  suggested_field_matches  jsonb not null default '[]'::jsonb,
  user_decision            text not null default 'pending'
                             check (user_decision in ('pending','accepted','edited','rejected')),
  user_overrides           jsonb not null default '{}'::jsonb,
  committed_sample_id      uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists extracted_samples_document_idx on public.extracted_samples (document_id);
create index if not exists extracted_samples_user_idx     on public.extracted_samples (user_id);

-- ---------------------------------------------------------------------
-- soil_samples — committed samples (the per-field soil history)
-- ---------------------------------------------------------------------
create table if not exists public.soil_samples (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  document_id       uuid references public.documents(id) on delete set null,
  sample_date       date,
  lab_name          text,
  lab_sample_ref    text,
  lab_sample_label  text,
  ph                numeric,
  p_ppm             numeric,
  p_index           numeric,
  k_ppm             numeric,
  k_index           numeric,
  mg_ppm            numeric,
  mg_index          numeric,
  extras            jsonb not null default '{}'::jsonb,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists soil_samples_user_idx on public.soil_samples (user_id);

-- ---------------------------------------------------------------------
-- soil_sample_fields — junction: which field(s) a sample belongs to
-- ---------------------------------------------------------------------
create table if not exists public.soil_sample_fields (
  sample_id  uuid not null references public.soil_samples(id) on delete cascade,
  field_id   uuid not null references public.fields(id) on delete cascade,
  primary key (sample_id, field_id)
);
create index if not exists soil_sample_fields_field_idx on public.soil_sample_fields (field_id);

-- ---------------------------------------------------------------------
-- RLS — enable everywhere; create policies only where none exist yet.
-- ---------------------------------------------------------------------
alter table public.documents          enable row level security;
alter table public.extracted_samples  enable row level security;
alter table public.soil_samples       enable row level security;
alter table public.soil_sample_fields enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'documents') then
    create policy "members manage documents" on public.documents for all
      using (public.is_member_of(user_id)) with check (public.is_member_of(user_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'extracted_samples') then
    create policy "members manage extracted_samples" on public.extracted_samples for all
      using (public.is_member_of(user_id)) with check (public.is_member_of(user_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'soil_samples') then
    create policy "members manage soil_samples" on public.soil_samples for all
      using (public.is_member_of(user_id)) with check (public.is_member_of(user_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'soil_sample_fields') then
    -- Junction has no user_id; scope through the parent sample. Reads in the
    -- app go via the get_field_soil_samples SECURITY DEFINER function
    -- (20260607), writes via the commit_document RPC — this policy is the
    -- direct-access fallback.
    create policy "members manage soil_sample_fields" on public.soil_sample_fields for all
      using (exists (select 1 from public.soil_samples s
                     where s.id = soil_sample_fields.sample_id and public.is_member_of(s.user_id)))
      with check (exists (select 1 from public.soil_samples s
                          where s.id = soil_sample_fields.sample_id and public.is_member_of(s.user_id)));
  end if;
end $$;

commit;
