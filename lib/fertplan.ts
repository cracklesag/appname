import { Application, Cut, Field, Product, Settings, RateUnit, GrassSystem } from './types';
import {
  getSeasonStart, sumNutrients, getFieldPKRecommendation, displayFieldArea,
  getFieldNRecommendation, organicReleaseFraction, monthsBetween,
  calcNutrients, planFieldFertiliser, resolveGrassSystem,
} from './rules';
import { meteredApps, fieldAreaHa } from './partials';

export interface FertPlanRow {
  id: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  areaValue: number;
  areaUnit: 'ac' | 'ha';
  ha: number;
  sampled: boolean;
  ph: number | null;
  pIdx: number | null;
  kIdx: number | null;
  pBand: number;
  kBandLabel: string;
  cutType: string;
  cutNumber: number;
  p2o5ToApply: number;
  k2oToApply: number;
  nToApply: number;
  carryP: number;
  carryK: number;
  loggedOrganicP: number;
  loggedOrganicN: number;
  loggedOrganicK: number;
  loggedGranularP: number;
  loggedGranularK: number;
  nNeed: number;
  pNeed: number;
  kNeed: number;
  appliedN: number;
  appliedP: number;
  appliedK: number;
}

/**
 * Build the per-field fert-plan rows from raw data. Shared between the
 * fertiliser plan page and the spread-list pages so the maths is identical.
 */
