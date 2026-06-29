'use client';

import { useEffect, useMemo, useState } from 'react';
import { Pencil, Map as MapIcon, X } from 'lucide-react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { fmt, nutrientPerArea, nutrientUnitLabel, displayNutrient, nutrientLabel, groupProfileWarnings, todayMd, GroupWarning } from '@/lib/rules';
import { FertPlanRow, PlanState, planField } from '@/lib/fertplan';
import { createJobsFromPlan } from '@/lib/actions';
import { SoilHeatBar } from '@/components/SoilHeatBar';
import { Product, RateUnit, Group } from '@/lib/types';
import { FilterChips } from '@/components/FilterChips';
import { TopicMap } from '@/components/TopicMap';
import type { ColourField } from '@/lib/map-colours';

export type { FertPlanRow };

// Colours for the three supply sources (match the agreed mockup).
const SRC = { carry: '#B3AC9D', slurry: '#6F9A63', granular: '#3C7DD0', over: '#C0392B' };
// Two-tone status palette: covered (soil + slurry) vs still-to-apply (granular).
const CLR = { covered: '#6F9A63', need: '#3C7DD0', over: '#C0392B' };

/**
 * Stacked source bar (Style A): one nutrient, filled left-to-right with
 * carryover -> slurry -> granular, scaled so the RB209 need sits at a fixed
 * point and a marker line shows it. Anything past need shows red (over).
 * showFigures reveals the per-source kg breakdown beneath.
 */
const SEV_RANK: Record<'now' | 'soon' | 'wait', number> = { now: 0, soon: 1, wait: 2 };
const SEV_META: Record<'now' | 'soon' | 'wait', { label: string; bg: string; fg: string }> = {
  now:  { label: 'Do now',   bg: '#F7C1C1', fg: '#791F1F' },
  soon: { label: 'Soon',     bg: '#FAC775', fg: '#633806' },
  wait: { label: 'Can wait', bg: '#D3D1C7', fg: '#444441' },
};

function SourceBar({
  label, bands, unit, disp, showFigures,
}: {
  label: string;
  bands: { carry: number; slurry: number; granular: number; need: number };
  unit: string;
  disp: (kgHa: number) => number;
  showFigures: boolean;
}) {
  const supply = bands.carry + bands.slurry + bands.granular;
  const need = bands.need;
  const scaleMax = need > 0 ? need / 0.75 : Math.max(supply, 1);
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100))}%`;
  const needPct = need > 0 ? `${(need / scaleMax) * 100}%` : null;
  const over = Math.max(0, supply - need);

  return (
    <div style={{ marginBottom: showFigures ? 12 : 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{label}</span>
        <span style={{ fontSize: 11, color: over > 0.5 ? SRC.over : 'var(--muted)' }}>
          {disp(supply)}{need > 0 ? ` / ${disp(need)}` : ''} {unit}
        </span>
      </div>
      <div style={{ position: 'relative', height: 14, background: 'var(--line-soft, #e8e4da)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          {bands.carry > 0 && <div style={{ width: pct(bands.carry), background: SRC.carry }} />}
          {bands.slurry > 0 && <div style={{ width: pct(bands.slurry), background: SRC.slurry }} />}
          {bands.granular > 0 && <div style={{ width: pct(bands.granular), background: SRC.granular }} />}
        </div>
        {needPct && (
          <div style={{ position: 'absolute', top: -2, bottom: -2, left: needPct, width: 2, background: 'var(--ink, #2c2c2a)' }} />
        )}
      </div>
      {showFigures && (
        <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap', fontSize: 10 }}>
          {bands.carry > 0 && <span style={{ background: '#F1EFE8', color: '#444441', padding: '1px 7px', borderRadius: 10 }}>carryover {disp(bands.carry)}</span>}
          {bands.slurry > 0 && <span style={{ background: '#E1F5EE', color: '#085041', padding: '1px 7px', borderRadius: 10 }}>slurry {disp(bands.slurry)}</span>}
          {bands.granular > 0 && <span style={{ background: '#E6F1FB', color: '#0C447C', padding: '1px 7px', borderRadius: 10 }}>granular {disp(bands.granular)}</span>}
          {over > 0.5 && <span style={{ background: '#FCEBEB', color: '#A32D2D', padding: '1px 7px', borderRadius: 10 }}>over {disp(over)}</span>}
        </div>
      )}
    </div>
  );
}

// Per-nutrient status derived from the supply bands. need == the RB209 target.
type NutBands = { carry: number; slurry: number; granular: number; need: number };
type NutStat = { target: number; covered: number; granular: number; supply: number; over: number; short: number; needsWork: boolean };
function nutStatus(b: NutBands, held = false): NutStat {
  const target = b.need;
  const covered = b.carry + b.slurry;
  const supply = covered + b.granular;
  const over = Math.max(0, supply - target);
  const short = held ? 0 : Math.max(0, target - supply);
  const needsWork = b.granular > 0.5 || over > 0.5 || short > 0.5;
  return { target, covered, granular: b.granular, supply, over, short, needsWork };
}
function fieldNeedsWork(c: { nBands: NutBands; pBands: NutBands; kBands: NutBands; pHeld?: boolean; kHeld?: boolean }): boolean {
  return nutStatus(c.nBands).needsWork || nutStatus(c.pBands, c.pHeld).needsWork || nutStatus(c.kBands, c.kHeld).needsWork;
}

/**
 * Two-tone status bar for the collapsed view: green = already covered
 * (soil + slurry), blue = still to apply (granular), red = past target.
 * The mark sits at the RB209 target; the end label is the short/over gap.
 */
function StatusBar({
  label, st, unit, disp,
}: {
  label: string;
  st: NutStat;
  unit: string;
  disp: (kgHa: number) => number;
}) {
  const { target, covered, granular, supply, over, short } = st;
  const greenW = Math.min(covered, target);
  const blueW = Math.max(0, Math.min(supply, target) - covered);
  const scaleMax = Math.max(target * 1.12, supply, 1);
  const pct = (v: number) => `${Math.max(0, (v / scaleMax) * 100)}%`;
  const markerLeft = `${(target / scaleMax) * 100}%`;
  const end = over > 0.5 ? `+${disp(over)}` : short > 0.5 ? `−${disp(short)}` : '✓';
  const endColor = over > 0.5 ? CLR.over : short > 0.5 ? CLR.need : CLR.covered;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', width: 34, flexShrink: 0 }}>{label}</span>
      <div style={{ position: 'relative', flex: 1, height: 12, background: 'var(--line-soft, #e8e4da)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          {greenW > 0 && <div style={{ width: pct(greenW), background: CLR.covered }} />}
          {blueW > 0 && <div style={{ width: pct(blueW), background: CLR.need }} />}
          {over > 0.5 && <div style={{ width: pct(over), background: CLR.over }} />}
        </div>
        <div style={{ position: 'absolute', top: -2, bottom: -2, left: markerLeft, width: 2, background: 'var(--ink, #2c2c2a)', zIndex: 3 }} />
      </div>
      <span style={{ fontSize: 10.5, width: 38, textAlign: 'right', flexShrink: 0, color: endColor, fontWeight: 700 }}>{end} {over > 0.5 || short > 0.5 ? unit.replace('units/', '') : ''}</span>
    </div>
  );
}

/**
 * Compact proof bar for the review: green = covered (soil + slurry), blue =
 * granular, capped at the RB209 target. Tick when it lands, – short, ! over.
 */
function ProofChip({ label, st }: { label: string; st: NutStat }) {
  const { target, covered, supply, over, short } = st;
  const greenW = target > 0 ? (Math.min(covered, target) / target) * 100 : 0;
  const blueW = target > 0 ? (Math.max(0, Math.min(supply, target) - covered) / target) * 100 : 0;
  const color = over > 0.5 ? CLR.over : short > 0.5 ? CLR.need : CLR.covered;
  const mark = over > 0.5 ? '!' : short > 0.5 ? '\u2013' : '\u2713';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color }}>
      <span style={{ width: 42, height: 7, borderRadius: 4, background: 'var(--line-soft, #e7e2d6)', position: 'relative', overflow: 'hidden' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(100, greenW)}%`, background: CLR.covered }} />
        <span style={{ position: 'absolute', left: `${Math.min(100, greenW)}%`, top: 0, bottom: 0, width: `${Math.min(Math.max(0, 100 - greenW), blueW)}%`, background: CLR.need }} />
      </span>
      {label} {mark}
    </span>
  );
}

