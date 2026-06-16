import { describe, it, expect } from 'vitest';
import {
  inUseGroupingValues,
  composedFieldNCap,
  activeCropFieldIds,
  fieldIsGrassForReports,
  fieldMatchesAxisFilter,
  axisFilterIsActive,
  emptyAxisFilter,
  type GroupedField,
  type AxisFilter,
} from '../grouping';
import { allocationTypeNCap, ALLOCATION_TYPE_SEEDS } from '../allocation_types';
import {
  axisChipOptions,
  fieldPassesAxisParams,
  axisParamsActive,
} from '../grouping';

const F = (id: string, group_id: string | null, type: string | null): GroupedField => ({
  id, group_id, allocation_type_id: type,
});

describe('inUseGroupingValues', () => {
  it('reports only the axis values that have fields, plus the unassigned flags', () => {
    const fields = [
      F('f1', 'home', 'silage'),
      F('f2', 'home', null),
      F('f3', null, 'rot'),
    ];
    const map = { f1: ['SAM3'], f2: [], f3: ['SAM3', 'GS6'] };
    const r = inUseGroupingValues(fields, map);
    expect([...r.blockIds].sort()).toEqual(['home']);
    expect([...r.typeIds].sort()).toEqual(['rot', 'silage']);
    expect([...r.agreementIds].sort()).toEqual(['GS6', 'SAM3']);
    expect(r.anyUnblocked).toBe(true);   // f3
    expect(r.anyUntyped).toBe(true);     // f2
    expect(r.anyWithoutAgreement).toBe(true); // f2
  });

  it('clears the unassigned flags when every field is fully assigned', () => {
    const fields = [F('f1', 'home', 'silage')];
    const r = inUseGroupingValues(fields, { f1: ['SAM3'] });
    expect(r.anyUnblocked).toBe(false);
    expect(r.anyUntyped).toBe(false);
    expect(r.anyWithoutAgreement).toBe(false);
  });
});

describe('allocationTypeNCap', () => {
  it('returns the cap when set, null otherwise', () => {
    expect(allocationTypeNCap({ n_cap_kg_per_ha: 80 })).toBe(80);
    expect(allocationTypeNCap({ n_cap_kg_per_ha: null })).toBeNull();
    expect(allocationTypeNCap(null)).toBeNull();
  });
  it('ships the four seeds uncapped by default', () => {
    expect(ALLOCATION_TYPE_SEEDS).toHaveLength(4);
    for (const s of ALLOCATION_TYPE_SEEDS) expect(s.nCapKgPerHa).toBeNull();
  });
});

describe('composedFieldNCap', () => {
  it('returns null when nothing caps N', () => {
    expect(composedFieldNCap({ agreements: [] })).toBeNull();
  });

  it('uses the allocation type cap when only the type caps', () => {
    const r = composedFieldNCap({ type: { n_cap_kg_per_ha: 80, label: 'Low input' }, agreements: [] });
    expect(r).toEqual({ capKgHa: 80, source: 'Low input' });
  });

  it('uses the block legacy cap only when low_input is on and a cap is set', () => {
    expect(composedFieldNCap({ block: { low_input: false, max_n_kg_per_ha: 60, label: 'Home' }, agreements: [] }))
      .toBeNull();
    expect(composedFieldNCap({ block: { low_input: true, max_n_kg_per_ha: 60, label: 'Home' }, agreements: [] }))
      .toEqual({ capKgHa: 60, source: 'Home' });
  });

  it('an agreement tighter than block and type wins, labelled by code', () => {
    const r = composedFieldNCap({
      block: { low_input: true, max_n_kg_per_ha: 100, label: 'Home' },
      type: { n_cap_kg_per_ha: 80, label: 'Low input' },
      agreements: [{ code: 'SAM3', name: 'Herbal leys', manufactured_n_cap_kg_ha: 40 }],
    });
    expect(r).toEqual({ capKgHa: 40, source: 'SAM3' });
  });

  it('a no-fertiliser agreement drives the composed cap to 0', () => {
    const r = composedFieldNCap({
      type: { n_cap_kg_per_ha: 80, label: 'Low input' },
      agreements: [{ code: 'GS6', name: 'Species-rich', no_manufactured_fert: true }],
    });
    expect(r).toEqual({ capKgHa: 0, source: 'GS6' });
  });

  it('picks the tightest of type vs block when no agreement caps', () => {
    const r = composedFieldNCap({
      block: { low_input: true, max_n_kg_per_ha: 50, label: 'Hill' },
      type: { n_cap_kg_per_ha: 80, label: 'Low input' },
      agreements: [],
    });
    expect(r).toEqual({ capKgHa: 50, source: 'Hill' });
  });
});