export function buildFertPlanRows(
  fields: Field[],
  applications: Application[],
  cuts: Cut[],
  products: Product[],
  settings: Settings,
  groups: { id: string; name: string }[],
  grassSystems: GrassSystem[] = [],
): FertPlanRow[] {
  const seasonStart = getSeasonStart();
  const todayIso = new Date().toISOString().slice(0, 10);
  const productTypeById = new Map(products.map((p) => [p.id, p.type]));
  const releaseParams = {
    releaseSlurryStartPct: settings.reportDefaults.releaseSlurryStartPct,
    releaseSlurryPerMonthPct: settings.reportDefaults.releaseSlurryPerMonthPct,
    releaseFymStartPct: settings.reportDefaults.releaseFymStartPct,
    releaseFymPerMonthPct: settings.reportDefaults.releaseFymPerMonthPct,
    releaseFymCapPct: settings.reportDefaults.releaseFymCapPct,
  };

  return fields
    .filter((f) => !f.needs_setup)
    .map((f) => {
      const fieldCuts = cuts.filter((c) => c.field_id === f.id);
      const seasonCuts = fieldCuts
        .filter((c) => c.cut_date >= seasonStart)
        .sort((a, b) => b.cut_date.localeCompare(a.cut_date));
      const lastCut = seasonCuts[0];
      const cutNumber = Math.min((f.cut_profile || 1), seasonCuts.length + 1);

      const seasonApps = meteredApps(applications.filter(
        (a) => a.field_id === f.id && a.date_applied >= seasonStart,
      ), () => fieldAreaHa(f));
      const nWindowStart = lastCut ? lastCut.cut_date : seasonStart;
      const sinceCutApps = seasonApps.filter((a) => a.date_applied >= nWindowStart);
      const appliedNSinceCut = sumNutrients(sinceCutApps, products).n;

      const preCutApps = seasonApps.filter((a) => a.date_applied < nWindowStart);
      let carryPRaw = 0, carryKRaw = 0;
      for (const a of preCutApps) {
        const t = (productTypeById.get(a.product_id) ?? 'bag_fert') as 'slurry' | 'solid_manure' | 'bag_fert' | 'lime';
        const frac = organicReleaseFraction(t, monthsBetween(a.date_applied, todayIso), releaseParams);
        const nut = sumNutrients([a], products);
        carryPRaw += nut.p * frac;
        carryKRaw += nut.k * frac;
      }
      // Carryover = pre-window organic, released over time. Crop offtake is
      // deliberately NOT subtracted here: the RB209 per-cut recommendations
      // already account for what each cut removes, so offtake is embedded on the
      // demand side. Subtracting it from supply as well double-counted removal
      // and made the plan over-recommend K (worst after a heavy winter slurry).
      // Supply is simply what's been applied, availability-adjusted.
      const carryP = Math.max(0, carryPRaw);
      const carryK = Math.max(0, carryKRaw);

      const sinceCutOrganic = sinceCutApps.filter((a) => {
        const t = productTypeById.get(a.product_id);
        return t === 'slurry' || t === 'solid_manure';
      });
      const sinceCutGranular = sinceCutApps.filter((a) => productTypeById.get(a.product_id) === 'bag_fert');
      const loggedOrganic = sumNutrients(sinceCutOrganic, products);
      const loggedGranular = sumNutrients(sinceCutGranular, products);

      const rec = getFieldPKRecommendation(f, cutNumber, fieldCuts, settings.agronomy);
      // Season P/K demand = the RB209 recommendation summed over every cut up to
      // and including the one being fed (cuts 1..cutNumber), plus the one-off
      // index-building K. This rolls forward cut to cut: an under-fed cut keeps
      // its demand owing; an over-applied one (e.g. winter slurry) banks against
      // later cuts and shows nothing due until the balance is used up.
      let pGrossNeed = 0, kGrossNeed = 0;
      for (let c = 1; c <= cutNumber; c++) {
        const r = getFieldPKRecommendation(f, c, fieldCuts, settings.agronomy);
        pGrossNeed += r.p2o5;
        kGrossNeed += r.k2o;
      }
      kGrossNeed += rec.extraKAfterCut;

      // Supply = everything applied this season, availability-adjusted: full
      // value since the cut window, released carryover before it. No offtake term.
      const pSupplyBeforePlan = carryP + loggedOrganic.p + loggedGranular.p;
      const kSupplyBeforePlan = carryK + loggedOrganic.k + loggedGranular.k;
      const p2o5ToApply = Math.max(0, Math.round(pGrossNeed - pSupplyBeforePlan));
      const k2oToApply = Math.max(0, Math.round(kGrossNeed - kSupplyBeforePlan));

      const nMult = resolveGrassSystem(f, grassSystems)?.n_target_multiplier ?? 1;
      const nRec = getFieldNRecommendation(f, cutNumber, fieldCuts, settings, nMult);
      const nToApply = Math.max(0, Math.round(nRec.n - appliedNSinceCut));

      const area = displayFieldArea(f, settings.unitSystem);
      const groupName = groups.find((g) => g.id === f.group_id)?.name ?? null;

      return {
        id: f.id,
        name: f.name,
        groupId: f.group_id,
        groupName,
        areaValue: area.value,
        areaUnit: area.unit,
        ha: f.ha || 0,
        sampled: f.sampled,
        ph: f.ph,
        pIdx: f.p_idx,
        kIdx: f.k_idx,
        pBand: rec.pBand,
        kBandLabel: rec.kBand,
        cutType: rec.cutType,
        cutNumber: rec.cutNumber,
        p2o5ToApply,
        k2oToApply,
        nToApply,
        carryP: Math.round(carryP),
        carryK: Math.round(carryK),
        loggedOrganicP: Math.round(loggedOrganic.p),
        loggedOrganicN: Math.round(loggedOrganic.n),
        loggedOrganicK: Math.round(loggedOrganic.k),
        loggedGranularP: Math.round(loggedGranular.p),
        loggedGranularK: Math.round(loggedGranular.k),
        nNeed: Math.round(nRec.n),
        pNeed: Math.round(pGrossNeed),
        kNeed: Math.round(kGrossNeed),
        appliedN: Math.round(appliedNSinceCut),
        appliedP: Math.round(pSupplyBeforePlan),
        appliedK: Math.round(kSupplyBeforePlan),
      };
    });
}

