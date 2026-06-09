import { SprayProduct, SprayPurchase, SprayRecord, Settings } from './types';

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
  records: Pick<SprayRecord, 'spray_product_id' | 'product_litres' | 'products'>[],
): Map<string, SprayStock> {
  const m = new Map<string, SprayStock>();
  for (const p of products) m.set(p.id, { purchasedL: 0, usedL: 0, stockL: 0 });
  for (const pur of purchases) {
    const s = m.get(pur.product_id);
    if (s) s.purchasedL += pur.litres || 0;
  }
  for (const r of records) {
    // Prefer the per-product mix array; fall back to the single columns for
    // older records. Never count both, so stock can't double up.
    if (Array.isArray(r.products) && r.products.length > 0) {
      for (const it of r.products) {
        if (!it?.spray_product_id) continue;
        const s = m.get(it.spray_product_id);
        if (s) s.usedL += Number(it.litres) || 0;
      }
    } else if (r.spray_product_id) {
      const s = m.get(r.spray_product_id);
      if (s) s.usedL += r.product_litres || 0;
    }
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
  totalFlowLMin: number | null;
  speedKmh: number | null;
  lines: SprayLine[];
}): SprayCalcResult {
  const { areaHa, widthM, speedKmh, lines } = args;
  const totalFlowLMin = args.totalFlowLMin ?? 0;
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


/** Resolve sprayer settings to the shape the calculator needs, deriving total
 *  boom flow from legacy per-nozzle × count data if that's all that's saved. */
export function readSprayerSettings(settings: Settings): {
  widthM: number | null;
  totalFlowLMin: number | null;
  defaultSpeedKmh: number | null;
  tankLitres: number | null;
} {
  const sp = settings.sprayer;
  const total =
    sp?.totalFlowLMin ??
    (sp?.nozzleFlowLMin != null && sp?.nozzleCount != null ? sp.nozzleFlowLMin * sp.nozzleCount : null);
  return {
    widthM: sp?.widthM ?? null,
    totalFlowLMin: total ?? null,
    defaultSpeedKmh: sp?.defaultSpeedKmh ?? null,
    tankLitres: sp?.tankLitres ?? null,
  };
}

// ---- Load split ---------------------------------------------------------
// Slice the whole-field total into actual tank loads. All full loads are
// identical, so they're grouped with a count; any remainder is one part load.
// Per load of V litres: area = V / appRate; each product = its L/ha × that
// area; water = V − products. These sum exactly back to the field totals.

export interface SprayLoadLine { name: string; lPerHa: number; volumeL: number; }
export interface SprayLoad {
  count: number;
  volumeL: number;
  areaHa: number;
  lines: SprayLoadLine[];
  productL: number;
  waterL: number;
  waterNegative: boolean;
}
export interface SprayLoadSplit {
  ok: boolean;
  reason?: string;
  tankL: number;
  totalLoads: number;
  loads: SprayLoad[];
}

export function computeLoadSplit(args: {
  appRateLPerHa: number;
  totalSprayL: number;
  tankL: number | null;
  lines: SprayLine[];
}): SprayLoadSplit {
  const { appRateLPerHa, totalSprayL, tankL, lines } = args;
  if (!(tankL && tankL > 0)) {
    return { ok: false, reason: 'Set your sprayer tank size to split the field into loads.', tankL: tankL ?? 0, totalLoads: 0, loads: [] };
  }
  if (!(appRateLPerHa > 0) || !(totalSprayL > 0)) {
    return { ok: false, reason: 'Work out the mix first.', tankL, totalLoads: 0, loads: [] };
  }

  const breakdown = (V: number, count: number): SprayLoad => {
    const areaHa = V / appRateLPerHa;
    const ls = lines.map((l) => ({ name: l.name, lPerHa: l.lPerHa, volumeL: (l.lPerHa || 0) * areaHa }));
    const productL = ls.reduce((a, x) => a + x.volumeL, 0);
    const waterRaw = V - productL;
    return { count, volumeL: V, areaHa, lines: ls, productL, waterL: Math.max(0, waterRaw), waterNegative: waterRaw < 0 };
  };

  const nFull = Math.floor((totalSprayL + 1e-9) / tankL);
  const remainder = totalSprayL - nFull * tankL;
  const loads: SprayLoad[] = [];
  if (nFull > 0) loads.push(breakdown(tankL, nFull));
  if (remainder > 1e-6) loads.push(breakdown(remainder, 1));
  return { ok: true, tankL, totalLoads: nFull + (remainder > 1e-6 ? 1 : 0), loads };
}
