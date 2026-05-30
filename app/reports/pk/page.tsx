import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import {
  loadFields, loadAllApplications, loadAllCuts, loadAllProducts, loadGroups, loadSettings,
} from '@/lib/data';
import {
  getSeasonStart, sumNutrients, getResolvedNextCutType, getPlannedCuts,
  getFieldPKRecommendation, getFieldNRecommendation, displayFieldArea,
  getOfftakeForCut, organicReleaseFraction, monthsBetween,
  nutrientPerArea, nutrientUnitLabel,
} from '@/lib/rules';
import * as rb209 from '@/lib/rb209';
import { PKStatusShell, PKFieldRow } from '@/components/PKStatusShell';

export const dynamic = 'force-dynamic';

export default async function PKStatusPage({
  searchParams,
}: {
  searchParams: { group?: string; from?: string };
}) {
  const [fields, applications, cuts, products, groups, settings] = await Promise.all([
    loadFields(),
    loadAllApplications(),
    loadAllCuts(),
    loadAllProducts(),
    loadGroups(),
    loadSettings(),
  ]);

  const seasonStart = getSeasonStart();
  const groupFilter = searchParams.group || 'all';

  const rows: PKFieldRow[] = fields
    .filter((f) => !f.needs_setup)
    .map((f) => {
      // Applications this season for this field.
      const fieldApps = applications.filter(
        (a) => a.field_id === f.id && a.date_applied >= seasonStart,
      );

      // Which cut number are we at (cuts done this season + 1)?
      const fieldCuts = cuts.filter((c) => c.field_id === f.id);
      const seasonCuts = fieldCuts
        .filter((c) => c.cut_date >= seasonStart)
        .sort((a, b) => b.cut_date.localeCompare(a.cut_date));
      const lastCut = seasonCuts[0];
      const cutNumber = Math.min((f.cut_profile || 1), seasonCuts.length + 1);

      // Nitrogen is per-cut: only count N applied since the last cut (or
      // season start if no cut yet), so an over-applied earlier cut doesn't
      // suppress this cut's N recommendation.
      const nWindowStart = lastCut ? lastCut.cut_date : seasonStart;
      const sinceCutApps = fieldApps.filter((a) => a.date_applied >= nWindowStart);
      const sinceCutTotals = sumNutrients(sinceCutApps, products);
      const appliedNSinceCut = sinceCutTotals.n;

      // P & K carryover: pre-cut applications, released over time by material
      // type, net of crop offtake — same model as the fertiliser plan so the
      // two screens agree and pre-cut slurry isn't counted at full value.
      const todayIso = new Date().toISOString().slice(0, 10);
      const releaseParams = {
        releaseSlurryStartPct: settings.reportDefaults.releaseSlurryStartPct,
        releaseSlurryPerMonthPct: settings.reportDefaults.releaseSlurryPerMonthPct,
        releaseFymStartPct: settings.reportDefaults.releaseFymStartPct,
        releaseFymPerMonthPct: settings.reportDefaults.releaseFymPerMonthPct,
        releaseFymCapPct: settings.reportDefaults.releaseFymCapPct,
      };
      const productTypeById = new Map(products.map((p) => [p.id, p.type]));
      const preCutApps = fieldApps.filter((a) => a.date_applied < nWindowStart);
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

      const rec = getFieldPKRecommendation(f, cutNumber, fieldCuts);
      const nRec = getFieldNRecommendation(f, cutNumber, fieldCuts);

      // Available P/K = carryover + applied since the cut; shortfall is the
      // gross RB209 build-up need less that.
      const availP = carryP + sinceCutTotals.p;
      const availK = carryK + sinceCutTotals.k;
      const p2o5ToApply = Math.max(0, Math.round(rec.p2o5 - availP));
      const k2oToApply = Math.max(0, Math.round((rec.k2o + rec.extraKAfterCut) - availK));

      const area = displayFieldArea(f, settings.unitSystem);
      const groupName = groups.find((g) => g.id === f.group_id)?.name ?? null;

      // Within-band hint: where the decimal index sits, e.g. "K 2- (low in band)".
      const kBandLabel = rec.kBand;

      // Convert every nutrient figure from kg/ha to the user's unit system
      // (acres → kg/ac, hectares → kg/ha). The acres/hectares setting is the
      // master switch for all areal numbers shown.
      const conv = (kgHa: number) => Math.round(nutrientPerArea(kgHa, settings.unitSystem));

      return {
        id: f.id,
        name: f.name,
        groupId: f.group_id,
        groupName,
        areaValue: area.value,
        areaUnit: area.unit,
        sampled: f.sampled,
        pIdx: f.p_idx,
        kIdx: f.k_idx,
        pBand: rec.pBand,
        kBandLabel,
        cutType: rec.cutType,
        cutNumber: rec.cutNumber,
        p2o5ToApply: conv(p2o5ToApply),
        k2oToApply: conv(k2oToApply),
        recN: conv(nRec.n),
        recP2o5: conv(rec.p2o5),
        recK2o: conv(rec.k2o + rec.extraKAfterCut),
        appliedN: conv(appliedNSinceCut),
        appliedP: conv(availP),
        appliedK: conv(availK),
        atMaintenance: rec.atMaintenance,
        kSplit: rec.kSplit
          ? { previousAutumn: conv(rec.kSplit.previousAutumn), spring: conv(rec.kSplit.spring), springCapped: rec.kSplit.springCapped }
          : null,
        extraKAfterCut: conv(rec.extraKAfterCut),
      };
    });

  return (
    <div style={{ paddingBottom: 90 }}>
      <Header title="P & K status" subtitle="RB209 — what to apply" backHref={searchParams.from || '/'} />
      <PKStatusShell rows={rows} groups={groups} initialGroup={groupFilter} unitSystem={settings.unitSystem} />
    </div>
  );
}