/** Toggle + override state for planning (session-only on the fert plan). */
export interface PlanState {
  /** Default organic product id ('' = none) + rate string applied to all. */
  defaultOrganicId: number | '';
  defaultRate: string;
  /** Per-field overrides: fieldId -> { productId, rate }. */
  overrides: Record<string, { productId: number | ''; rate: string }>;
  /** Bag-fert product ids the user has switched OFF (won't be recommended). */
  excludedProductIds: number[];
  /** Field ids dropped entirely from the spread lists. */
  excludedFieldIds: string[];
  /** Field ids where intended slurry is switched off (granular still plans). */
  slurryOffFieldIds: string[];
  /** Per-field MANUAL granular override: fieldId -> { productId, rate }. When
   *  set, this product+rate replaces the auto granular plan and is NOT capped
   *  by N (a deliberate user choice). */
  granularOverrides?: Record<string, { productId: number | ''; rate: string }>;
}

export interface PlannedField {
  row: FertPlanRow;
  organicId: number | '';
  rateStr: string;
  organicName: string | null;
  organicUnit: RateUnit;
  slurryN: number; slurryP: number; slurryK: number;
  slurryTotal: number;
  pAfter: number; kAfter: number; nAfter: number;
  /** P/K shortfall held back because it's below the minimum spread rate
   *  (after intended slurry). Held nutrient isn't planned as granular. */
  pHeld: boolean; kHeld: boolean;
  planProducts: { productId: number; productName: string; rateKgPerHa: number; totalKg: number }[];
  planNote: string;
  supplyN: number; supplyP: number; supplyK: number;
  nothingGranular: boolean;
  pBands: { carry: number; slurry: number; granular: number; need: number };
  kBands: { carry: number; slurry: number; granular: number; need: number };
  /** N bar source split. No carryover for N (pre-cut N isn't credited forward). */
  nBands: { carry: number; slurry: number; granular: number; need: number };
}

/**
 * Plan a single field given the toggle/override state. Honours product on/off
 * (excluded products never enter the planner), slurry on/off per field, and
 * holds a P/K shortfall that falls below the minimum spread rate AFTER intended
 * slurry is deducted (so slurry covering most of the need doesn't leave a
 * sub-threshold granular dribble).
 */
