import Link from 'next/link';
import { ArrowLeft, Sprout, ChevronRight, BookOpen, AlertTriangle, Settings } from 'lucide-react';
import {
  loadFields, loadCrops, loadCropAllocations, loadAllApplications, loadAllProducts,
  loadSettings, loadGroups, loadAllocationTypes, loadAgreements, loadFieldAgreementMap,
} from '@/lib/data';
import { buildCropPlan, currentCropSeason, cropSeasonWindow, type CropPlan } from '@/lib/cropplan';
import { type LoadedCrop } from '@/lib/crops';
import { FieldCropAllocation } from '@/lib/types';
import { displayFieldArea, fmt } from '@/lib/rules';
import { axisChipOptions, fieldPassesAxisParams, axisParamsActive } from '@/lib/grouping';
import { getFarmContext } from '@/lib/farm';
import { FilterChips } from '@/components/FilterChips';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  planned: { bg: '#EFEBE0', color: '#6B5D34', label: 'Planned' },
  active: { bg: '#E2EFE2', color: '#2F6B36', label: 'Active' },
};

function parseSeason(raw: string | undefined, fallback: number): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function seasonShort(season: number): string {
  const w = cropSeasonWindow(season);
  return `${season} · Oct ${w.start.slice(2, 4)}–Sep ${w.end.slice(2, 4)}`;
}

