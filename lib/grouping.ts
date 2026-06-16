// =====================================================================
// Swardly · Grouping logic — the glue for the three-axis model
// (blocks / allocation types / agreements).
//
//  * inUseGroupingValues  — which axis values actually have fields, so the
//    filter chips show only what's in use (settings still show everything).
//  * composedFieldNCap    — the most-restrictive advisory N cap for a field,
//    merging its block (legacy profile), allocation type, and agreements,
//    labelled with whatever imposed it.
//  * fieldHasActiveCrop   — the report predicate: a field allocated to a crop
//    this season is not "grass" and drops out of the grass reports/maps.
//
// All advisory: nothing here changes a recommended number or blocks a save.
// =====================================================================

import {
  mostRestrictiveNCap,
  agreementNCap,
  type NCapSource,
  type AgreementNCapInput,
} from './agreements';
import { allocationTypeNCap, type AllocationTypeRow } from './allocation_types';

// ---------------------------------------------------------------------
// In-use axis values
// ---------------------------------------------------------------------

/** Minimal field shape the grouping helpers need. */
export interface GroupedField {
  id: string;
  group_id: string | null;          // block
  allocation_type_id?: string | null;
}

export interface InUseGroupingValues {
  /** Block ids with at least one field. */
  blockIds: Set<string>;
  /** Allocation-type ids with at least one field. */
  typeIds: Set<string>;
  /** Agreement ids with at least one field. */
  agreementIds: Set<string>;
  /** Some field has no block. */
  anyUnblocked: boolean;
  /** Some field has no allocation type. */
  anyUntyped: boolean;
  /** Some field has no agreement. */
  anyWithoutAgreement: boolean;
}

/**
 * Derive which values are actually in use across each axis, so the filter can
 * offer only populated chips. `fieldAgreementMap` is field_id -> agreement_id[].
 */
export function inUseGroupingValues(
  fields: GroupedField[],
  fieldAgreementMap: Record<string, string[]>,
): InUseGroupingValues {
  const blockIds = new Set<string>();
  const typeIds = new Set<string>();
  const agreementIds = new Set<string>();
  let anyUnblocked = false;
  let anyUntyped = false;
  let anyWithoutAgreement = false;

  for (const f of fields) {
    if (f.group_id) blockIds.add(f.group_id);
    else anyUnblocked = true;

    if (f.allocation_type_id) typeIds.add(f.allocation_type_id);
    else anyUntyped = true;

    const ags = fieldAgreementMap[f.id] ?? [];
    if (ags.length === 0) anyWithoutAgreement = true;
    for (const a of ags) agreementIds.add(a);
  }

  return { blockIds, typeIds, agreementIds, anyUnblocked, anyUntyped, anyWithoutAgreement };
}

// ---------------------------------------------------------------------
// Composed N cap (block legacy profile + allocation type + agreements)
// ---------------------------------------------------------------------

/** Legacy block-profile cap inputs (groups.low_input + groups.max_n_kg_per_ha). */
export interface BlockCapInput {
  label?: string;
  low_input?: boolean | null;
  max_n_kg_per_ha?: number | null;
}

/**
 * The single most restrictive advisory manufactured-N cap that applies to a
 * field, considering — in increasing specificity — its block's legacy profile,
 * its allocation type, and all of its agreements. Returns the cap with the
 * label of whatever imposed it ("capped by GS6"), or null if nothing caps N.
 *
 * Order of precedence for ties: type over block over agreement is *not*
 * enforced numerically — the tightest number wins, and an exact tie keeps the
 * earlier (more general) source, reading more naturally to the user.
 */
export function composedFieldNCap(opts: {
  block?: BlockCapInput | null;
  type?: Pick<AllocationTypeRow, 'n_cap_kg_per_ha' | 'label'> | null;
  agreements: (AgreementNCapInput & { name?: string; code?: string })[];
}): NCapSource | null {
  let baseline: NCapSource | null = null;

  // Block legacy profile: only counts when low_input is on AND a cap is set
  // (matches the existing groupProfileWarnings behaviour).
  if (opts.block?.low_input && opts.block.max_n_kg_per_ha != null) {
    baseline = { capKgHa: opts.block.max_n_kg_per_ha, source: opts.block.label || 'block' };
  }

  // Allocation type cap.
  const tyCap = allocationTypeNCap(opts.type ?? null);
  if (tyCap != null) {
    if (baseline == null || tyCap < baseline.capKgHa) {
      baseline = { capKgHa: tyCap, source: opts.type?.label || 'allocation type' };
    }
  }

  // Agreements (most-restrictive across them, vs the baseline).
  return mostRestrictiveNCap(baseline, opts.agreements);
}

// ---------------------------------------------------------------------
// Report grass-vs-crop predicate
// ---------------------------------------------------------------------

/** Minimal crop-allocation shape for the predicate. */
export interface CropAllocationLike {
  field_id: string;
  status: string;
}