describe('crop report predicate', () => {
  const allocs = [
    { field_id: 'f1', status: 'active' },
    { field_id: 'f2', status: 'planned' },
    { field_id: 'f3', status: 'harvested' },
  ];
  it('collects only active crop fields', () => {
    expect([...activeCropFieldIds(allocs)]).toEqual(['f1']);
  });
  it('treats a field with an active crop as not-grass', () => {
    const active = activeCropFieldIds(allocs);
    expect(fieldIsGrassForReports('f1', active)).toBe(false);
    expect(fieldIsGrassForReports('f2', active)).toBe(true);  // planned ≠ active
    expect(fieldIsGrassForReports('f9', active)).toBe(true);  // no allocation
  });
});

describe('fieldMatchesAxisFilter', () => {
  const map = { f1: ['SAM3', 'GS6'], f2: [], f3: ['GS6'] };
  const f1 = F('f1', 'home', 'silage');
  const f2 = F('f2', 'rented', 'rot');
  const f3 = F('f3', 'home', null);

  it('passes everything when the filter is empty', () => {
    const empty = emptyAxisFilter();
    expect(axisFilterIsActive(empty)).toBe(false);
    expect(fieldMatchesAxisFilter(f1, empty, map)).toBe(true);
  });

  it('ORs within an axis', () => {
    const filter: AxisFilter = { blocks: new Set(['home', 'rented']), types: new Set(), agreements: new Set() };
    expect(fieldMatchesAxisFilter(f1, filter, map)).toBe(true);
    expect(fieldMatchesAxisFilter(f2, filter, map)).toBe(true);
  });

  it('ANDs across axes', () => {
    const filter: AxisFilter = { blocks: new Set(['home']), types: new Set(['silage']), agreements: new Set() };
    expect(fieldMatchesAxisFilter(f1, filter, map)).toBe(true);   // home + silage
    expect(fieldMatchesAxisFilter(f3, filter, map)).toBe(false);  // home but untyped
  });

  it('matches on agreement membership', () => {
    const filter: AxisFilter = { blocks: new Set(), types: new Set(), agreements: new Set(['SAM3']) };
    expect(fieldMatchesAxisFilter(f1, filter, map)).toBe(true);   // has SAM3
    expect(fieldMatchesAxisFilter(f3, filter, map)).toBe(false);  // only GS6
  });

  it('excludes unassigned fields when that axis is filtered', () => {
    const filter: AxisFilter = { blocks: new Set(), types: new Set(['silage']), agreements: new Set() };
    expect(fieldMatchesAxisFilter(f3, filter, map)).toBe(false);  // f3 untyped
  });
});