export default async function CropsPage({
  searchParams,
}: {
  searchParams: { from?: string; season?: string; group?: string; type?: string; agreement?: string };
}) {
  const [fields, crops, allocations, applications, products, settings, groups, allocationTypes, agreements, fieldAgreementMap, farmCtx] = await Promise.all([
    loadFields(),
    loadCrops(),
    loadCropAllocations(),
    loadAllApplications(),
    loadAllProducts(),
    loadSettings(),
    loadGroups(),
    loadAllocationTypes(),
    loadAgreements(),
    loadFieldAgreementMap(),
    getFarmContext(),
  ]);

  const isAdmin = !!farmCtx && (farmCtx.isAdmin || farmCtx.role === 'admin');

  const fromHref = searchParams.from || '/';
  const currentSeason = currentCropSeason();
  const season = parseSeason(searchParams.season, currentSeason);
  const seasonOpts = [currentSeason - 1, currentSeason, currentSeason + 1];

  const groupFilter = searchParams.group || 'all';
  const typeFilter = searchParams.type || 'all';
  const agreementFilter = searchParams.agreement || 'all';
  const axisParams = { block: groupFilter, type: typeFilter, agreement: agreementFilter };

  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const cropById = new Map<string, LoadedCrop>(crops.map((c) => [c.id, c]));

  // One focus allocation per field for this season (active preferred, else planned).
  const focusByField = new Map<string, FieldCropAllocation>();
  for (const a of allocations) {
    if (a.season !== season) continue;
    if (a.status !== 'active' && a.status !== 'planned') continue;
    const ex = focusByField.get(a.field_id);
    if (!ex) focusByField.set(a.field_id, a);
    else if (a.status === 'active' && ex.status !== 'active') focusByField.set(a.field_id, a);
  }

  // Prior brassica seasons per field (all-time) for the clubroot check.
  const brassicaSeasonsByField = new Map<string, number[]>();
  for (const a of allocations) {
    if (cropById.get(a.crop_id)?.profile.family === 'brassica') {
      const arr = brassicaSeasonsByField.get(a.field_id) ?? [];
      arr.push(a.season);
      brassicaSeasonsByField.set(a.field_id, arr);
    }
  }

  type Row = { field: typeof fields[number]; alloc: FieldCropAllocation; lc: LoadedCrop | null; plan: CropPlan | null };
  const allRows: Row[] = [];
  for (const a of focusByField.values()) {
    const field = fieldById.get(a.field_id);
    if (!field) continue;
    const lc = cropById.get(a.crop_id) ?? null;
    let plan: CropPlan | null = null;
    if (lc) {
      plan = buildCropPlan(field, a, lc.profile, applications, products, settings, {
        priorBrassicaSeasons: (brassicaSeasonsByField.get(a.field_id) ?? []).filter((s) => s !== a.season),
      });
    }
    allRows.push({ field, alloc: a, lc, plan });
  }
  allRows.sort((x, y) => x.field.name.localeCompare(y.field.name));

  // Filter chips reflect only the axes present among this season's crop fields.
  const cropFields = allRows.map((r) => r.field);
  const axisOptions = axisChipOptions({
    fields: cropFields,
    blocks: groups.map((g) => ({ id: g.id, name: g.name })),
    types: allocationTypes.map((t) => ({ id: t.id, label: t.label })),
    agreements: agreements.map((a) => ({ id: a.id, code: a.code })),
    fieldAgreementMap,
  });
  const showLandFilters =
    axisOptions.block.length >= 2 || axisOptions.type.length >= 2 || axisOptions.agreement.length >= 2;

  const rows = allRows.filter((r) => fieldPassesAxisParams(r.field, axisParams, fieldAgreementMap));

  // Summary: count + total area in the user's unit.
  const areaUnit = settings.unitSystem === 'acres' ? 'ac' : 'ha';
  const totalArea = rows.reduce((s, r) => s + displayFieldArea(r.field, settings.unitSystem).value, 0);

  // Build season-switch hrefs that preserve the active land filters.
  const hrefForSeason = (s: number): string => {
    const p = new URLSearchParams();
    if (groupFilter !== 'all') p.set('group', groupFilter);
    if (typeFilter !== 'all') p.set('type', typeFilter);
    if (agreementFilter !== 'all') p.set('agreement', agreementFilter);
    if (s !== currentSeason) p.set('season', String(s));
    const qs = p.toString();
    return qs ? `/crops?${qs}` : '/crops';
  };

  return (
    <div style={{ paddingBottom: 90 }}>
      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, #6b5b2e 0%, #4a3f1f 100%)', color: 'var(--brand-cream, #efe7d6)', padding: '16px 16px 18px' }}>
        <Link href={fromHref} className="hero-back" style={{ color: 'rgba(239,231,214,0.85)' }}>
          <ArrowLeft size={15} /> Back
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sprout size={18} />
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '2px 0 3px' }}>Crops</h1>
        </div>
        <p style={{ fontSize: 12.5, color: 'rgba(239,231,214,0.8)', margin: 0, lineHeight: 1.5 }}>
          Fields on a non-grass crop this season, each with its own nutrient plan. These fields drop out of the grass reports while their crop is active.
        </p>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {/* Season selector */}
        <div className="toggle-group" role="group" aria-label="Season" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {seasonOpts.map((s) => (
            <Link
              key={s}
              href={hrefForSeason(s)}
              scroll={false}
              className={`toggle-btn ${s === season ? 'active' : ''}`}
              style={{ fontSize: 13, padding: '6px 12px', textDecoration: 'none' }}
            >
              {seasonShort(s)}
            </Link>
          ))}
        </div>

        {/* Land filters (block / type / agreement) — only when there's something to pick */}
        {showLandFilters && (
          <details open={axisParamsActive(axisParams)} style={{ marginBottom: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: '#6B5D34', listStyle: 'none', padding: '2px 0' }}>
              Filter by land{axisParamsActive(axisParams) ? ' · active' : ''}
            </summary>
            <div style={{ marginTop: 8 }}>
              {axisOptions.block.length >= 2 && <FilterChips paramName="group" ariaLabel="Filter by block" options={axisOptions.block} />}
              {axisOptions.type.length >= 2 && <FilterChips paramName="type" ariaLabel="Filter by allocation type" options={axisOptions.type} />}
              {axisOptions.agreement.length >= 2 && <FilterChips paramName="agreement" ariaLabel="Filter by agreement" options={axisOptions.agreement} />}
            </div>
          </details>
        )}

        {/* Summary */}
        {rows.length > 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft, #444)', marginBottom: 12 }}>
            <strong>{rows.length}</strong> field{rows.length === 1 ? '' : 's'} on crops · {fmt(totalArea, 1)} {areaUnit}
            {axisParamsActive(axisParams) && allRows.length !== rows.length ? ` · ${allRows.length - rows.length} hidden by filter` : ''}
          </div>
        )}

        {/* Crop field cards */}
        {rows.map((r) => {
          const a = displayFieldArea(r.field, settings.unitSystem);
          const st = STATUS_STYLE[r.alloc.status] ?? STATUS_STYLE.planned;
          const p = r.plan;
          const hasWarn = !!(p && (p.clubrootWarning || p.phLow));
          return (
            <Link
              key={r.field.id}
              href={`/fields/${r.field.id}/crop?from=/crops`}
              className="card"
              style={{ display: 'block', padding: 14, marginBottom: 8, textDecoration: 'none', color: 'inherit' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{r.field.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>
                    {r.lc?.profile.label ?? r.alloc.crop_key ?? 'Unknown crop'} · {fmt(a.value, 1)} {a.unit}
                    {r.alloc.expected_yield != null ? ` · ${r.alloc.expected_yield} ${r.alloc.expected_yield_unit ?? ''}`.trimEnd() : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: st.bg, color: st.color }}>{st.label}</span>
                  <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
                </div>
              </div>

              {p ? (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
                    <PlanStat label="N" value={p.nToApply} sub={`of ${p.nTarget}${p.nIsCeiling ? ' max' : ''}`} />
                    <PlanStat label="P₂O₅" value={p.p2o5ToApply} sub={`Index ${p.pIndex}`} />
                    <PlanStat label="K₂O" value={p.k2oToApply} sub={`Index ${p.kIndex}`} />
                  </div>
                  {hasWarn && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 9, fontSize: 11.5, color: '#7a5b12' }}>
                      <AlertTriangle size={13} style={{ flexShrink: 0 }} />
                      {p.clubrootWarning && p.phLow ? 'Clubroot & low pH — see plan'
                        : p.clubrootWarning ? 'Clubroot rotation risk — see plan'
                          : `Soil pH ${p.ph?.toFixed(1)} below target — see plan`}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 9 }}>
                  This crop is no longer in your catalogue — open the field to re-allocate.
                </div>
              )}
            </Link>
          );
        })}

        {/* Empty state */}
        {rows.length === 0 && (
          <div className="card" style={{ padding: 22, textAlign: 'center' }}>
            <Sprout size={26} style={{ color: '#6B5D34', marginBottom: 8 }} />
            <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600, marginBottom: 4 }}>
              {allRows.length > 0 ? 'No crop fields match the filter' : `No fields on crops for ${season}`}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
              {allRows.length > 0
                ? 'Clear the land filter to see this season’s crop fields.'
                : 'Open a field and tap Crops to put it on a non-grass crop for the season.'}
            </div>
          </div>
        )}

        {/* Nutrition guide link */}
        <Link
          href="/crops/guide?from=/crops"
          className="card"
          style={{ display: 'flex', alignItems: 'center', gap: 11, padding: 13, marginTop: 14, textDecoration: 'none', color: 'inherit' }}
        >
          <BookOpen size={18} style={{ color: '#6B5D34', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Crop nutrition guide</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Yields, offtake, N timing and soil fit for every crop</div>
          </div>
          <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
        </Link>

        {/* Catalogue editor (admin) */}
        {isAdmin && (
          <Link
            href="/settings/crops"
            className="card"
            style={{ display: 'flex', alignItems: 'center', gap: 11, padding: 13, marginTop: 8, textDecoration: 'none', color: 'inherit' }}
          >
            <Settings size={18} style={{ color: '#6B5D34', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Crop catalogue</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Copy and tune crops you can allocate</div>
            </div>
            <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
          </Link>
        )}
      </div>
    </div>
  );
}

function PlanStat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div style={{ minWidth: 78 }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label} to apply</div>
      <div className="nutrient-num" style={{ fontSize: 18, fontWeight: 800, color: 'var(--forest-dark)' }}>
        {Math.round(value)} <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--muted)' }}>kg/ha</span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{sub}</div>
    </div>
  );
}
