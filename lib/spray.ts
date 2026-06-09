import { SprayProduct, SprayPurchase, SprayRecord } from './types';

// ---- Stock --------------------------------------------------------------
// Stock is computed, never stored: SUM(purchases) − SUM(usage on records that
// reference the product), so it can't drift from the underlying rows.

export interface SprayStock {
  purchasedL: number;
  usedL: number;
  stockL: number;
}

export function computeSprayStock(
  products: SprayProduct[],
  purchases: SprayPurchase[],
  records: Pick<SprayRecord, 'spray_product_id' | 'product_litres'>[],
): Map<string, SprayStock> {
  const m = new Map<string, SprayStock>();
  for (const p of products) m.set(p.id, { purchasedL: 0, usedL: 0, stockL: 0 });
  for (const pur of purchases) {
    const s = m.get(pur.product_id);
    if (s) s.purchasedL += pur.litres || 0;
  }
  for (const r of records) {
    if (!r.spray_product_id) continue;
    const s = m.get(r.spray_product_id);
    if (s) s.usedL += r.product_litres || 0;
  }
  for (const s of m.values()) s.stockL = s.purchasedL - s.usedL;
  return m;
}

// ---- Calibration calculator --------------------------------------------
// Application volume (total liquid, water + products) per hectare:
//   L/ha = totalFlow(L/min) × 600 ÷ (speed km/h × width m)
// where totalFlow = nozzle flow (L/min) × number of nozzles.
// Per product: volume = product L/ha × area. Water = total spray − Σ products.

export interface SprayLine {
  name: string;
  lPerHa: number;
}

export interface SprayCalcResult {
  ok: boolean;
  reason?: string;
  appRateLPerHa: number;
  totalFlowLMin: number;
  lines: { name: string; lPerHa: number; volumeL: number }[];
  totalProductL: number;
  waterL: number;
  totalSprayL: number;
  waterNegative: boolean;
}

export function computeSprayMix(args: {
  areaHa: number;
  widthM: number | null;
  nozzleFlowLMin: number | null;
  nozzleCount: number | null;
  speedKmh: number | null;
  lines: SprayLine[];
}): SprayCalcResult {
  const { areaHa, widthM, nozzleFlowLMin, nozzleCount, speedKmh, lines } = args;
  const totalFlowLMin = (nozzleFlowLMin ?? 0) * (nozzleCount ?? 0);
  const emptyLines = lines.map((l) => ({ name: l.name, lPerHa: l.lPerHa, volumeL: 0 }));

  if (!(areaHa > 0)) {
    return { ok: false, reason: 'Select a field or enter an area to spray.', appRateLPerHa: 0, totalFlowLMin, lines: emptyLines, totalProductL: 0, waterL: 0, totalSprayL: 0, waterNegative: false };
  }
  if (!(widthM && widthM > 0) || !(totalFlowLMin > 0) || !(speedKmh && speedKmh > 0)) {
    return { ok: false, reason: 'Set the sprayer width, flow rate and forward speed first.', appRateLPerHa: 0, totalFlowLMin, lines: emptyLines, totalProductL: 0, waterL: 0, totalSprayL: 0, waterNegative: false };
  }

  const appRateLPerHa = (totalFlowLMin * 600) / (speedKmh * widthM);
  const lineVols = lines.map((l) => ({ name: l.name, lPerHa: l.lPerHa, volumeL: (l.lPerHa || 0) * areaHa }));
  const totalProductL = lineVols.reduce((a, l) => a + l.volumeL, 0);
  const totalSprayL = appRateLPerHa * areaHa;
  const waterL = totalSprayL - totalProductL;

  return {
    ok: true,
    appRateLPerHa,
    totalFlowLMin,
    lines: lineVols,
    totalProductL,
    waterL: Math.max(0, waterL),
    totalSprayL,
    waterNegative: waterL < 0,
  };
}
