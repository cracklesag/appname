import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, Plus, FileUp } from 'lucide-react';
import { Header } from '@/components/Header';
import { MiniBar } from '@/components/NutrientBar';
import { FilterChips } from '@/components/FilterChips';
import {
  loadAllProducts,
  loadFields,
  loadAllApplications,
  loadAllCuts,
  loadSettings,
} from '@/lib/data';
import {
  fmtDateShort,
  getCutTargets,
  getOfftakeForCut,
  getNextCutType,
  getSeasonLabel,
  getSeasonStart,
  soilMetricColor,
  sumNutrients,
  displayBagAmount,
  displayFieldArea,
  fmt,
  NextCutType,
} from '@/lib/rules';

export const dynamic = 'force-dynamic';

type NutrientKey = 'n' | 'p' | 'k';

export default async function HomePage({
  searchParams,
}: {
  searchParams: { next?: string; short?: string };
}) {
  // Onboarding gate: first-run users land on /welcome to pick their preferred unit
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const [fields, products, applications, cuts] = await Promise.all([
    loadFields(),
    loadAllProducts(),
    loadAllApplications(),
    loadAllCuts(),
  ]);

  const seasonStart = getSeasonStart();
  const seasonLabel = getSeasonLabel();

  // ---- Precompute per-field state -----------------------------------
  //
  // Done before the JSX so we can filter + sort by derived values
  // (next cut type, nutrient shortfall). Mirrors the logic in the
  // field detail page so the home dashboard agrees with the detail
  // view about whether a field is "short" of a nutrient — including
  // P/K carryover from earlier in the season.
  type FieldState = {
    field: typeof fields[number];
    cutsDone: number;
    lastCut: typeof cuts[number] | undefined;
    nextCut: number;
    nextCutType: NextCutType;
    targets: ReturnType<typeof getCutTargets> | null;
    sinceTotals: ReturnType<typeof sumNutrients>;
    /** Available for next cut = since-cut applications + P/K carryover from earlier in season. */
    available: { n: number; p: number; k: number };
    /** Per-nutrient gap: target − available. Positive = short. null when no target (complete). */
    gap: { n: number; p: number; k: number } | null;
  };

  const fieldStates: FieldState[] = fields.map((f) => {
    const fApps = applications.filter((a) => a.field_id === f.id);
    const seasonApps = fApps.filter((a) => a.date_applied >= seasonStart);
    const fCuts = cuts.filter((c) => c.field_id === f.id && c.cut_date >= seasonStart);
    const cutsDone = fCuts.length;
    const lastCut = fCuts[0];
    const windowStart = lastCut ? lastCut.cut_date : seasonStart;
    const sinceCutApps = seasonApps.filter((a) => a.date_applied >= windowStart);
    const sinceTotals = sumNutrients(sinceCutApps, products);
    const nextCut = Math.min(cutsDone + 1, f.cut_profile);
    const nextCutType = getNextCutType(f, cutsDone);
    const targets = cutsDone < f.cut_profile ? getCutTargets(f, nextCut, settings) : null;

    // P/K carryover from applications before the last cut, minus offtake already
    // taken by cuts done this season. N has no carryover (mobile in soil).
    let carryover = { p: 0, k: 0 };
    if (lastCut) {
      const preCutApps = seasonApps.filter((a) => a.date_applied < windowStart);
      const preCutTotals = sumNutrients(preCutApps, products);
      let pOff = 0, kOff = 0;
      [...fCuts].sort((a, b) => a.cut_date.localeCompare(b.cut_date)).forEach((c) => {
        const o = getOfftakeForCut(f.cut_profile, c.cut_number, c.yield_class, settings, c.cut_type);
        pOff += o.p2o5; kOff += o.k2o;
      });
      carryover = {
        p: Math.max(0, preCutTotals.p - pOff),
        k: Math.max(0, preCutTotals.k - kOff),
      };
    }

    const available = {
      n: sinceTotals.n,
      p: sinceTotals.p + carryover.p,
      k: sinceTotals.k + carryover.k,
    };

    const gap = targets ? {
      n: Math.max(0, targets.n    - available.n),
      p: Math.max(0, targets.p2o5 - available.p),
      k: Math.max(0, targets.k2o  - available.k),
    } : null;

    return { field: f, cutsDone, lastCut, nextCut, nextCutType, targets, sinceTotals, available, gap };
  });

  // ---- Apply filters from URL ---------------------------------------
  //
  // `next` = active (default, complete fields excluded) | silage | bales | grazing | complete
  // `short` = any (default, no shortfall filter) | n | p | k
  const nextFilter = (searchParams.next ?? 'active') as 'active' | NextCutType;
  const shortFilterRaw = (searchParams.short ?? 'any');
  const shortFilter: NutrientKey | null =
    shortFilterRaw === 'n' || shortFilterRaw === 'p' || shortFilterRaw === 'k'
      ? shortFilterRaw : null;

  let visibleFields = fieldStates.filter((s) => {
    // Next-cut filter
    if (nextFilter === 'active') {
      if (s.nextCutType === 'complete') return false;
    } else if (s.nextCutType !== nextFilter) {
      return false;
    }
    // Short-of filter: must have a target (so completes already excluded
    // unless user explicitly picked Complete + a shortfall, which is fine
    // because completes have no gap, so they'll naturally drop out).
    if (shortFilter) {
      if (!s.gap) return false;
      if (s.gap[shortFilter] <= 0) return false;
    }
    return true;
  });

  // Sort: when filtering by shortfall, biggest gap first. Otherwise name A-Z.
  if (shortFilter) {
    visibleFields.sort((a, b) =>
      (b.gap?.[shortFilter] ?? 0) - (a.gap?.[shortFilter] ?? 0)
    );
  } else {
    visibleFields.sort((a, b) => a.field.name.localeCompare(b.field.name));
  }

  const hiddenByFilter = fieldStates.length - visibleFields.length;
  const anyFilterActive = nextFilter !== 'active' || shortFilter !== null;

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header
        title="Fields"
        subtitle={`APP_NAME · ${seasonLabel}`}
        right={
          <div style={{ display: 'inline-flex', gap: 6 }}>
            <Link
              href="/import"
              aria-label="Import a document"
              style={{
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '6px 10px',
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--ink-soft)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                textDecoration: 'none',
              }}
            >
              <FileUp size={14} /> Import
            </Link>
            <Link
              href="/fields/new"
              className="icon-btn"
              aria-label="Add field"
              style={{
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '6px 10px',
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--ink-soft)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                textDecoration: 'none',
              }}
            >
              <Plus size={14} /> Add
            </Link>
          </div>
        }
      />
      <div style={{ padding: '12px 16px' }}>
        {/* Filter chips — next cut type. URL param: ?next= */}
        {fields.length > 0 && (
          <>
            <FilterChips
              paramName="next"
              ariaLabel="Filter by next cut type"
              options={[
                { value: 'active',   label: 'Active' },
                { value: 'silage',   label: 'Silage' },
                { value: 'bales',    label: 'Bales' },
                { value: 'grazing',  label: 'Grazing' },
                { value: 'complete', label: 'Complete' },
              ]}
            />
            {/* Filter chips — shortfall. URL param: ?short= */}
            <FilterChips
              paramName="short"
              ariaLabel="Filter by nutrient shortfall"
              options={[
                { value: 'any', label: 'Any nutrient state' },
                { value: 'n',   label: 'Short of N' },
                { value: 'p',   label: 'Short of P' },
                { value: 'k',   label: 'Short of K' },
              ]}
            />

            {anyFilterActive && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                Showing {visibleFields.length} of {fieldStates.length}
                {hiddenByFilter > 0 ? ` · ${hiddenByFilter} hidden by filter` : ''}
                {shortFilter && visibleFields.length > 0 ? ` · sorted by largest gap` : ''}
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 4 }}>
          {visibleFields.map((s) => {
            const f = s.field;
            const tgt = settings.soilTargets;
            const phColor = soilMetricColor(f.ph, tgt.pH);
            const pColor = soilMetricColor(f.p_idx, tgt.pIdx);
            const kColor = soilMetricColor(f.k_idx, tgt.kIdx);

            return (
              <Link
                key={f.id}
                href={`/fields/${f.id}`}
                className="card field-row"
                style={{ padding: '14px 16px', marginBottom: 10 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="display" style={{ fontSize: 19, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>
                      {f.name}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                      {(() => {
                        const a = displayFieldArea(f, settings.unitSystem);
                        return `${fmt(a.value, 1)} ${a.unit} · ${f.cut_profile} cut`;
                      })()}
                    </div>
                    {f.sampled && (
                      <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 12 }}>
                        <span><span style={{ color: 'var(--muted)' }}>pH </span><span style={{ color: phColor, fontWeight: 700 }}>{f.ph ?? '—'}</span></span>
                        <span><span style={{ color: 'var(--muted)' }}>P </span><span style={{ color: pColor, fontWeight: 700 }}>{f.p_idx ?? '—'}</span></span>
                        <span><span style={{ color: 'var(--muted)' }}>K </span><span style={{ color: kColor, fontWeight: 700 }}>{f.k_idx ?? '—'}</span></span>
                      </div>
                    )}
                  </div>
                  <ChevronRight size={18} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 2 }} />
                </div>

                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                  {s.targets ? (
                    <>
                      Building toward <strong style={{ color: 'var(--forest-dark)' }}>cut {s.nextCut}</strong>
                      {' · '}
                      {s.lastCut ? `since cut ${s.lastCut.cut_number} on ${fmtDateShort(s.lastCut.cut_date)}` : 'since season start'}
                    </>
                  ) : (
                    <>All {f.cut_profile} cuts taken</>
                  )}
                </div>

                {s.targets && (() => {
                  // Use carryover-aware "available" totals so the bars match
                  // the field detail page (P/K carry over between cuts; N doesn't).
                  const nView = displayBagAmount(s.available.n, settings.bagFertUnit);
                  const pView = displayBagAmount(s.available.p, settings.bagFertUnit);
                  const kView = displayBagAmount(s.available.k, settings.bagFertUnit);
                  const nTgt  = displayBagAmount(s.targets.n,    settings.bagFertUnit).value;
                  const pTgt  = displayBagAmount(s.targets.p2o5, settings.bagFertUnit).value;
                  const kTgt  = displayBagAmount(s.targets.k2o,  settings.bagFertUnit).value;
                  return (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
                      <MiniBar label="N" applied={nView.value} target={nTgt} unit={nView.unit} />
                      <MiniBar label="P" applied={pView.value} target={pTgt} unit={pView.unit} />
                      <MiniBar label="K" applied={kView.value} target={kTgt} unit={kView.unit} />
                    </div>
                  );
                })()}
              </Link>
            );
          })}

          {visibleFields.length === 0 && fields.length > 0 && (
            <div className="card" style={{ padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>
                No fields match the current filter.
              </div>
            </div>
          )}

          {fields.length === 0 && (
            <div className="card" style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 14 }}>
                No fields yet. Add your first to get started.
              </div>
              <Link
                href="/fields/new"
                className="btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
              >
                <Plus size={16} /> Add field
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