// Soil targets for the heat bars — RB209 index 2 / pH 6.0 for grassland.
const SOIL_TARGET = { ph: 6.0, pIdx: 2, kIdx: 2 };

export function PlanShell({
  rows, groups, initialGroup, unitSystem, bagFertUnit, products, slurryUnit,
  minSpreadP2O5KgPerHa, minSpreadK2OKgPerHa,
  typeOptions, agreementOptions, typeValue, agreementValue, topicFields,
}: {
  rows: FertPlanRow[];
  groups: Group[];
  initialGroup: string;
  unitSystem: 'acres' | 'hectares';
  bagFertUnit: 'kg/ha' | 'kg/ac' | 'lb/ac' | 'units/ac';
  products: Product[];
  slurryUnit: 'gal/ac' | 'm3/ha';
  minSpreadP2O5KgPerHa: number;
  minSpreadK2OKgPerHa: number;
  typeOptions: { value: string; label: string }[];
  agreementOptions: { value: string; label: string }[];
  typeValue: string;
  agreementValue: string;
  topicFields: ColourField[];
}) {
  // groupFilter / view / sortMode are derived from the URL (see below) so they
  // survive a round-trip to a field and back.

  // Display unit for nutrient & rate figures (the planner works internally in
  // kg/ha; we convert only for display so acres users see per-acre numbers).
  const sys = unitSystem === 'acres' ? 'acres' : 'hectares';
  // Product RATES (granular kg of product per area) stay in kg by the area
  // system — you spread product by weight, not by nutrient unit.
  const rateUnit = nutrientUnitLabel(unitSystem);
  const dispRate = (kgHa: number) => Math.round(nutrientPerArea(kgHa, sys));
  // NUTRIENT figures (N/P/K supply, need, slurry/granular/carryover bands)
  // follow the fertiliser unit setting — units/ac, kg/ac, lb/ac or kg/ha.
  const nUnit = nutrientLabel(bagFertUnit);
  const disp = (kgHa: number) => Math.round(displayNutrient(kgHa, bagFertUnit).value);

  // Organic sources the user can plan to apply first (slurry / solid / digestate).
  const organics = useMemo(
    () => products.filter((p) => p.type === 'slurry' || p.type === 'solid_manure'),
    [products],
  );
  const granular = useMemo(
    () => products.filter((p) => p.type === 'bag_fert'),
    [products],
  );

  // Planning state: a default organic + default rate applied to all fields,
  // with per-field overrides. Empty = no organic planned.
  // Plan toggles + overrides. These are PERSISTED to localStorage so they're
  // maintained when you come back to the plan (and carried to the spread lists).
  const [defaultOrganicId, setDefaultOrganicId] = useState<number | ''>(
    organics.length > 0 ? organics[0].id : '',
  );
  const [defaultRate, setDefaultRate] = useState<string>('');
  // Per-field overrides: fieldId -> { productId, rate } (rate as string).
  const [overrides, setOverrides] = useState<Record<string, { productId: number | ''; rate: string }>>({});
  const [granularPlans, setGranularPlans] = useState<Record<string, { productId: number | ''; rate: string }[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const reviewMode = step === 3;
  const [reviewEditIds, setReviewEditIds] = useState<Set<string>>(new Set());
  const [manureView, setManureView] = useState<'avail' | 'total'>('avail');

  // bag products switched off (never recommended), fields dropped from the
  // spread lists, and fields where intended slurry is switched off.
  const [excludedProductIds, setExcludedProductIds] = useState<number[]>([]);
  const [excludedFieldIds, setExcludedFieldIds] = useState<string[]>([]);
  const [slurryOffFieldIds, setSlurryOffFieldIds] = useState<string[]>([]);
  // Which field's slurry rate is being edited inline (null = none).
  const [editingSlurry, setEditingSlurry] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [hideMet, setHideMet] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Filters live in the URL so a round-trip to a field and back restores them
  // (the field link carries the full Plan URL as its `from`). Planning edits
  // (default product, rate, overrides, exclusions) persist via localStorage.
  const groupFilter = params.get('group') ?? initialGroup ?? 'all';
  const sortMode: 'order' | 'urgency' = params.get('sort') === 'urgency' ? 'urgency' : 'order';
  const writeUrl = (next: { group?: string; sort?: 'order' | 'urgency' }) => {
    const sp = new URLSearchParams(params.toString());
    if (next.group !== undefined) { if (next.group === 'all') sp.delete('group'); else sp.set('group', next.group); }
    if (next.sort !== undefined) { if (next.sort === 'order') sp.delete('sort'); else sp.set('sort', next.sort); }
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const planHref = (() => { const qs = params.toString(); return qs ? `${pathname}?${qs}` : pathname; })();

  const STORE_KEY = 'swardly_plan_state';

  // Load saved toggles/overrides once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.defaultOrganicId !== undefined) setDefaultOrganicId(s.defaultOrganicId);
        if (typeof s.defaultRate === 'string') setDefaultRate(s.defaultRate);
        if (s.overrides) setOverrides(s.overrides);
        if (Array.isArray(s.excludedProductIds)) setExcludedProductIds(s.excludedProductIds);
        if (Array.isArray(s.excludedFieldIds)) setExcludedFieldIds(s.excludedFieldIds);
        if (Array.isArray(s.slurryOffFieldIds)) setSlurryOffFieldIds(s.slurryOffFieldIds);
        if (s.granularPlans) setGranularPlans(s.granularPlans);
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  const toggleIn = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const planState: PlanState = useMemo(() => ({
    defaultOrganicId, defaultRate, overrides, granularPlans,
    excludedProductIds, excludedFieldIds, slurryOffFieldIds,
  }), [defaultOrganicId, defaultRate, overrides, granularPlans, excludedProductIds, excludedFieldIds, slurryOffFieldIds]);

  // Persist whenever the plan state changes (after the initial hydrate).
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(planState)); } catch { /* ignore */ }
  }, [planState, hydrated]);

  const organicRateUnit: RateUnit = useMemo(() => {
    // Slurry uses the farm's slurry unit; solid manure uses t/ha or t/ac.
    const def = organics.find((o) => o.id === defaultOrganicId);
    if (def?.type === 'solid_manure') return unitSystem === 'acres' ? 't/ac' : 't/ha';
    return slurryUnit;
  }, [organics, defaultOrganicId, slurryUnit, unitSystem]);

  const visible = useMemo(() => {
    let list = rows;
    if (groupFilter !== 'all') {
      list = groupFilter === 'ungrouped'
        ? rows.filter((r) => !r.groupId)
        : rows.filter((r) => r.groupId === groupFilter);
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, groupFilter]);

  // Per-field plan via the shared planner (honours product on/off + slurry off
  // + the minimum-rate hold on the post-slurry residual).
  const computed = useMemo(
    () => visible.map((row) => planField(row, planState, organics, granular, {
      slurryUnit, unitSystem, minSpreadP2O5KgPerHa, minSpreadK2OKgPerHa,
    })),
    [visible, planState, organics, granular, slurryUnit, unitSystem, minSpreadP2O5KgPerHa, minSpreadK2OKgPerHa],
  );

  // Tag each planned field with an urgency, and (in urgency mode) sort by it.
  // Severity is derived from the corrected plan: a field with a real shortfall
  // the planner wants to cover now is "Do now"; sub-threshold residuals held
  // back are "Soon"; a field at target with nothing to apply is "Can wait".
  const ordered = useMemo(() => {
    const arr = computed.map((c) => {
      const r = c.row;
      const planned = c.planProducts.length > 0 || (!!c.organicName && c.slurryTotal > 0);
      const owes = r.nToApply > 0 || r.p2o5ToApply > 0 || r.k2oToApply > 0;
      let sev: 'now' | 'soon' | 'wait';
      if (!planned && !owes) sev = 'wait';
      else if (!planned && (c.pHeld || c.kHeld)) sev = 'soon';
      else if (((r.cutType === 'silage' || r.cutType === 'bales') && r.nToApply > 0)
        || r.k2oToApply > 0 || r.p2o5ToApply > 0) sev = 'now';
      else sev = 'soon';
      return { c, sev };
    });
    if (sortMode === 'urgency') {
      arr.sort((a, b) => (SEV_RANK[a.sev] - SEV_RANK[b.sev]) || a.c.row.name.localeCompare(b.c.row.name));
    }
    return arr;
  }, [computed, sortMode]);

  const onCount = useMemo(() => rows.filter((r) => !excludedFieldIds.includes(r.id)).length, [rows, excludedFieldIds]);
  const orderedShown = reviewMode ? ordered.filter(({ c }) => !excludedFieldIds.includes(c.row.id)) : ordered;
  const cardsToShow = (hideMet && !reviewMode) ? orderedShown.filter(({ c }) => fieldNeedsWork(c)) : orderedShown;
  const hiddenMet = orderedShown.length - cardsToShow.length;
  // Review -> job sheets: one line item per field per granular fert; grouped by
  // product + rate server-side. Slurry stays out (logged as spread).
  const jobLineItems = useMemo(
    () => orderedShown.flatMap(({ c }) => c.planProducts.map((pp) => ({ field_id: c.row.id, product_id: pp.productId, rate_kg_ha: pp.rateKgPerHa }))),
    [orderedShown],
  );
  const jobGroupCount = useMemo(() => new Set(jobLineItems.map((i) => i.product_id)).size, [jobLineItems]);
  const jobFieldCount = useMemo(() => new Set(jobLineItems.map((i) => i.field_id)).size, [jobLineItems]);
  const jobSheetSummary = useMemo(() => {
    const m = new Map<string, { kg: number; fields: Set<string> }>();
    for (const { c } of orderedShown) {
      for (const p of c.planProducts) {
        const e = m.get(p.productName) ?? { kg: 0, fields: new Set<string>() };
        e.kg += p.totalKg; e.fields.add(c.row.id); m.set(p.productName, e);
      }
    }
    return [...m.entries()].map(([name, e]) => ({ name, kg: e.kg, fields: e.fields.size })).sort((a, b) => b.kg - a.kg);
  }, [orderedShown]);
  const organicLineItems = useMemo(
    () => orderedShown.flatMap(({ c }) =>
      c.organicId !== '' && c.slurryTotal > 0 && (parseFloat(c.rateStr) || 0) > 0
        ? [{ field_id: c.row.id, product_id: Number(c.organicId), rate_value: parseFloat(c.rateStr), rate_unit: c.organicUnit }]
        : []),
    [orderedShown],
  );

  // Group profiles, for soft warnings (too-early / over-cap / NVZ). A field
  // reads its current group's profile live, so moving a field between groups
  // changes which warnings apply with nothing copied.
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const today = useMemo(() => todayMd(), []);

  // Total planned N (kg/ha) for a planned field — granular N plus slurry N if
  // the row carries it — used to check a low-input cap.
  const warningsFor = (c: typeof computed[number]): GroupWarning[] => {
    const grp = c.row.groupId ? groupById.get(c.row.groupId) : null;
    if (!grp) return [];
    let nKgPerHa = 0;
    for (const p of c.planProducts) {
      const prod = granular.find((x) => x.id === p.productId);
      if (prod && prod.n_pct) nKgPerHa += (p.rateKgPerHa * prod.n_pct) / 100;
    }
    return groupProfileWarnings(grp, { dateMd: today, nKgPerHa });
  };

  /** Save the current toggles/overrides and open a spread list, carrying the
   *  current group filter so the report contains only the block in view. */
  const openSpreadList = (mode: 'granular' | 'slurry') => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(planState)); } catch { /* ignore */ }
    const groupParam = groupFilter && groupFilter !== 'all' ? `&group=${encodeURIComponent(groupFilter)}` : '';
    router.push(`/reports/spread-list?mode=${mode}${groupParam}&from=${encodeURIComponent(planHref)}`);
  };

  /** Open the boundary map sheet for a mode, carrying the same toggles + group. */
  const openSpreadMap = (mode: 'granular' | 'slurry') => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(planState)); } catch { /* ignore */ }
    const groupParam = groupFilter && groupFilter !== 'all' ? `&group=${encodeURIComponent(groupFilter)}` : '';
    router.push(`/reports/spread-map?mode=${mode}${groupParam}&from=${encodeURIComponent(planHref)}`);
  };

  // Order totals: granular products + planned organic volume.
  const productTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of computed) {
      if (excludedFieldIds.includes(c.row.id)) continue;
      for (const p of c.planProducts) {
        totals.set(p.productName, (totals.get(p.productName) ?? 0) + p.totalKg);
      }
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [computed, excludedFieldIds]);

  const organicTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of computed) {
      if (excludedFieldIds.includes(c.row.id)) continue;
      if (c.organicName && c.slurryTotal > 0) {
        totals.set(`${c.organicName}|${c.organicUnit}`, (totals.get(`${c.organicName}|${c.organicUnit}`) ?? 0) + c.slurryTotal);
      }
    }
    return [...totals.entries()];
  }, [computed, excludedFieldIds]);

  // Manure volumes/tonnes across the selected fields (uses each field's
  // effective rate, so per-field overrides are included).
  const manureSummary = useMemo(() => {
    const m = new Map<string, { name: string; unit: string; volume: number; fields: number }>();
    for (const c of computed) {
      if (excludedFieldIds.includes(c.row.id)) continue;
      if (c.organicName && c.slurryTotal > 0) {
        const key = `${c.organicName}|${c.organicUnit}`;
        const e = m.get(key) ?? { name: c.organicName, unit: c.organicUnit.replace(/\/(ac|ha)$/, ''), volume: 0, fields: 0 };
        e.volume += c.slurryTotal; e.fields += 1; m.set(key, e);
      }
    }
    return [...m.values()].sort((a, b) => b.volume - a.volume);
  }, [computed, excludedFieldIds]);

  const totalSheetCount = jobGroupCount + manureSummary.length;

  const anyUngrouped = rows.some((r) => !r.groupId);
  const chips = [
    { v: 'all', label: 'All' },
    ...groups.map((g) => ({ v: g.id, label: g.name })),
    ...(anyUngrouped ? [{ v: 'ungrouped', label: 'Ungrouped' }] : []),
  ];

  const setOverride = (id: string, patch: Partial<{ productId: number | ''; rate: string }>) => {
    setOverrides((prev) => {
      const cur = prev[id] ?? { productId: defaultOrganicId, rate: defaultRate };
      return { ...prev, [id]: { ...cur, ...patch } };
    });
  };
  const clearOverride = (id: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const seedGranularPlan = (id: string, products: { productId: number; rateKgPerHa: number }[]) => {
    setGranularPlans((prev) => ({
      ...prev,
      [id]: products.length
        ? products.map((pp) => ({ productId: pp.productId as number | '', rate: String(pp.rateKgPerHa) }))
        : [{ productId: '', rate: '' }],
    }));
  };
  const setGranularPlanEntry = (id: string, index: number, patch: Partial<{ productId: number | ''; rate: string }>) => {
    setGranularPlans((prev) => {
      const list = (prev[id] ?? []).slice();
      list[index] = { ...list[index], ...patch };
      return { ...prev, [id]: list };
    });
  };
  const addGranularFert = (id: string) => {
    setGranularPlans((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), { productId: '', rate: '' }] }));
  };
  const removeGranularFert = (id: string, index: number) => {
    setGranularPlans((prev) => {
      const list = (prev[id] ?? []).filter((_, i) => i !== index);
      const next = { ...prev };
      if (list.length) next[id] = list; else delete next[id];
      return next;
    });
  };
  const clearGranularPlan = (id: string) => {
    setGranularPlans((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  const defOrganic = organics.find((o) => o.id === defaultOrganicId);
  const fertOnCount = granular.length - excludedProductIds.length;
  const typeActive = !!typeValue && typeValue !== 'all';
  const agActive = !!agreementValue && agreementValue !== 'all';
  const activeFilters = (typeActive ? 1 : 0) + (agActive ? 1 : 0);

  return (
    <div style={{ padding: '14px 16px' }}>
      {/* Step rail — Select -> Manures -> Fertiliser */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
        <button type="button" onClick={() => setStep(1)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <span style={{ width: 21, height: 21, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, background: step === 1 ? 'var(--forest)' : 'var(--forest-soft)', color: step === 1 ? '#fff' : 'var(--forest)', flexShrink: 0 }}>{step > 1 ? '✓' : '1'}</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: step === 1 ? 'var(--ink-soft)' : 'var(--muted)' }}>Select</span>
        </button>
        <span style={{ flex: 1, height: 2, background: step > 1 ? 'var(--forest)' : 'var(--line-soft)', borderRadius: 2, minWidth: 8 }} />
        <button type="button" onClick={() => setStep(2)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <span style={{ width: 21, height: 21, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, background: step === 2 ? 'var(--forest)' : step > 2 ? 'var(--forest-soft)' : 'var(--line-soft)', color: step === 2 ? '#fff' : step > 2 ? 'var(--forest)' : 'var(--muted)', flexShrink: 0 }}>{step > 2 ? '✓' : '2'}</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: step === 2 ? 'var(--ink-soft)' : 'var(--muted)' }}>Manures</span>
        </button>
        <span style={{ flex: 1, height: 2, background: step > 2 ? 'var(--forest)' : 'var(--line-soft)', borderRadius: 2, minWidth: 8 }} />
        <button type="button" onClick={() => setStep(3)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <span style={{ width: 21, height: 21, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, background: step === 3 ? 'var(--forest)' : 'var(--line-soft)', color: step === 3 ? '#fff' : 'var(--muted)', flexShrink: 0 }}>3</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: step === 3 ? 'var(--ink-soft)' : 'var(--muted)' }}>Fertiliser</span>
        </button>
      </div>

      {reviewMode && (productTotals.length > 0 || organicTotals.length > 0) && (
        <div className="card" style={{ padding: 13, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
            What to order
          </div>
          {organicTotals.map(([key, vol]) => {
            const [name, unit] = key.split('|');
            return (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
                <span style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>{name}</span>
                <span className="nutrient-num" style={{ fontSize: 15, color: 'var(--ink)' }}>
                  {fmt(Math.round(vol))} <span style={{ fontSize: 11, color: 'var(--muted)' }}>{unit.replace('/ac', '').replace('/ha', '')}</span>
                </span>
              </div>
            );
          })}
          {productTotals.map(([name, kg]) => (
            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
              <span style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>{name}</span>
              <span className="nutrient-num" style={{ fontSize: 15, color: 'var(--ink)' }}>
                {fmt(Math.round(kg))} <span style={{ fontSize: 11, color: 'var(--muted)' }}>kg</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}> · {(kg / 1000).toFixed(2)} t</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {step === 3 && granular.length > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>Fertiliser sources in use · {fertOnCount} of {granular.length} on</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {granular.map((pr) => {
              const on = !excludedProductIds.includes(pr.id);
              return (
                <button key={pr.id} type="button" onClick={() => setExcludedProductIds((prev) => toggleIn(prev, pr.id))} style={{ background: on ? 'var(--forest)' : 'var(--card)', color: on ? 'var(--paper)' : 'var(--muted)', border: on ? 'none' : '1px solid var(--line)', borderRadius: 20, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', textDecoration: on ? 'none' : 'line-through' }}>{pr.name}</button>
              );
            })}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 9, lineHeight: 1.45 }}>Switch off anything you&apos;re not spreading this round. <Link href="/products?return=/plan" style={{ color: 'var(--forest)', fontWeight: 600, textDecoration: 'none' }}>Add more</Link></div>
        </div>
      )}

      {step === 3 && organicTotals.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>Manure N shown as</span>
          <div style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
            <button type="button" onClick={() => setManureView('avail')} style={{ fontSize: 11.5, fontWeight: 700, padding: '6px 11px', border: 'none', cursor: 'pointer', background: manureView === 'avail' ? 'var(--forest)' : 'var(--card)', color: manureView === 'avail' ? 'var(--paper)' : 'var(--ink-soft)' }}>To next crop</button>
            <button type="button" onClick={() => setManureView('total')} style={{ fontSize: 11.5, fontWeight: 700, padding: '6px 11px', border: 'none', borderLeft: '1px solid var(--line)', cursor: 'pointer', background: manureView === 'total' ? 'var(--forest)' : 'var(--card)', color: manureView === 'total' ? 'var(--paper)' : 'var(--ink-soft)' }}>Total in muck</button>
          </div>
        </div>
      )}

      {step === 1 && (
      <>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginTop: 0, marginBottom: 14 }}>
        Pick the fields you want to work on this round. You&apos;ll choose manures, then
        fertiliser, on the next steps.
      </p>

      {/* Scope — block chips + land filters (type / agreement) in one place */}
      {(groups.length > 0 || typeOptions.length >= 2 || agreementOptions.length >= 2) && (
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 4, flex: 1, minWidth: 0 }}>
            {chips.map((c) => {
              const active = groupFilter === c.v;
              return (
                <button key={c.v} type="button" onClick={() => writeUrl({ group: c.v })} style={{ flexShrink: 0, background: active ? 'var(--forest)' : 'var(--card)', color: active ? 'var(--paper)' : 'var(--ink-soft)', border: active ? 'none' : '1px solid var(--line)', borderRadius: 20, padding: '6px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>{c.label}</button>
              );
            })}
          </div>
          {(typeOptions.length >= 2 || agreementOptions.length >= 2) && (
            <button type="button" onClick={() => setShowFilters((v) => !v)} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, background: activeFilters > 0 ? 'var(--forest-soft)' : 'var(--card)', color: 'var(--ink-soft)', border: '1px solid var(--line)', borderRadius: 20, padding: '6px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Filters{activeFilters > 0 ? <span style={{ background: 'var(--amber)', color: '#fff', borderRadius: 9, fontSize: 10, padding: '0 5px' }}>{activeFilters}</span> : null}
            </button>
          )}
        </div>
        {showFilters && (typeOptions.length >= 2 || agreementOptions.length >= 2) && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10 }}>
            {typeOptions.length >= 2 && (<><div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>Field type</div><FilterChips paramName="type" ariaLabel="Filter by field type" options={typeOptions} /></>)}
            {agreementOptions.length >= 2 && (<><div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700, color: 'var(--muted)', margin: '4px 0 6px' }}>Agreement</div><FilterChips paramName="agreement" ariaLabel="Filter by agreement" options={agreementOptions} /></>)}
          </div>
        )}
      </div>
      )}

      {/* Soil P & K context map (collapsed by default) */}
      {topicFields.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <TopicMap title="Soil P & K map" modes={['p', 'k']} fields={topicFields} />
        </div>
      )}

      {computed.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>Sort</span>
          {([['order', 'Field'], ['urgency', 'Urgency']] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => writeUrl({ sort: v })}
              style={{
                background: sortMode === v ? 'var(--forest)' : 'var(--card)',
                color: sortMode === v ? 'var(--paper)' : 'var(--ink-soft)',
                border: sortMode === v ? 'none' : '1px solid var(--line)',
                borderRadius: 20, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* P & K source legend */}
      {computed.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10, fontSize: 11 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: CLR.covered }} /><span style={{ color: 'var(--muted)' }}>Covered (soil + slurry)</span></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: CLR.need }} /><span style={{ color: 'var(--muted)' }}>To apply (granular)</span></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: CLR.over }} /><span style={{ color: 'var(--muted)' }}>Over</span></span>
        </div>
      )}

      </>
      )}

      {step === 2 && (
        <>
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginTop: 0, marginBottom: 14 }}>
          Choose the slurry, digestate or FYM to spread and the rate. You can vary it per field on the next step.
        </p>
        {organics.length > 0 ? (
          <div className="card" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>Manure / slurry — all selected fields</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select className="select" value={defaultOrganicId} onChange={(e) => setDefaultOrganicId(e.target.value === '' ? '' : Number(e.target.value))} style={{ flex: 1, minWidth: 0 }}>
                <option value="">None</option>
                {organics.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <input type="number" inputMode="decimal" className="input" placeholder="rate" value={defaultRate} onChange={(e) => setDefaultRate(e.target.value)} style={{ width: 84, textAlign: 'right' }} />
              <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{organicRateUnit}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 7, lineHeight: 1.4 }}>Applied to every selected field. Total volumes and per-field rates come next.</div>
          </div>
        ) : (
          <div className="card" style={{ padding: 14, fontSize: 12.5, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>No slurry or FYM in your products yet — add one to plan manure, or carry on to fertiliser.</div>
        )}
        {manureSummary.length > 0 && (
          <div className="card" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>Total to spread · selected fields</div>
            {manureSummary.map((mn) => (
              <div key={mn.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '4px 0', fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: 'var(--forest-dark)', flex: 1, minWidth: 0 }}>{mn.name}<span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {mn.fields} field{mn.fields === 1 ? '' : 's'}</span></span>
                <span className="nutrient-num" style={{ fontWeight: 700 }}>{fmt(Math.round(mn.volume))} {mn.unit}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="button" onClick={() => setStep(1)} style={{ flex: '0 0 auto', background: 'var(--card)', color: 'var(--ink-soft)', border: '1px solid var(--line)', borderRadius: 10, padding: '13px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>← Back</button>
          <button type="button" onClick={() => setStep(3)} style={{ flex: 1, background: 'var(--forest)', color: 'var(--paper)', border: 'none', borderRadius: 10, padding: '13px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Next: fertiliser →</button>
        </div>
        </>
      )}

      {/* Master select + expand controls. "All off" clears every field (any
          group), so you can switch on just the ones you want to spread. */}
      {step === 1 && computed.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => setExcludedFieldIds([])} style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', background: 'var(--card)', border: '1px solid var(--line)', padding: '6px 11px', borderRadius: 7, cursor: 'pointer' }}>All on</button>
            <button type="button" onClick={() => setExcludedFieldIds(rows.map((r) => r.id))} style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', background: 'var(--card)', border: '1px solid var(--line)', padding: '6px 11px', borderRadius: 7, cursor: 'pointer' }}>All off</button>
            <button type="button" onClick={() => setHideMet((v) => !v)} style={{ fontSize: 12, fontWeight: 700, color: hideMet ? 'var(--paper)' : 'var(--ink-soft)', background: hideMet ? 'var(--forest)' : 'var(--card)', border: `1px solid ${hideMet ? 'var(--forest)' : 'var(--line)'}`, padding: '6px 11px', borderRadius: 7, cursor: 'pointer' }}>{hideMet ? 'Met hidden' : 'Hide met'}</button>
          </div>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>
            {rows.filter((r) => !excludedFieldIds.includes(r.id)).length} on{hideMet && hiddenMet > 0 ? ` · ${hiddenMet} met hidden` : ''}
          </span>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <button type="button" onClick={() => setExpanded(Object.fromEntries(computed.map((c) => [c.row.id, true])))} style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', background: 'var(--card)', border: '1px solid var(--line)', padding: '6px 11px', borderRadius: 7, cursor: 'pointer' }}>Expand all</button>
            <button type="button" onClick={() => setExpanded({})} style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', background: 'var(--card)', border: '1px solid var(--line)', padding: '6px 11px', borderRadius: 7, cursor: 'pointer' }}>Collapse all</button>
          </div>
        </div>
      )}

      {computed.length === 0 && (
        <div className="card" style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          No fields to show.
        </div>
      )}

      {step !== 2 && cardsToShow.map(({ c, sev }) => {
        const row = c.row;
        const isOpen = reviewMode || !!expanded[row.id];
        const hasOverride = !!overrides[row.id];
        const hasManualList = !!granularPlans[row.id]?.length;
        const excluded = excludedFieldIds.includes(row.id);
        const slurryOff = slurryOffFieldIds.includes(row.id);
        const cutLabel = row.cutType === 'grazing' ? 'grazing'
          : row.cutType === 'bales' ? `cut ${row.cutNumber} (bales)`
          : `cut ${row.cutNumber}`;
        // At target = nothing left to plan once slurry + the minimum-rate hold
        // are accounted for, and no slurry being added either.
        const atTarget = c.nothingGranular && c.slurryTotal === 0
          && c.pAfter === 0 && c.kAfter === 0 && row.nToApply === 0
          && !c.pHeld && !c.kHeld;

        if (step === 3) {
          const editing = reviewEditIds.has(row.id);
          const volUnit = c.organicUnit.replace(/\/(ac|ha)$/, '');
          const slurryVol = c.slurryTotal > 0 ? (parseFloat(c.rateStr) || 0) * row.areaValue : 0;
          const proof = [
            { l: 'N', st: nutStatus(c.nBands) },
            { l: 'P', st: nutStatus(c.pBands, c.pHeld) },
            { l: 'K', st: nutStatus(c.kBands, c.kHeld) },
          ];
          return (
            <div key={row.id} className="card" style={{ padding: 13, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{row.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{fmt(row.areaValue, 1)} {row.areaUnit} · {cutLabel}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setReviewEditIds((prev) => { const nx = new Set(prev); if (nx.has(row.id)) nx.delete(row.id); else nx.add(row.id); return nx; })}
                  style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, borderRadius: 7, padding: '6px 11px', cursor: 'pointer', background: editing ? 'var(--forest)' : 'var(--card)', color: editing ? 'var(--paper)' : 'var(--forest-dark)', border: editing ? 'none' : '1px solid var(--line)' }}
                >
                  {editing ? 'Done' : '✎ Edit'}
                </button>
              </div>

              {!editing ? (
                <div style={{ marginTop: 9 }}>
                  {c.planProducts.map((pp, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '3px 0', fontSize: 12.5 }}>
                      <span style={{ fontWeight: 600, color: 'var(--ink)', flex: 1, minWidth: 0 }}>{pp.productName}</span>
                      <span style={{ color: 'var(--muted)' }}>{dispRate(pp.rateKgPerHa)} {rateUnit}</span>
                      <span className="nutrient-num" style={{ minWidth: 58, textAlign: 'right' }}>{fmt(pp.totalKg)} kg</span>
                    </div>
                  ))}
                  {c.slurryTotal > 0 && (
                    <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '3px 0', fontSize: 12.5 }}>
                      <span style={{ fontWeight: 600, color: 'var(--forest-dark)', flex: 1, minWidth: 0 }}>{c.organicName}</span>
                      <span style={{ color: 'var(--muted)' }}>{c.rateStr} {c.organicUnit}</span>
                      <span className="nutrient-num" style={{ minWidth: 58, textAlign: 'right' }}>{fmt(Math.round(slurryVol))} {volUnit}</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', margin: '1px 0 2px', lineHeight: 1.4 }}>
                      {manureView === 'total'
                        ? <>holds N {disp(c.slurryNTotal)} · P {disp(c.slurryP)} · K {disp(c.slurryK)} {nUnit} total{c.slurryNTotal > c.slurryNAvail ? <span style={{ fontStyle: 'italic' }}> · only ~{disp(c.slurryNAvail)} N to this crop, rest releases later</span> : null}</>
                        : <>supplies N {disp(c.slurryNAvail)} · P {disp(c.slurryP)} · K {disp(c.slurryK)} {nUnit} to the next crop</>}
                    </div>
                    </>
                  )}
                  {c.planProducts.length === 0 && c.slurryTotal === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Nothing to apply — at target.</div>
                  )}
                  {(c.planProducts.length > 0 || c.slurryTotal > 0) && (
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 5 }}>Supplies N {disp(c.supplyN)} · P {disp(c.supplyP)} · K {disp(c.supplyK)} {nUnit}</div>
                  )}
                  <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                    {proof.map(({ l, st }) => <ProofChip key={l} label={l} st={st} />)}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 10 }}>
                  {organics.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>Slurry / manure</div>
                      {!slurryOff ? (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <select className="select" value={c.organicId} onChange={(e) => setOverride(row.id, { productId: e.target.value === '' ? '' : Number(e.target.value) })} style={{ flex: 1, minWidth: 0 }}>
                            <option value="">None</option>
                            {organics.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                          </select>
                          <input type="number" inputMode="decimal" className="input" placeholder="rate" value={c.rateStr} onChange={(e) => setOverride(row.id, { rate: e.target.value })} style={{ width: 80, textAlign: 'right' }} />
                          <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{c.organicUnit}</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Slurry off for this field.</div>
                      )}
                      <button type="button" onClick={() => setSlurryOffFieldIds((prev) => toggleIn(prev, row.id))} style={{ marginTop: 7, fontSize: 11.5, fontWeight: 700, color: slurryOff ? 'var(--forest)' : 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{slurryOff ? 'Turn slurry on' : 'Turn slurry off'}</button>
                    </div>
                  )}
                  {granular.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>Granular</div>
                      {!hasManualList ? (
                        <button type="button" onClick={() => seedGranularPlan(row.id, c.planProducts)} style={{ fontSize: 12, fontWeight: 700, cursor: 'pointer', borderRadius: 8, padding: '7px 11px', background: 'var(--card)', color: 'var(--ink-soft)', border: '1px solid var(--line)' }}>Change ferts</button>
                      ) : (
                        <>
                          {(granularPlans[row.id] ?? []).map((entry, i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                              <select className="select" value={entry.productId} onChange={(e) => setGranularPlanEntry(row.id, i, { productId: e.target.value === '' ? '' : Number(e.target.value) })} style={{ flex: 1, minWidth: 0 }}>
                                <option value="">Choose…</option>
                                {granular.map((gp) => <option key={gp.id} value={gp.id}>{gp.name}</option>)}
                              </select>
                              <input type="number" inputMode="decimal" className="input" placeholder="rate" value={entry.rate} onChange={(e) => setGranularPlanEntry(row.id, i, { rate: e.target.value })} style={{ width: 70, textAlign: 'right' }} />
                              <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{nUnit}</span>
                              <button type="button" onClick={() => removeGranularFert(row.id, i)} aria-label="Remove fert" style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 4, display: 'inline-flex' }}><X size={16} /></button>
                            </div>
                          ))}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <button type="button" onClick={() => addGranularFert(row.id)} style={{ fontSize: 12, fontWeight: 700, color: 'var(--forest-dark)', background: 'var(--forest-soft)', border: 'none', borderRadius: 7, padding: '7px 11px', cursor: 'pointer' }}>+ Add fert</button>
                            <button type="button" onClick={() => clearGranularPlan(row.id)} style={{ fontSize: 12, color: 'var(--forest)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}>Reset to auto</button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  <button type="button" onClick={() => setExcludedFieldIds((prev) => toggleIn(prev, row.id))} style={{ fontSize: 12, fontWeight: 700, cursor: 'pointer', borderRadius: 8, padding: '8px 11px', background: 'var(--card)', color: 'var(--ink-soft)', border: '1px solid var(--line)' }}>Take off this round</button>
                </div>
              )}
            </div>
          );
        }

        return (
          <div key={row.id} className="card" style={{ padding: 13, marginBottom: 8, opacity: excluded ? 0.5 : 1 }}>
            <div
              onClick={() => setExpanded((p) => ({ ...p, [row.id]: !p[row.id] }))}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{row.name}</div>
                {isOpen && <span style={{ display: 'inline-block', marginTop: 3, fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: SEV_META[sev].bg, color: SEV_META[sev].fg }}>{SEV_META[sev].label}</span>}
                {isOpen && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                  {fmt(row.areaValue, 1)} {row.areaUnit}
                  {row.groupName && <> · {row.groupName}</>}
                  {' · '}{cutLabel}
                </div>
                )}
              </div>
              {excluded ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setExcludedFieldIds((prev) => toggleIn(prev, row.id)); }}
                  style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: 'var(--muted)', background: 'var(--card)', border: '1px solid var(--line)', padding: '4px 9px', borderRadius: 6, cursor: 'pointer' }}
                >
                  off list · add
                </button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {atTarget && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--forest-dark)', background: 'var(--forest-soft)', padding: '4px 9px', borderRadius: 6 }}>
                      ✓ at target
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setExcludedFieldIds((prev) => toggleIn(prev, row.id)); }}
                    aria-label="Take field off the spread list"
                    title="Take off spread list"
                    style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', background: 'none', border: '1px solid var(--line)', padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }}
                  >
                    on ✓
                  </button>
                </div>
              )}
            </div>

            {/* Group-profile warnings (soft — never change the numbers). */}
            {!excluded && isOpen && (() => {
              const ws = warningsFor(c);
              if (ws.length === 0) return null;
              return (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {ws.map((w, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 6,
                      background: w.severity === 'warn' ? '#FBF1D9' : 'var(--paper-deep, #F4EFE2)',
                      border: `1px solid ${w.severity === 'warn' ? '#E8D08A' : 'var(--line)'}`,
                      borderRadius: 7, padding: '6px 9px',
                    }}>
                      <span style={{ fontSize: 12, lineHeight: 1 }}>{w.severity === 'warn' ? '⚠️' : 'ℹ️'}</span>
                      <span style={{ fontSize: 11, color: w.severity === 'warn' ? '#6B5616' : 'var(--ink-soft)', lineHeight: 1.4 }}>
                        {w.text}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}
            {isOpen && (row.sampled ? (
              <div style={{ marginTop: 9 }}>
                <SoilHeatBar label="pH" value={row.ph} target={SOIL_TARGET.ph} max={7.5} />
                <SoilHeatBar label="P" value={row.pIdx} target={SOIL_TARGET.pIdx} max={4} />
                <SoilHeatBar label="K" value={row.kIdx} target={SOIL_TARGET.kIdx} max={4} />
              </div>
            ) : (
              <div style={{ fontSize: 11, color: '#7A5B12', marginTop: 7 }}>
                No soil sample — plan assumes target index.
              </div>
            ))}

            {/* Planned slurry contribution — with an inline rate editor so you
                can bump the volume up or down per field; bars + granular below
                recalculate live as you type. */}
            {isOpen && c.slurryTotal > 0 && (
              <div style={{ marginTop: 8, background: 'var(--forest-soft)', borderRadius: 6, padding: '7px 9px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--forest-dark)', minWidth: 0 }}>
                    {c.organicName}: {c.rateStr || 0} {c.organicUnit}
                    {c.slurryN === 0 && c.slurryP === 0 && c.slurryK === 0
                      && (c.row.loggedOrganicN > 0 || c.row.loggedOrganicP > 0 || c.row.loggedOrganicK > 0)
                      ? ' · already logged this cut'
                      : <> · ~{disp(c.slurryN)}N · {disp(c.slurryP)}P · {disp(c.slurryK)}K {nUnit}</>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingSlurry((cur) => (cur === row.id ? null : row.id))}
                    aria-label="Edit slurry volume"
                    style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 700, color: 'var(--forest-dark)', cursor: 'pointer' }}
                  >
                    <Pencil size={12} /> {editingSlurry === row.id ? 'Done' : 'Edit'}
                  </button>
                </div>
                {editingSlurry === row.id && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="number"
                      inputMode="decimal"
                      autoFocus
                      className="input"
                      value={c.rateStr}
                      onChange={(e) => setOverride(row.id, { rate: e.target.value })}
                      style={{ width: 100, textAlign: 'right' }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{c.organicUnit}</span>
                    {!!overrides[row.id] && (
                      <button
                        type="button"
                        onClick={() => clearOverride(row.id)}
                        style={{ fontSize: 11, color: 'var(--forest)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, marginLeft: 'auto' }}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Granular plan (expanded only) */}
            {isOpen && (c.planProducts.length > 0 ? (
              <div style={{ marginTop: 9 }}>
                {c.planProducts.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: 'var(--paper-deep, #f3efe4)', borderRadius: 8, padding: '9px 11px',
                      marginBottom: 6,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{p.productName}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmt(p.totalKg)} kg over field</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="nutrient-num" style={{ fontSize: 18, color: 'var(--ink)' }}>{dispRate(p.rateKgPerHa)}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{rateUnit}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : !atTarget ? (
              <div style={{ fontSize: 12, color: 'var(--forest-dark)', marginTop: 9, fontWeight: 600 }}>
                {c.slurryTotal > 0 ? 'Slurry covers it — no granular needed.' : 'No granular needed.'}
              </div>
            ) : null)}

            {/* Need-vs-supply bars. N stays a simple supply bar; P & K show
                the source breakdown (carryover / slurry / granular), with the
                per-source figures revealed when the field is expanded. */}
            {(() => {
              const items = [
                { label: 'N', short: 'N', st: nutStatus(c.nBands) },
                { label: 'P₂O₅', short: 'P', st: nutStatus(c.pBands, c.pHeld) },
                { label: 'K₂O', short: 'K', st: nutStatus(c.kBands, c.kHeld) },
              ];
              const work = items.filter((x) => x.st.needsWork);
              const met = items.filter((x) => !x.st.needsWork).map((x) => x.short);
              if (isOpen) {
                return (
                  <div style={{ marginTop: 9 }}>
                    <SourceBar label="N"    bands={c.nBands} unit={nUnit} disp={disp} showFigures />
                    <SourceBar label="P₂O₅" bands={c.pBands} unit={nUnit} disp={disp} showFigures />
                    <SourceBar label="K₂O"  bands={c.kBands} unit={nUnit} disp={disp} showFigures />
                  </div>
                );
              }
              if (work.length === 0) {
                return atTarget ? null : (
                  <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 700, color: CLR.covered }}>
                    ✓ {c.slurryTotal > 0 ? 'slurry covers it' : 'met'} — no granular
                  </div>
                );
              }
              return (
                <div style={{ marginTop: 9 }}>
                  {work.map((x) => <StatusBar key={x.short} label={x.label} st={x.st} unit={nUnit} disp={disp} />)}
                  {met.length > 0 && (
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: CLR.covered, marginTop: 2 }}>
                      {met.join(' · ')} met ✓
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>Tap for the full breakdown</div>
                </div>
              );
            })()}

            {/* Low-rate hold notice — P or K shortfall too small to spread, so
                it's held in the season balance and will combine with a later
                cut once it's worth applying. */}
            {isOpen && (c.pHeld || c.kHeld) && (
              <div style={{
                marginTop: 8, padding: '7px 10px', borderRadius: 8,
                background: '#F4EFE2', border: '1px solid #E4D9BD',
                fontSize: 11, color: '#6B5D34', lineHeight: 1.45,
              }}>
                {c.pHeld && c.kHeld
                  ? `P and K shortfalls are below your minimum spread rate — held for now and carried forward; they'll show once they build up enough to be worth spreading.`
                  : c.pHeld
                  ? `P₂O₅ shortfall is below your minimum spread rate — too small to spread this cut. It's held and carried forward to combine with a later cut.`
                  : `K₂O shortfall is below your minimum spread rate — too small to spread this cut. It's held and carried forward to combine with a later cut.`}
              </div>
            )}

            {/* Field-level spread toggles (shown when expanded) */}
            {isOpen && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setExcludedFieldIds((prev) => toggleIn(prev, row.id))}
                  style={{
                    fontSize: 12, fontWeight: 700, cursor: 'pointer', borderRadius: 8, padding: '7px 11px',
                    background: excluded ? 'var(--forest)' : 'var(--card)',
                    color: excluded ? 'var(--paper)' : 'var(--ink-soft)',
                    border: excluded ? 'none' : '1px solid var(--line)',
                  }}
                >
                  {excluded ? 'Add back to spread list' : 'Take off spread list'}
                </button>
                {(c.organicName || slurryOff || defaultOrganicId !== '') && (
                  <button
                    type="button"
                    onClick={() => setSlurryOffFieldIds((prev) => toggleIn(prev, row.id))}
                    style={{
                      fontSize: 12, fontWeight: 700, cursor: 'pointer', borderRadius: 8, padding: '7px 11px',
                      background: slurryOff ? 'var(--card)' : SRC.slurry,
                      color: slurryOff ? 'var(--muted)' : '#fff',
                      border: slurryOff ? '1px solid var(--line)' : 'none',
                    }}
                  >
                    {slurryOff ? 'Slurry off — turn on' : 'Slurry on — turn off'}
                  </button>
                )}
              </div>
            )}

            {/* Per-field override (expand) */}
            {isOpen && organics.length > 0 && !slurryOff && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                  Slurry for this field {hasOverride ? '(overriding the default)' : '(using the default)'}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    className="select"
                    value={c.organicId}
                    onChange={(e) => setOverride(row.id, { productId: e.target.value === '' ? '' : Number(e.target.value) })}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <option value="">None</option>
                    {organics.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <input
                    type="number"
                    inputMode="decimal"
                    className="input"
                    placeholder="rate"
                    value={c.rateStr}
                    onChange={(e) => setOverride(row.id, { rate: e.target.value })}
                    style={{ width: 84, textAlign: 'right' }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{c.organicUnit}</span>
                </div>
                {hasOverride && (
                  <button
                    type="button"
                    onClick={() => clearOverride(row.id)}
                    style={{ marginTop: 8, fontSize: 12, color: 'var(--forest)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}
                  >
                    Reset to default
                  </button>
                )}
              </div>
            )}

            {/* Per-field MANUAL granular plan (expand) — any mix of bag products
                (an N compound, a straight MOP/TSP, several, or none). Not N-capped. */}
            {isOpen && granular.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                  Granular for this field {hasManualList ? '(manual — overrides the auto plan)' : '(auto)'}
                </div>
                {!hasManualList ? (
                  <button
                    type="button"
                    onClick={() => seedGranularPlan(row.id, c.planProducts)}
                    style={{ fontSize: 12, fontWeight: 700, cursor: 'pointer', borderRadius: 8, padding: '7px 11px', background: 'var(--card)', color: 'var(--ink-soft)', border: '1px solid var(--line)' }}
                  >
                    Customise ferts
                  </button>
                ) : (
                  <>
                    {(granularPlans[row.id] ?? []).map((entry, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                        <select
                          className="select"
                          value={entry.productId}
                          onChange={(e) => setGranularPlanEntry(row.id, i, { productId: e.target.value === '' ? '' : Number(e.target.value) })}
                          style={{ flex: 1, minWidth: 0 }}
                        >
                          <option value="">Choose…</option>
                          {granular.map((gp) => <option key={gp.id} value={gp.id}>{gp.name}</option>)}
                        </select>
                        <input
                          type="number"
                          inputMode="decimal"
                          className="input"
                          placeholder="rate"
                          value={entry.rate}
                          onChange={(e) => setGranularPlanEntry(row.id, i, { rate: e.target.value })}
                          style={{ width: 72, textAlign: 'right' }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{nUnit}</span>
                        <button
                          type="button"
                          onClick={() => removeGranularFert(row.id, i)}
                          aria-label="Remove fert"
                          style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 4, display: 'inline-flex' }}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
                      <button
                        type="button"
                        onClick={() => addGranularFert(row.id)}
                        style={{ fontSize: 12, fontWeight: 700, color: 'var(--forest-dark)', background: 'var(--forest-soft)', border: 'none', borderRadius: 7, padding: '7px 11px', cursor: 'pointer' }}
                      >
                        + Add fert
                      </button>
                      <button
                        type="button"
                        onClick={() => clearGranularPlan(row.id)}
                        style={{ fontSize: 12, color: 'var(--forest)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}
                      >
                        Reset to auto
                      </button>
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.4 }}>
                      Manual rates aren&apos;t capped by N — over/under-supply just shows on the bars.
                    </div>
                  </>
                )}
              </div>
            )}

            <Link
              href={`/fields/${row.id}?from=${encodeURIComponent(planHref)}`}
              style={{ display: 'inline-block', marginTop: 9, fontSize: 11, color: 'var(--forest)', fontWeight: 700, textDecoration: 'none' }}
            >
              Open field ›
            </Link>
          </div>
        );
      })}

      {reviewMode && orderedShown.length > 0 && (
        <form action={createJobsFromPlan} style={{ marginTop: 14 }}>
          <input type="hidden" name="items" value={JSON.stringify(jobLineItems)} />
          <input type="hidden" name="organicItems" value={JSON.stringify(organicLineItems)} />
          {(jobSheetSummary.length > 0 || manureSummary.length > 0) && (
            <div style={{ background: 'var(--forest-dark)', borderRadius: 12, padding: '13px 14px', marginBottom: 10, color: 'var(--brand-cream, #EFE7D6)' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, opacity: 0.8, marginBottom: 9 }}>
                Creates {totalSheetCount} job sheet{totalSheetCount === 1 ? '' : 's'} — one per product
              </div>
              {jobSheetSummary.map((sh, i) => (
                <div key={sh.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.12)' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{sh.name}</div>
                    <div style={{ fontSize: 10.5, opacity: 0.75 }}>{sh.fields} field{sh.fields === 1 ? '' : 's'}</div>
                  </div>
                  <span className="nutrient-num" style={{ fontSize: 14.5, fontWeight: 600 }}>{fmt(Math.round(sh.kg))} kg<span style={{ fontSize: 10.5, opacity: 0.7 }}> · {(sh.kg / 1000).toFixed(2)} t</span></span>
                </div>
              ))}
              {manureSummary.map((mn, i) => (
                <div key={`m-${mn.name}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderTop: (jobSheetSummary.length === 0 && i === 0) ? 'none' : '1px solid rgba(255,255,255,0.12)' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{mn.name}</div>
                    <div style={{ fontSize: 10.5, opacity: 0.75 }}>{mn.fields} field{mn.fields === 1 ? '' : 's'} · spread sheet</div>
                  </div>
                  <span className="nutrient-num" style={{ fontSize: 14.5, fontWeight: 600 }}>{fmt(Math.round(mn.volume))} {mn.unit}</span>
                </div>
              ))}
            </div>
          )}
          <button
            type="submit"
            disabled={jobLineItems.length === 0 && organicLineItems.length === 0}
            style={{ width: '100%', background: (jobLineItems.length === 0 && organicLineItems.length === 0) ? 'var(--line)' : 'var(--forest)', color: 'var(--paper)', border: 'none', borderRadius: 10, padding: '13px', fontSize: 14, fontWeight: 700, cursor: (jobLineItems.length === 0 && organicLineItems.length === 0) ? 'default' : 'pointer' }}
          >
            Create {totalSheetCount} job sheet{totalSheetCount === 1 ? '' : 's'} →
          </button>
          <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 7, lineHeight: 1.4 }}>
            {jobLineItems.length === 0 && organicLineItems.length === 0
              ? 'Nothing to spread in the selected fields yet.'
              : `One sheet per product — granular and manure — each field's rate on its line.`}
          </div>
        </form>
      )}

      {step === 1 && onCount > 0 && (
        <button type="button" onClick={() => setStep(2)} style={{ width: '100%', marginTop: 14, background: 'var(--forest)', color: 'var(--paper)', border: 'none', borderRadius: 10, padding: '13px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          Next: manures · {onCount} field{onCount === 1 ? '' : 's'} →
        </button>
      )}

      {reviewMode && computed.length > 0 && (
        <>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, marginBottom: 6 }}>
          <button type="button" onClick={() => openSpreadList('granular')} style={{ flex: 1, background: 'var(--card)', color: 'var(--ink-soft)', border: '1px solid var(--line)', borderRadius: 10, padding: '11px 10px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Granular spread list</button>
          <button type="button" onClick={() => openSpreadList('slurry')} style={{ flex: 1, background: 'var(--card)', color: 'var(--ink-soft)', border: '1px solid var(--line)', borderRadius: 10, padding: '11px 10px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Slurry spread list</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button type="button" onClick={() => openSpreadMap('granular')} style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'var(--card)', color: 'var(--ink-soft)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 10px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}><MapIcon size={14} /> Granular map</button>
          <button type="button" onClick={() => openSpreadMap('slurry')} style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'var(--card)', color: 'var(--ink-soft)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 10px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}><MapIcon size={14} /> Slurry map</button>
        </div>
        </>
      )}

      <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginTop: 14 }}>
        Granular plans follow the P &amp; K recommendations in AHDB&apos;s published nutrient guidance, at each field&apos;s
        soil index, after deducting what&apos;s already been applied this season and any slurry you
        plan above. Slurry nutrient values use your product settings and assume splash-plate
        application. The grey <strong>carryover</strong> band is an <em>estimate</em> of P &amp; K
        from earlier applications still becoming available (slurry fast, FYM over months) net of
        crop offtake — it is a model, not a published figure. Always sense-check rates and consult a
        FACTS adviser where needed.
      </p>
    </div>
  );
}