describe('axisChipOptions', () => {
  const fields = [
    F('f1', 'home', 'silage'),
    F('f2', 'home', null),
    F('f3', null, 'rot'),
  ];
  const map = { f1: ['ag_sam3'], f2: [], f3: ['ag_gs6'] };
  const blocks = [{ id: 'home', name: 'Home' }, { id: 'away', name: 'Away farm' }];
  const types = [{ id: 'silage', label: 'Silage' }, { id: 'rot', label: 'Rotational' }, { id: 'low', label: 'Low input' }];
  const agreements = [{ id: 'ag_sam3', code: 'SAM3' }, { id: 'ag_gs6', code: 'GS6' }, { id: 'ag_x', code: 'GS2' }];

  it('lists only in-use values, plus All and the unassigned sentinels', () => {
    const o = axisChipOptions({ fields, blocks, types, agreements, fieldAgreementMap: map });
    expect(o.block.map((c) => c.value)).toEqual(['all', 'home', 'unassigned']); // away unused, f3 unblocked
    expect(o.type.map((c) => c.value)).toEqual(['all', 'silage', 'rot', 'untyped']); // low unused, f2 untyped
    expect(o.agreement.map((c) => c.value)).toEqual(['all', 'ag_sam3', 'ag_gs6', 'none']); // ag_x unused, f2 none
  });

  it('omits the unassigned sentinel when every field is assigned on that axis', () => {
    const full = [F('f1', 'home', 'silage')];
    const o = axisChipOptions({ fields: full, blocks, types, agreements, fieldAgreementMap: { f1: ['ag_sam3'] } });
    expect(o.block.find((c) => c.value === 'unassigned')).toBeUndefined();
    expect(o.type.find((c) => c.value === 'untyped')).toBeUndefined();
    expect(o.agreement.find((c) => c.value === 'none')).toBeUndefined();
  });
});

describe('fieldPassesAxisParams', () => {
  const map = { f1: ['ag_sam3', 'ag_gs6'], f2: [], f3: ['ag_gs6'] };
  const f1 = F('f1', 'home', 'silage');
  const f2 = F('f2', 'away', 'rot');
  const f3 = F('f3', null, null);

  it('passes everything when all axes are all/absent', () => {
    expect(fieldPassesAxisParams(f1, {}, map)).toBe(true);
    expect(fieldPassesAxisParams(f3, { block: 'all', type: 'all', agreement: 'all' }, map)).toBe(true);
  });
  it('filters by a specific block', () => {
    expect(fieldPassesAxisParams(f1, { block: 'home' }, map)).toBe(true);
    expect(fieldPassesAxisParams(f2, { block: 'home' }, map)).toBe(false);
  });
  it('handles the unassigned sentinels', () => {
    expect(fieldPassesAxisParams(f3, { block: 'unassigned' }, map)).toBe(true);
    expect(fieldPassesAxisParams(f1, { block: 'unassigned' }, map)).toBe(false);
    expect(fieldPassesAxisParams(f3, { type: 'untyped' }, map)).toBe(true);
    expect(fieldPassesAxisParams(f2, { agreement: 'none' }, map)).toBe(true);  // f2 has no agreements
    expect(fieldPassesAxisParams(f1, { agreement: 'none' }, map)).toBe(false); // f1 has SAM3/GS6
    expect(fieldPassesAxisParams(f2, { type: 'rot' }, map)).toBe(true);
  });
  it('filters by agreement membership', () => {
    expect(fieldPassesAxisParams(f1, { agreement: 'ag_sam3' }, map)).toBe(true);
    expect(fieldPassesAxisParams(f3, { agreement: 'ag_sam3' }, map)).toBe(false);
  });
  it('ANDs across axes', () => {
    expect(fieldPassesAxisParams(f1, { block: 'home', type: 'silage', agreement: 'ag_gs6' }, map)).toBe(true);
    expect(fieldPassesAxisParams(f1, { block: 'home', type: 'rot' }, map)).toBe(false);
  });
});

describe('axisParamsActive', () => {
  it('is false for empty / all params', () => {
    expect(axisParamsActive({})).toBe(false);
    expect(axisParamsActive({ block: 'all', type: 'all', agreement: 'all' })).toBe(false);
  });
  it('is true when any axis is set', () => {
    expect(axisParamsActive({ type: 'silage' })).toBe(true);
    expect(axisParamsActive({ agreement: 'none' })).toBe(true);
  });
});
