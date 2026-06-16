import { describe, it, expect } from 'vitest';
import {
  agreementNCap,
  mostRestrictiveNCap,
  summariseRestrictions,
  AGREEMENT_SEEDS,
  type AgreementRow,
  type NCapSource,
} from '../agreements';

// Minimal row factory — all restrictions off unless overridden.
function row(over: Partial<AgreementRow>): AgreementRow {
  return {
    id: 'x', user_id: null, seed_key: null, code: 'X', name: 'Test', scheme: 'custom', summary: '',
    no_manufactured_fert: false, manufactured_n_cap_kg_ha: null, total_n_cap_kg_ha: null,
    organic_manure_cap_t_ha: null, manure_cut_years_only: false, organic_n_field_cap_kg_ha: null,
    no_phosphate: false, no_potash: false,
    closed_cut_start_md: null, closed_cut_end_md: null, earliest_cut_md: null,
    manufactured_n_closed_start_md: null, manufactured_n_closed_end_md: null,
    livestock_exclusion_weeks_pre_cut: null, grazing_closed_start_md: null, grazing_closed_end_md: null,
    max_stocking_lu_ha: null, no_supplementary_feeding: false, mineral_blocks_allowed: false,
    min_ph: null, note: null, sort_order: 0,
    ...over,
  };
}

describe('agreementNCap', () => {
  it('returns 0 when manufactured fertiliser is banned', () => {
    expect(agreementNCap({ no_manufactured_fert: true })).toBe(0);
  });
  it('returns the explicit cap when set', () => {
    expect(agreementNCap({ manufactured_n_cap_kg_ha: 40 })).toBe(40);
  });
  it('returns null when no N restriction is set', () => {
    expect(agreementNCap({})).toBeNull();
  });
  it('no-fert flag beats an explicit cap (0 wins)', () => {
    expect(agreementNCap({ no_manufactured_fert: true, manufactured_n_cap_kg_ha: 40 })).toBe(0);
  });
});

describe('mostRestrictiveNCap', () => {
  const base: NCapSource = { capKgHa: 250, source: 'Silage type' };

  it('returns the baseline when no agreement caps N', () => {
    const r = mostRestrictiveNCap(base, [row({}), row({ code: 'LIG1' })]);
    expect(r).toEqual({ capKgHa: 250, source: 'Silage type' });
  });

  it('an agreement tighter than the baseline wins, labelled by its code', () => {
    const r = mostRestrictiveNCap(base, [row({ code: 'SAM3', manufactured_n_cap_kg_ha: 40 })]);
    expect(r).toEqual({ capKgHa: 40, source: 'SAM3' });
  });

  it('no-fertiliser agreement drives the cap to 0', () => {
    const r = mostRestrictiveNCap(base, [row({ code: 'GS6', no_manufactured_fert: true })]);
    expect(r).toEqual({ capKgHa: 0, source: 'GS6' });
  });

  it('picks the lowest across several agreements', () => {
    const r = mostRestrictiveNCap(base, [
      row({ code: 'SAM3', manufactured_n_cap_kg_ha: 40 }),
      row({ code: 'GS4', manufactured_n_cap_kg_ha: 60 }),
      row({ code: 'GS6', no_manufactured_fert: true }),
    ]);
    expect(r).toEqual({ capKgHa: 0, source: 'GS6' });
  });

  it('keeps the baseline on a tie (incumbent wins)', () => {
    const r = mostRestrictiveNCap({ capKgHa: 40, source: 'Low input type' }, [
      row({ code: 'SAM3', manufactured_n_cap_kg_ha: 40 }),
    ]);
    expect(r).toEqual({ capKgHa: 40, source: 'Low input type' });
  });

  it('works with no baseline — tightest agreement, or null', () => {
    expect(mostRestrictiveNCap(null, [row({ code: 'SAM3', manufactured_n_cap_kg_ha: 40 })]))
      .toEqual({ capKgHa: 40, source: 'SAM3' });
    expect(mostRestrictiveNCap(null, [row({}), row({})])).toBeNull();
  });

  it('falls back to name when an agreement has no code', () => {
    const r = mostRestrictiveNCap(null, [row({ code: '', name: 'My scheme', manufactured_n_cap_kg_ha: 25 })]);
    expect(r).toEqual({ capKgHa: 25, source: 'My scheme' });
  });
});

describe('summariseRestrictions', () => {
  it('returns nothing for an unrestricted agreement', () => {
    expect(summariseRestrictions(row({}))).toEqual([]);
  });

  it('flattens a species-rich-grassland style agreement into chips', () => {
    const r = summariseRestrictions(row({
      no_manufactured_fert: true,
      organic_manure_cap_t_ha: 12, manure_cut_years_only: true,
      closed_cut_start_md: '03-15', closed_cut_end_md: '06-30',
      livestock_exclusion_weeks_pre_cut: 7,
      no_supplementary_feeding: true, mineral_blocks_allowed: true,
    }));
    const kinds = r.map((x) => x.kind);
    expect(kinds).toContain('no_fert');
    expect(kinds).toContain('manure_cap');
    expect(kinds).toContain('closed_cut');
    expect(kinds).toContain('stock_exclusion');
    expect(kinds).toContain('no_feed');
    // no_fert suppresses a redundant numeric n_cap chip
    expect(kinds).not.toContain('n_cap');
  });

  it('shows a numeric N cap when fertiliser is allowed but capped', () => {
    const r = summariseRestrictions(row({ manufactured_n_cap_kg_ha: 40 }));
    expect(r).toEqual([{ kind: 'n_cap', label: '≤40 kg N/ha' }]);
  });

  it('formats month-day windows as human dates', () => {
    const r = summariseRestrictions(row({ closed_cut_start_md: '03-15', closed_cut_end_md: '06-30' }));
    expect(r[0].label).toBe('No cut 15 Mar–30 Jun');
  });
});

describe('AGREEMENT_SEEDS integrity', () => {
  it('has unique seed keys and codes', () => {
    const keys = AGREEMENT_SEEDS.map((s) => s.seedKey);
    const codes = AGREEMENT_SEEDS.map((s) => s.code);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every seed uses a known scheme', () => {
    for (const s of AGREEMENT_SEEDS) {
      expect(['sfi', 'cs', 'es', 'custom']).toContain(s.scheme);
    }
  });

  it('does NOT seed NVZ (statutory, modelled separately)', () => {
    for (const s of AGREEMENT_SEEDS) {
      expect(s.code.toUpperCase()).not.toContain('NVZ');
      expect(s.scheme).not.toBe('nvz' as never);
    }
  });

  it('GS6 carries its known restriction set', () => {
    const gs6 = AGREEMENT_SEEDS.find((s) => s.code === 'GS6');
    expect(gs6).toBeDefined();
    expect(gs6!.noManufacturedFert).toBe(true);
    expect(gs6!.organicManureCapTHa).toBe(12);
    expect(gs6!.closedCutStartMd).toBe('03-15');
    expect(gs6!.closedCutEndMd).toBe('06-30');
    expect(gs6!.livestockExclusionWeeksPreCut).toBe(7);
    expect(gs6!.noSupplementaryFeeding).toBe(true);
  });

  it('herbal leys seed the typical ~40 kg N advisory cap', () => {
    const sam3 = AGREEMENT_SEEDS.find((s) => s.code === 'SAM3');
    expect(sam3?.manufacturedNCapKgHa).toBe(40);
  });
});
