import { describe, it, expect } from 'vitest';
import { areaFromProductVolume, computeSprayMix } from '../spray';

describe('areaFromProductVolume (by-volume pivot)', () => {
  it('area = volume / rate', () => {
    expect(areaFromProductVolume(10, 2.5)).toBeCloseTo(4, 6); // 10 L at 2.5 L/ha => 4 ha
    expect(areaFromProductVolume(6, 1.5)).toBeCloseTo(4, 6);
  });

  it('returns 0 when an input is missing or non-positive', () => {
    expect(areaFromProductVolume(0, 2.5)).toBe(0);
    expect(areaFromProductVolume(10, 0)).toBe(0);
    expect(areaFromProductVolume(-5, 2.5)).toBe(0);
    expect(areaFromProductVolume(10, -2)).toBe(0);
  });

  it('feeding the implied area back into the mix reproduces the fixed volume', () => {
    // 10 L of a product at 2.5 L/ha implies 4 ha.
    const ha = areaFromProductVolume(10, 2.5);
    const mix = computeSprayMix({
      areaHa: ha,
      widthM: 12,
      totalFlowLMin: 24,
      speedKmh: 10,
      lines: [{ name: 'Doxstar', lPerHa: 2.5 }],
    });
    expect(mix.ok).toBe(true);
    expect(mix.lines[0].volumeL).toBeCloseTo(10, 6); // back to the 10 L we started with
  });
});

// ---- solveSprayMix: one identity, four ways in ---------------------------
import { solveSprayMix, calibrationLPerHa, computeLoadSplit } from '../spray';

describe('solveSprayMix', () => {
  const lines = [{ name: 'Doxstar Pro', lPerHa: 2 }, { name: 'Wetter', lPerHa: 0.5 }];

  it("anchor 'area': products, water and total from a known area", () => {
    const r = solveSprayMix({ anchor: 'area', waterLPerHa: 200, lines, areaHa: 4 });
    expect(r.ok).toBe(true);
    expect(r.lines[0].volumeL).toBeCloseTo(8, 6);     // 2 × 4
    expect(r.lines[1].volumeL).toBeCloseTo(2, 6);     // 0.5 × 4
    expect(r.waterL).toBeCloseTo(800, 6);             // 200 × 4 — WATER ONLY
    expect(r.totalSprayL).toBeCloseTo(810, 6);        // (200+2.5) × 4
    expect(r.appRateLPerHa).toBeCloseTo(202.5, 6);
  });

  it("anchor 'area' without water still gives area + product volumes (water null)", () => {
    const r = solveSprayMix({ anchor: 'area', waterLPerHa: null, lines, areaHa: 4 });
    expect(r.ok).toBe(true);
    expect(r.totalProductL).toBeCloseTo(10, 6);
    expect(r.waterL).toBeNull();
    expect(r.totalSprayL).toBeNull();
  });

  it("anchor 'productVolume': 6 L of one spray drives everything else", () => {
    const r = solveSprayMix({ anchor: 'productVolume', waterLPerHa: 200, lines, pivot: { lPerHa: 2, volumeL: 6 } });
    expect(r.ok).toBe(true);
    expect(r.areaHa).toBeCloseTo(3, 6);               // 6 / 2
    expect(r.lines[1].volumeL).toBeCloseTo(1.5, 6);   // 0.5 × 3
    expect(r.waterL).toBeCloseTo(600, 6);             // 200 × 3
  });

  it("anchor 'tank': one full tank — components sum exactly back to the tank", () => {
    const r = solveSprayMix({ anchor: 'tank', waterLPerHa: 200, lines, tankL: 1000 });
    expect(r.ok).toBe(true);
    expect(r.areaHa).toBeCloseTo(1000 / 202.5, 6);
    expect((r.waterL ?? 0) + r.totalProductL).toBeCloseTo(1000, 6);
    expect(r.totalSprayL).toBeCloseTo(1000, 6);
  });

  it("anchor 'tank' needs water; product anchor needs a volume", () => {
    expect(solveSprayMix({ anchor: 'tank', waterLPerHa: null, lines, tankL: 1000 }).ok).toBe(false);
    expect(solveSprayMix({ anchor: 'productVolume', waterLPerHa: 200, lines }).ok).toBe(false);
    expect(solveSprayMix({ anchor: 'area', waterLPerHa: 200, lines: [], areaHa: 4 }).ok).toBe(false);
  });

  it('load split off the solver splits the field into tanks that sum back', () => {
    const r = solveSprayMix({ anchor: 'area', waterLPerHa: 200, lines, areaHa: 10 });
    const split = computeLoadSplit({ appRateLPerHa: r.appRateLPerHa!, totalSprayL: r.totalSprayL!, tankL: 1000, lines });
    expect(split.ok).toBe(true);
    const total = split.loads.reduce((a, ld) => a + ld.volumeL * ld.count, 0);
    expect(total).toBeCloseTo(r.totalSprayL!, 4);
  });
});

describe('calibrationLPerHa (optional helper, never a gate)', () => {
  it('matches the NPTC 600-constant relationship', () => {
    // 33 L/min total, 10 km/h, 12 m boom → 165 L/ha
    expect(calibrationLPerHa(33, 10, 12)).toBeCloseTo(165, 6);
    expect(calibrationLPerHa(null, 10, 12)).toBeNull();
    expect(calibrationLPerHa(33, 0, 12)).toBeNull();
  });
});
