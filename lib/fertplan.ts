import { Application, Cut, Field, Product, Settings, RateUnit } from './types';
import {
  getSeasonStart, sumNutrients, getFieldPKRecommendation, displayFieldArea,
  getFieldNRecommendation, getOfftakeForCut, organicReleaseFraction, monthsBetween,
  calcNutrients, planFieldFertiliser,
} from './rules';

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

      const seasonApps = applications.filter(
        (a) => a.field_id === f.id && a.date_applied >= seasonStart,
      );
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
      let pOff = 0, kOff = 0;
      for (const c of seasonCuts) {
        const o = getOfftakeForCut(f.cut_profile, c.cut_number, c.yield_class, settings, c.cut_type);
        pOff += o.p2o5; kOff += o.k2o;
      }
      const carryP = Math.max(0, carryPRaw - pOff);
      const carryK = Math.max(0, carryKRaw - kOff);

      const sinceCutOrganic = sinceCutApps.filter((a) => {
        const t = productTypeById.get(a.product_id);
        return t === 'slurry' || t === 'solid_manure';
      });
      const sinceCutGranular = sinceCutApps.filter((a) => productTypeById.get(a.product_id) === 'bag_fert');
      const loggedOrganic = sumNutrients(sinceCutOrganic, products);
      const loggedGranular = sumNutrients(sinceCutGranular, products);

      const rec = getFieldPKRecommendation(f, cutNumber, fieldCuts);
      const pGrossNeed = rec.p2o5;
      const kGrossNeed = rec.k2o + rec.extraKAfterCut;

      const pSupplyBeforePlan = carryP + loggedOrganic.p + loggedGranular.p;
      const kSupplyBeforePlan = carryK + loggedOrganic.k + loggedGranular.k;
      // Raw shortfall before intended slurry. The minimum-rate hold is applied
      // later in planField, AFTER intended slurry is deducted — otherwise a
      // field where slurry covers most of the need leaves a sub-threshold
      // granular dribble that the pre-slurry hold would miss.
      const p2o5ToApply = Math.max(0, Math.round(pGrossNeed - pSupplyBeforePlan));
      const k2oToApply = Math.max(0, Math.round(kGrossNeed - kSupplyBeforePlan));

      const nRec = getFieldNRecommendation(f, cutNumber, fieldCuts);
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

  let slurryN = 0, slurryP = 0, slurryK = 0;
  if (!slurryOff && organic && rate > 0) {
    const n = calcNutrients(organic, rate, unit, new Date().toISOString().slice(0, 10), 'splash_plate');
    slurryN = Math.round(n.nPerHa);
    slurryP = Math.round(n.p2o5PerHa);
    slurryK = Math.round(n.k2oPerHa);
  }

  let pAfter = Math.max(0, row.p2o5ToApply - slurryP);
  let kAfter = Math.max(0, row.k2oToApply - slurryK);
  const nAfter = Math.max(0, row.nToApply - slurryN);

  // Minimum-rate hold on the residual the granular plan would actually cover.
  // Below the threshold it's too small to spread accurately — hold it (it
  // stays owed and re-presents on a later cut as carryover depletes).
  const minP = settings.minSpreadP2O5KgPerHa;
  const minK = settings.minSpreadK2OKgPerHa;
  const pHeld = pAfter > 0 && pAfter < minP;
  const kHeld = kAfter > 0 && kAfter < minK;
  if (pHeld) pAfter = 0;
  if (kHeld) kAfter = 0;

  // Apply product on/off: excluded bag products can't be chosen by the planner.
  const granular = granularAll.filter((p) => !state.excludedProductIds.includes(p.id));
  const plan = planFieldFertiliser(pAfter, kAfter, granular, nAfter);

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
  };
}
