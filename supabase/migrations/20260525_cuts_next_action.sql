-- =============================================================================
-- Migration: cuts.next_action
-- Purpose:   Per-cut "what's next" state. Set at log-cut time; drives
--            spreading-report mode eligibility (after-cut / maintenance) and
--            grazing-report inclusion (rotational_grazing).
-- =============================================================================
--
-- Design: nullable column. Existing cuts stay null and the app's resolver
-- falls back to the field's planned_cuts array. As users log new cuts the
-- explicit next_action takes over.
--
-- Values:
--   another_cut_silage  — another silage cut to come
--   another_cut_bales   — another bales cut to come
--   rotational_grazing  — field enters grazing-report rotation
--   maintenance_grazing — one maintenance dose then leave (N-total threshold
--                         based, slurry + liquid digestate + fert all stack)
-- =============================================================================

begin;

alter table public.cuts
  add column if not exists next_action text
    check (next_action is null or next_action in (
      'another_cut_silage',
      'another_cut_bales',
      'rotational_grazing',
      'maintenance_grazing'
    ));

-- Index for the resolver — frequently we look up "most recent cut for field X"
-- to read its next_action. The existing (field_id, cut_date desc) order
-- handles this; no extra index needed.

commit;
