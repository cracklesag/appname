// Tests for the job-card map split metric (lib/field-clusters.ts).
//
// These lock the behaviour the map-splitting feature hangs off:
//   * a contiguous block of fields stays a single group;
//   * a parcel beyond the gap threshold splits off on its own;
//   * single-linkage chains fields across sub-threshold gaps (a line of fields
//     each just under the gap apart is still one block);
//   * distance/diagonal helpers report sane kilometres.

import { describe, it, expect } from 'vitest';
import { clusterByGap, haversineKm, bboxDiagonalKm } from '../field-clusters';

// A tight block of fields a few hundred metres apart, near Mill Farm latitude.
const block = [
  { lng: -2.700, lat: 53.800 },
  { lng: -2.697, lat: 53.801 },
  { lng: -2.701, lat: 53.802 },
  { lng: -2.695, lat: 53.799 },
];

describe('field clustering (job-card map split)', () => {
  it('keeps a contiguous block as one group', () => {
    expect(clusterByGap(block, 1.0)).toHaveLength(1);
  });

  it('splits off a parcel ~2 km away', () => {
    const far = { lng: -2.700, lat: 53.820 }; // ~2.2 km north
    const groups = clusterByGap([...block, far], 1.0);
    expect(groups).toHaveLength(2);
    // largest-first is applied by the caller, not here — just check membership.
    const sizes = groups.map((g) => g.length).sort((a, b) => b - a);
    expect(sizes).toEqual([4, 1]);
  });

  it('chains fields across gaps smaller than the threshold', () => {
    // three fields ~0.67 km apart in a line — one chain at a 1 km threshold,
    // even though the two ends are ~1.34 km apart.
    const line = [
      { lng: -2.700, lat: 53.800 },
      { lng: -2.700, lat: 53.806 },
      { lng: -2.700, lat: 53.812 },
    ];
    expect(clusterByGap(line, 1.0)).toHaveLength(1);
  });

  it('reports sane kilometres for distance and diagonal', () => {
    const d = haversineKm({ lng: -2.7, lat: 53.8 }, { lng: -2.7, lat: 53.82 });
    expect(d).toBeGreaterThan(2.0);
    expect(d).toBeLessThan(2.5);
    expect(bboxDiagonalKm(block)).toBeLessThan(1.0);
    expect(bboxDiagonalKm([{ lng: -2.7, lat: 53.8 }])).toBe(0);
  });
});
