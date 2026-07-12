import { describe, it, expect } from 'vitest';
import { computeDuplicateSlurryWarnings, slurryClashOnLog } from '@/lib/notifications';
import type { Application, Product } from '@/lib/types';

const slurry = (id: number, name: string): Product => ({
  id, user_id: null, name, type: 'slurry', category: null, sort_order: 0,
  dm_pct: 6, form: null, density_kg_per_l: null,
  n_pct: null, p2o5_pct: null, k2o_pct: null, s_pct: null,
  n_kg_per_m3: 2.4, p2o5_kg_per_m3: 1.2, k2o_kg_per_m3: 3.2, so3_kg_per_m3: null, mgo_kg_per_m3: null,
  n_kg_per_t: null, p2o5_kg_per_t: null, k2o_kg_per_t: null, so3_kg_per_t: null, mgo_kg_per_t: null,
} as unknown as Product);

const bag = (id: number, name: string): Product => ({
  ...slurry(id, name), type: 'bag_fert', n_pct: 27,
} as unknown as Product);

const app = (id: string, fieldId: string, productId: number, date: string, coverage: 'whole' | 'partial' = 'whole'): Application => ({
  id, user_id: 'u1', created_by: null, field_id: fieldId, product_id: productId,
  date_applied: date, rate_value: 2000, rate_unit: 'gal/ac', method: null, notes: null,
  applied_by: 'me', coverage, reconciled_at: null, drawn_ha: null,
} as unknown as Application);

const NAME = (id: string) => ({ f1: '13 Acre', f2: 'Low Meadows' }[id] ?? id);

describe('computeDuplicateSlurryWarnings', () => {
  const products = [slurry(1, 'Dairy slurry'), slurry(2, 'Digestate'), bag(9, 'CAN+S')];

  it('flags the same slurry product on the same field within 7 days', () => {
    const apps = [app('a', 'f1', 1, '2026-07-08'), app('b', 'f1', 1, '2026-07-04')];
    const w = computeDuplicateSlurryWarnings(apps, products, NAME);
    expect(w).toHaveLength(1);
    expect(w[0].fieldName).toBe('13 Acre');
    expect(w[0].daysApart).toBe(4);
    expect(w[0].productName).toBe('Dairy slurry');
    expect(w[0].laterAppId).toBe('a');   // more recent
    expect(w[0].earlierAppId).toBe('b'); // for deep-link + highlight
  });

  it('does NOT flag beyond the 7-day window', () => {
    const apps = [app('a', 'f1', 1, '2026-07-08'), app('b', 'f1', 1, '2026-06-28')];
    expect(computeDuplicateSlurryWarnings(apps, products, NAME)).toHaveLength(0);
  });

  it('does NOT flag two DIFFERENT slurry products (same-product only)', () => {
    const apps = [app('a', 'f1', 1, '2026-07-08'), app('b', 'f1', 2, '2026-07-06')];
    expect(computeDuplicateSlurryWarnings(apps, products, NAME)).toHaveLength(0);
  });

  it('does NOT flag bag fertiliser applied twice (slurry only)', () => {
    const apps = [app('a', 'f1', 9, '2026-07-08'), app('b', 'f1', 9, '2026-07-06')];
    expect(computeDuplicateSlurryWarnings(apps, products, NAME)).toHaveLength(0);
  });

  it('ignores pending part-field applications', () => {
    const apps = [app('a', 'f1', 1, '2026-07-08'), app('b', 'f1', 1, '2026-07-06', 'partial')];
    expect(computeDuplicateSlurryWarnings(apps, products, NAME)).toHaveLength(0);
  });

  it('produces a stable id from the application pair (dismissal key)', () => {
    const apps = [app('a', 'f1', 1, '2026-07-08'), app('b', 'f1', 1, '2026-07-04')];
    const w1 = computeDuplicateSlurryWarnings(apps, products, NAME);
    const w2 = computeDuplicateSlurryWarnings([...apps].reverse(), products, NAME);
    expect(w1[0].id).toBe(w2[0].id); // order-independent
  });

  it('separates warnings per field', () => {
    const apps = [
      app('a', 'f1', 1, '2026-07-08'), app('b', 'f1', 1, '2026-07-05'),
      app('c', 'f2', 1, '2026-07-07'), app('d', 'f2', 1, '2026-07-03'),
    ];
    const w = computeDuplicateSlurryWarnings(apps, products, NAME);
    expect(w).toHaveLength(2);
    expect(new Set(w.map((x) => x.fieldName))).toEqual(new Set(['13 Acre', 'Low Meadows']));
  });
});

describe('slurryClashOnLog', () => {
  const products = [slurry(1, 'Dairy slurry'), bag(9, 'CAN+S')];
  const existing = [app('a', 'f1', 1, '2026-07-04')];

  it('warns when a new slurry log lands within the window', () => {
    const clash = slurryClashOnLog(existing, products, 'f1', 1, '2026-07-08');
    expect(clash).not.toBeNull();
    expect(clash!.daysApart).toBe(4);
  });

  it('no warning outside the window', () => {
    expect(slurryClashOnLog(existing, products, 'f1', 1, '2026-07-20')).toBeNull();
  });

  it('no warning for a non-slurry product', () => {
    expect(slurryClashOnLog(existing, products, 'f1', 9, '2026-07-05')).toBeNull();
  });
});