/**
 * Field ids that currently have an ACTIVE crop allocation — i.e. they're a crop
 * field, not grass, and should drop out of the grass reports/maps for now. The
 * grass machinery treats every field as grass, so callers intersect/​subtract
 * this set where they want grass-only.
 */
export function activeCropFieldIds(allocations: CropAllocationLike[]): Set<string> {
  const out = new Set<string>();
  for (const a of allocations) if (a.status === 'active') out.add(a.field_id);
  return out;
}

/** True if the field is grass for report purposes (no active crop allocation). */
export function fieldIsGrassForReports(
  fieldId: string,
  activeCropIds: Set<string>,
): boolean {
  return !activeCropIds.has(fieldId);
}

// ---------------------------------------------------------------------
// Filter matching (shared across surfaces)
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Single-select URL-param filtering (shared by the fields list & reports)
//
// The app's filter language is single-select chips backed by URL params
// (see components/FilterChips). These helpers build the in-use chip options
// for each axis and apply the chosen params, so every surface filters the
// same way. Param values: 'all' (default), a value id, or the "unassigned"
// sentinel ('unassigned' block / 'untyped' type / 'none' agreement).
// ---------------------------------------------------------------------

export interface ChipOption { value: string; label: string; }

/** Per-axis chip options limited to values that actually have fields. */
export function axisChipOptions(opts: {
  fields: GroupedField[];
  blocks: { id: string; name: string }[];
  types: { id: string; label: string }[];
  agreements: { id: string; code: string }[];
  fieldAgreementMap: Record<string, string[]>;
}): { block: ChipOption[]; type: ChipOption[]; agreement: ChipOption[] } {
  const inUse = inUseGroupingValues(opts.fields, opts.fieldAgreementMap);

  const block: ChipOption[] = [{ value: 'all', label: 'All blocks' }];
  for (const b of opts.blocks) if (inUse.blockIds.has(b.id)) block.push({ value: b.id, label: b.name });
  if (inUse.anyUnblocked) block.push({ value: 'unassigned', label: 'No block' });

  const type: ChipOption[] = [{ value: 'all', label: 'All types' }];
  for (const t of opts.types) if (inUse.typeIds.has(t.id)) type.push({ value: t.id, label: t.label });
  if (inUse.anyUntyped) type.push({ value: 'untyped', label: 'Untyped' });

  const agreement: ChipOption[] = [{ value: 'all', label: 'All agreements' }];
  for (const a of opts.agreements) if (inUse.agreementIds.has(a.id)) agreement.push({ value: a.id, label: a.code });
  if (inUse.anyWithoutAgreement) agreement.push({ value: 'none', label: 'No agreement' });

  return { block, type, agreement };
}

/** Does a field pass the chosen single-select axis params? 'all'/absent = pass. */
export function fieldPassesAxisParams(
  field: GroupedField,
  params: { block?: string; type?: string; agreement?: string },
  fieldAgreementMap: Record<string, string[]>,
): boolean {
  const blk = params.block ?? 'all';
  if (blk !== 'all') {
    if (blk === 'unassigned') { if (field.group_id) return false; }
    else if (field.group_id !== blk) return false;
  }
  const ty = params.type ?? 'all';
  if (ty !== 'all') {
    if (ty === 'untyped') { if (field.allocation_type_id) return false; }
    else if (field.allocation_type_id !== ty) return false;
  }
  const ag = params.agreement ?? 'all';
  if (ag !== 'all') {
    const ags = fieldAgreementMap[field.id] ?? [];
    if (ag === 'none') { if (ags.length > 0) return false; }
    else if (!ags.includes(ag)) return false;
  }
  return true;
}

/** True if any axis param is set to something other than 'all'/absent. */
export function axisParamsActive(params: { block?: string; type?: string; agreement?: string }): boolean {
  return (params.block && params.block !== 'all') || (params.type && params.type !== 'all') || (params.agreement && params.agreement !== 'all') ? true : false;
}

export interface AxisFilter {
  blocks: Set<string>;
  types: Set<string>;
  agreements: Set<string>;
}

export function emptyAxisFilter(): AxisFilter {
  return { blocks: new Set(), types: new Set(), agreements: new Set() };
}

export function axisFilterIsActive(f: AxisFilter): boolean {
  return f.blocks.size > 0 || f.types.size > 0 || f.agreements.size > 0;
}

/**
 * Does a field pass the axis filter? Within an axis, selected values are OR'd
 * (any match); across axes they're AND'd (must pass every active axis).
 */
export function fieldMatchesAxisFilter(
  field: GroupedField,
  filter: AxisFilter,
  fieldAgreementMap: Record<string, string[]>,
): boolean {
  if (filter.blocks.size > 0 && !(field.group_id && filter.blocks.has(field.group_id))) return false;
  if (filter.types.size > 0 && !(field.allocation_type_id && filter.types.has(field.allocation_type_id))) return false;
  if (filter.agreements.size > 0) {
    const ags = fieldAgreementMap[field.id] ?? [];
    if (!ags.some((a) => filter.agreements.has(a))) return false;
  }
  return true;
}
