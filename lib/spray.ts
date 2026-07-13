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


// ---- Reverse calc -------------------------------------------------------
// "I'm putting V litres of one product in the tank, at its set rate." The area
// that covers is V / rate; feed that area back into computeSprayMix to get the
// other products and the water. Returns 0 if either input is missing.
export function areaFromProductVolume(volumeL: number, lPerHa: number): number {
  if (!(lPerHa > 0) || !(volumeL > 0)) return 0;
  return volumeL / lPerHa;
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

// ---- Multi-anchor solver -------------------------------------------------
// One identity, solved from whichever end you know:
//   total mix (L) = (water L/ha + Σ product L/ha) × area (ha)
// Anchors:
//   'area'          — you know the ground (a field or typed area)
//   'productVolume' — you know how much of ONE product is going in ("6 L of X")
//   'tank'          — you're filling one full tank and want what it does
// Water volume is a FIRST-CLASS INPUT (the number operators actually know);
// deriving it from sprayer calibration is an optional helper, never a gate.
// Product volumes and area never require water; water-dependent figures are
// null until a water volume is known.

export type SprayAnchor = 'area' | 'productVolume' | 'tank';

export interface SpraySolveResult {
  ok: boolean;
  reason?: string;
  areaHa: number;
  /** water + Σ product rates; null until a water volume is known. */
  appRateLPerHa: number | null;
  lines: { name: string; lPerHa: number; volumeL: number }[];
  totalProductL: number;
  waterL: number | null;
  totalSprayL: number | null;
}

export function solveSprayMix(args: {
  anchor: SprayAnchor;
  waterLPerHa: number | null;
  lines: SprayLine[];
  areaHa?: number;                                   // anchor 'area'
  pivot?: { lPerHa: number; volumeL: number };       // anchor 'productVolume'
  tankL?: number | null;                             // anchor 'tank'
}): SpraySolveResult {
  const { anchor, lines } = args;
  const water = args.waterLPerHa != null && args.waterLPerHa > 0 ? args.waterLPerHa : null;
  const sumRates = lines.reduce((a, l) => a + (l.lPerHa > 0 ? l.lPerHa : 0), 0);
  const fail = (reason: string): SpraySolveResult => ({
    ok: false, reason, areaHa: 0, appRateLPerHa: null,
    lines: lines.map((l) => ({ name: l.name, lPerHa: l.lPerHa, volumeL: 0 })),
    totalProductL: 0, waterL: null, totalSprayL: null,
  });

  if (lines.length === 0 || sumRates <= 0) {
    return fail('Add at least one spray with its rate (L/ha).');
  }

  // Resolve the area from the chosen anchor.
  let areaHa = 0;
  if (anchor === 'area') {
    areaHa = args.areaHa ?? 0;
    if (!(areaHa > 0)) return fail('Pick a field or enter the area to spray.');
  } else if (anchor === 'productVolume') {
    const p = args.pivot;
    areaHa = p ? areaFromProductVolume(p.volumeL, p.lPerHa) : 0;
    if (!(areaHa > 0)) return fail('Enter how many litres of the chosen spray you\u2019re using.');
  } else {
    // 'tank': a full tank T covers T / (water + Σ rates).
    const tankL = args.tankL ?? 0;
    if (!(tankL > 0)) return fail('Set your tank size (Sprayer settings) to work from a full tank.');
    if (water == null) return fail('Enter your water volume (L/ha) to work out what one tank does.');
    areaHa = tankL / (water + sumRates);
  }

  const lineVols = lines.map((l) => ({ name: l.name, lPerHa: l.lPerHa, volumeL: (l.lPerHa || 0) * areaHa }));
  const totalProductL = lineVols.reduce((a, l) => a + l.volumeL, 0);
  const appRateLPerHa = water != null ? water + sumRates : null;
  const waterL = water != null ? water * areaHa : null;
  const totalSprayL = appRateLPerHa != null ? appRateLPerHa * areaHa : null;

  return { ok: true, areaHa, appRateLPerHa, lines: lineVols, totalProductL, waterL, totalSprayL };
}

/** Optional calibration helper: application volume from the sprayer itself.
 *  L/ha = total output (L/min) × 600 ÷ (speed km/h × width m). At field rates
 *  the product fraction is small, so this is used to prefill the water box. */
export function calibrationLPerHa(totalFlowLMin: number | null, speedKmh: number | null, widthM: number | null): number | null {
  if (!(totalFlowLMin && totalFlowLMin > 0) || !(speedKmh && speedKmh > 0) || !(widthM && widthM > 0)) return null;
  return (totalFlowLMin * 600) / (speedKmh * widthM);
}