export function planField(
  row: FertPlanRow,
  state: PlanState,
  organics: Product[],
  granularAll: Product[],
  settings: Pick<Settings, 'slurryUnit' | 'unitSystem'> & {
    minSpreadP2O5KgPerHa: number;
    minSpreadK2OKgPerHa: number;
  },
): PlannedField {
  const slurryUnit = settings.slurryUnit;
  const unitSystem = settings.unitSystem;

  const ov = state.overrides[row.id];
  const organicId = ov ? ov.productId : state.defaultOrganicId;
  const rateStr = ov ? ov.rate : state.defaultRate;
  const rate = parseFloat(rateStr);
  const organic = organics.find((o) => o.id === organicId);
  const slurryOff = state.slurryOffFieldIds.includes(row.id);

  const unit: RateUnit = organic?.type === 'solid_manure'
    ? (unitSystem === 'acres' ? 't/ac' : 't/ha')
    : slurryUnit;

  // Intended planner slurry (the plan's default organic + rate), expressed as
  // the slurry to apply OVER AND ABOVE what's already been logged since the
  // cut. row.nToApply / p2o5ToApply / k2oToApply already net out logged
  // organic (via appliedNSinceCut / pSupplyBeforePlan). If we then deducted the
  // full intended rate again, a field whose slurry is already logged would have
  // that slurry counted twice and the bag-fert rate would come out ~half size
  // (the Deer Park N-rate bug). Netting against loggedOrganic{N,P,K} fixes it:
  // a field with logged slurry >= intended adds 0 here (no double deduction),
  // while a field with no logged slurry still deducts the full intended rate.
  let slurryN = 0, slurryP = 0, slurryK = 0;
  if (!slurryOff && organic && rate > 0) {
    const n = calcNutrients(organic, rate, unit, new Date().toISOString().slice(0, 10), 'splash_plate');
    slurryN = Math.max(0, Math.round(n.nPerHa)    - row.loggedOrganicN);
    slurryP = Math.max(0, Math.round(n.p2o5PerHa) - row.loggedOrganicP);
    slurryK = Math.max(0, Math.round(n.k2oPerHa)  - row.loggedOrganicK);
  }

  let pAfter = Math.max(0, row.p2o5ToApply - slurryP);
  let kAfter = Math.max(0, row.k2oToApply - slurryK);
  const nAfter = Math.max(0, row.nToApply - slurryN);

  // Manual granular override: the user has fixed a bag-fert product + rate for
  // this field, replacing the auto plan. A manual rate is deliberately NOT
  // capped by N (it's the user's call) — any over-supply just shows on the bars.
  const granOv = state.granularOverrides?.[row.id];
  const granOvProduct = granOv && granOv.productId !== ''
    ? granularAll.find((p) => p.id === granOv.productId)
    : undefined;
  const granOvRate = granOv ? parseFloat(granOv.rate) : NaN;
  const useGranOverride = !!granOvProduct && Number.isFinite(granOvRate) && granOvRate > 0;

  // Minimum-rate hold on the residual the auto granular plan would cover (only
  // when not manually overridden). Below the threshold it's too small to spread
  // accurately — hold it (it stays owed and re-presents on a later cut).
  const minP = settings.minSpreadP2O5KgPerHa;
  const minK = settings.minSpreadK2OKgPerHa;
  const pHeld = !useGranOverride && pAfter > 0 && pAfter < minP;
  const kHeld = !useGranOverride && kAfter > 0 && kAfter < minK;
  if (pHeld) pAfter = 0;
  if (kHeld) kAfter = 0;

  // Apply product on/off: excluded bag products can't be chosen by the planner.
  const granular = granularAll.filter((p) => !state.excludedProductIds.includes(p.id));
  const plan = useGranOverride
    ? {
        products: [{
          productId: granOvProduct!.id,
          productName: granOvProduct!.name,
          rateKgPerHa: Math.round(granOvRate),
          deliversN: Math.round(granOvRate * (granOvProduct!.n_pct ?? 0) / 100),
          deliversP2O5: Math.round(granOvRate * (granOvProduct!.p2o5_pct ?? 0) / 100),
          deliversK2O: Math.round(granOvRate * (granOvProduct!.k2o_pct ?? 0) / 100),
        }],
        nBalance: 0,
        p2o5Balance: 0,
        k2oBalance: 0,
        note: 'Manual rate — set by you.',
      }
    : planFieldFertiliser(pAfter, kAfter, granular, nAfter);

  let granN = 0, granP = 0, granK = 0;
  const planProducts = plan
    ? plan.products.map((pp) => {
        granN += pp.deliversN; granP += pp.deliversP2O5; granK += pp.deliversK2O;
        return {
          productId: pp.productId,
          productName: pp.productName,
          rateKgPerHa: pp.rateKgPerHa,
          totalKg: Math.round(pp.rateKgPerHa * row.ha),
        };
      })
    : [];

  return {
    row,
    organicId,
    rateStr,
    organicName: (!slurryOff && organic) ? organic.name : null,
    organicUnit: unit,
    slurryN, slurryP, slurryK,
    slurryTotal: (!slurryOff && organic && rate > 0) ? Math.round(rate * row.ha) : 0,
    pAfter, kAfter, nAfter,
    pHeld, kHeld,
    planProducts,
    planNote: plan?.note ?? '',
    supplyN: row.appliedN + slurryN + Math.round(granN),
    supplyP: row.appliedP + slurryP + Math.round(granP),
    supplyK: row.appliedK + slurryK + Math.round(granK),
    nothingGranular: planProducts.length === 0,
    pBands: {
      carry: row.carryP,
      slurry: row.loggedOrganicP + slurryP,
      granular: row.loggedGranularP + Math.round(granP),
      need: row.pNeed,
    },
    kBands: {
      carry: row.carryK,
      slurry: row.loggedOrganicK + slurryK,
      granular: row.loggedGranularK + Math.round(granK),
      need: row.kNeed,
    },
    nBands: {
      carry: 0, // N doesn't carry across the cut window
      slurry: row.loggedOrganicN + slurryN,
      granular: Math.max(0, row.appliedN - row.loggedOrganicN) + Math.round(granN),
      need: row.nNeed,
    },
  };
}
