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
