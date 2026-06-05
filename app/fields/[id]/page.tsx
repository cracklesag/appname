import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Droplets, Sprout, Mountain, Edit3, Plus, Scissors } from 'lucide-react';
import { Header } from '@/components/Header';
import { NutrientBar } from '@/components/NutrientBar';
import {
  ApplicationCard, CutEntry, NAvailabilityStrip,
} from '@/components/FieldDetailCards';
import { FieldGroupPicker } from '@/components/FieldGroupPicker';
import { NextActionPicker } from '@/components/NextActionPicker';
import { DeleteFieldSection } from '@/components/DeleteFieldSection';
import { DeleteFieldEventButton } from '@/components/DeleteFieldEventButton';
import {
  loadField, loadApplicationsForField, loadCutsForField, loadAllProducts, loadSettings, loadGrassSystems, loadGroups, loadFieldEvents,
} from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import {
  CUT_TYPE_LABELS, nutrientPerArea, displayFieldArea, displayRate, fmt, fmtDate, fmtDateShort,
  isSampleStale, sampleAgeYears, sampleYear,
  getSoilType, SOIL_TYPE_SHORT_LABELS,
  getCutTargets, getOfftakeForCut, getResolvedNextCutType, getSeasonLabel, getSeasonStart, methodLabel,
  getFieldPKRecommendation, organicReleaseFraction, monthsBetween,
  NEXT_CUT_LABELS,
  resolveGrassSystem,
  soilMetricColor, sumNutrients, calcNutrients, YIELD_CLASS_LABELS,
} from '@/lib/rules';
import { meteredApps, isPendingPartial, fieldAreaHa } from '@/lib/partials';

export const dynamic = 'force-dynamic';

export default async function FieldDetailPage({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: 'overview' | 'season'; from?: string };
}) {
  const tab = searchParams.tab === 'season' ? 'season' : 'overview';

  const [field, applications, cuts, products, settings, groups, grassSystems, farmCtx] = await Promise.all([
    loadField(params.id),
    loadApplicationsForField(params.id),
    loadCutsForField(params.id),
    loadAllProducts(),
    loadSettings(),
    loadGroups(),
    loadGrassSystems(),
    getFarmContext(),
  ]);

  if (!field) notFound();

  const fieldEvents = await loadFieldEvents(params.id);

  const isAdmin = farmCtx?.isAdmin ?? true;
  const myUserId = farmCtx?.userId ?? null;
  // Staff may edit/delete only entries they created; admins edit everything.
  const canEditEntry = (createdBy: string | null) => isAdmin || (createdBy != null && createdBy === myUserId);

  // Back-navigation continuity: carry where the user came from through this
  // field and its sub-screens so "back" returns to the origin (e.g. the
  // filtered Plan) rather than the generic field list.
  const fromParam = searchParams.from;
  const selfHref = `/fields/${field.id}${fromParam ? `?from=${encodeURIComponent(fromParam)}` : ''}`;
  const subFrom = `?from=${encodeURIComponent(selfHref)}`;
  const tabFromQ = fromParam ? `&from=${encodeURIComponent(fromParam)}` : '';
  const tabFromQ1 = fromParam ? `?from=${encodeURIComponent(fromParam)}` : '';

  const seasonStart = getSeasonStart();
  const seasonLabel = getSeasonLabel();

  // Resolve the field's grass system once — drives N/K multipliers in
  // getCutTargets and the subtitle line below.
  const grassSystem = resolveGrassSystem(field, grassSystems);

  const fApps = applications; // already date-desc
  const seasonApps = fApps.filter((a) => a.date_applied >= seasonStart);
  const olderApps = fApps.filter((a) => a.date_applied < seasonStart);
  const fCuts = cuts.filter((c) => c.cut_date >= seasonStart); // already date-desc

  const lastCut = fCuts[0];
  const windowStart = lastCut ? lastCut.cut_date : seasonStart;
  const cutsDone = fCuts.length;
  const nextCutNumber = Math.min(cutsDone + 1, field.cut_profile);
  const cutsRemaining = Math.max(0, field.cut_profile - cutsDone);
  // Resolved next-cut type — respects per-cut next_action so the subtitle
  // shows "Maintenance" / "Grazing" when the user has flagged the field
  // accordingly, not the static planned_cuts entry.
  const resolvedNextCutType = getResolvedNextCutType(field, fCuts);
  // N target from getCutTargets (offtake/system-based). P & K targets from the
  // RB209 recommendation (build-up at low index + catch-up K) so the field
  // detail matches the fertiliser plan and P&K status exactly.
  const nTargetSrc = cutsRemaining > 0 ? getCutTargets(field, nextCutNumber, settings, grassSystem, fCuts) : null;
  const pkRec = cutsRemaining > 0 ? getFieldPKRecommendation(field, nextCutNumber, fCuts, settings.agronomy) : null;
  const targets = (nTargetSrc && pkRec) ? {
    n: nTargetSrc.n,
    p2o5: pkRec.p2o5,
    k2o: pkRec.k2o + pkRec.extraKAfterCut,
    yieldDM: nTargetSrc.yieldDM,
    cutType: nTargetSrc.cutType,
  } : null;

  const appsSinceCut = seasonApps.filter((a) => a.date_applied >= windowStart);
  const sinceCutTotals = sumNutrients(meteredApps(appsSinceCut, () => fieldAreaHa(field)), products);

  // Carryover from before last cut (within season) — P and K only. Each pre-cut
  // application is released over time by material type (slurry fast, FYM slow),
  // then crop offtake from cuts taken is netted off. Matches the fert plan.
  const todayIso = new Date().toISOString().slice(0, 10);
  const releaseParams = {
    releaseSlurryStartPct: settings.reportDefaults.releaseSlurryStartPct,
    releaseSlurryPerMonthPct: settings.reportDefaults.releaseSlurryPerMonthPct,
    releaseFymStartPct: settings.reportDefaults.releaseFymStartPct,
    releaseFymPerMonthPct: settings.reportDefaults.releaseFymPerMonthPct,
    releaseFymCapPct: settings.reportDefaults.releaseFymCapPct,
  };
  let carryover = { p: 0, k: 0 };
  if (lastCut) {
    const preCutApps = seasonApps.filter((a) => a.date_applied < windowStart);
    let carryPRaw = 0, carryKRaw = 0;
    for (const a of meteredApps(preCutApps, () => fieldAreaHa(field))) {
      const t = (products.find((p) => p.id === a.product_id)?.type ?? 'bag_fert') as 'slurry' | 'solid_manure' | 'bag_fert' | 'lime';
      const months = monthsBetween(a.date_applied, todayIso);
      const frac = organicReleaseFraction(t, months, releaseParams);
      const nut = sumNutrients([a], products);
      carryPRaw += nut.p * frac;
      carryKRaw += nut.k * frac;
    }
    let pOff = 0, kOff = 0;
    [...fCuts].sort((a, b) => a.cut_date.localeCompare(b.cut_date)).forEach((c) => {
      const o = getOfftakeForCut(field.cut_profile, c.cut_number, c.yield_class, settings, c.cut_type);
      pOff += o.p2o5; kOff += o.k2o;
    });
    carryover = {
      p: Math.max(0, carryPRaw - pOff),
      k: Math.max(0, carryKRaw - kOff),
    };
  }

  const availableForNextCut = {
    n: sinceCutTotals.n,
    p: sinceCutTotals.p + carryover.p,
    k: sinceCutTotals.k + carryover.k,
    so3: sinceCutTotals.so3,
    mgo: sinceCutTotals.mgo,
  };

  const seasonTotals = sumNutrients(meteredApps(seasonApps, () => fieldAreaHa(field)), products);
  // The most recent application (seasonApps is date-desc) and what IT supplied —
  // this is what the headline figure shows, not a running season total. Pending
  // part applications are excluded — they haven't fed the whole field yet.
  const latestApp = seasonApps.filter((a) => !isPendingPartial(a))[0] ?? null;
  const latestProduct = latestApp ? products.find((p) => p.id === latestApp.product_id) : undefined;
  const latestNut = latestApp
    ? calcNutrients(latestProduct, latestApp.rate_value, latestApp.rate_unit, latestApp.date_applied, latestApp.method)
    : null;

  const lastSlurry = fApps.find((a) => products.find((p) => p.id === a.product_id)?.type === 'slurry');
  const lastFert   = fApps.find((a) => products.find((p) => p.id === a.product_id)?.type === 'bag_fert');

  const windowLabel = lastCut
    ? `since cut ${lastCut.cut_number} on ${fmtDateShort(lastCut.cut_date)}`
    : 'since season start';

  const limeApps = fApps.filter((a) => products.find((p) => p.id === a.product_id)?.type === 'lime');

  const tgt = settings.soilTargets;

  return (
    <div style={{ paddingBottom: 100 }}>
      <Header
        title={field.name}
        subtitle={(() => {
          const a = displayFieldArea(field, settings.unitSystem);
          const groupName = field.group_id
            ? (groups.find((g) => g.id === field.group_id)?.name ?? null)
            : null;
          const groupBit = groupName ? ` · ${groupName}` : '';
          const systemBit = grassSystem ? ` · ${grassSystem.short_label}` : '';
          return `${fmt(a.value, 1)} ${a.unit} · ${field.cut_profile}-cut${groupBit}${systemBit}`;
        })()}
        backHref={searchParams.from || '/fields'}
      />

      <div className="tabs">
        <Link href={`/fields/${field.id}${tabFromQ1}`} className={`tab ${tab === 'overview' ? 'active' : ''}`} scroll={false}>Overview</Link>
        <Link href={`/fields/${field.id}?tab=season${tabFromQ}`} className={`tab ${tab === 'season' ? 'active' : ''}`} scroll={false}>This season</Link>
      </div>

      {tab === 'overview' && (
        <div style={{ padding: 16 }}>
          {/* Group — admin only (staff can't reorganise fields) */}
          {isAdmin && (
          <div className="card" style={{ padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="label" style={{ margin: 0, flexShrink: 0 }}>Group</div>
            <div style={{ flex: 1 }}>
              <FieldGroupPicker
                fieldId={field.id}
                currentGroupId={field.group_id}
                groups={groups}
              />
            </div>
          </div>
          )}

          {/* What's next — editable per-cut state. Updates the most recent
              cut's next_action so users can change their mind without
              logging a new cut. When no cuts exist this season, picker is
              replaced with a "log your first cut" hint. */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 6 }}>What&apos;s next for this field</div>
            <NextActionPicker
              cutId={lastCut?.id ?? null}
              fieldId={field.id}
              current={lastCut?.next_action ?? null}
            />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
              Drives where this field appears in the spreading and grazing reports until the next cut is logged.
            </div>
          </div>

          {/* Soil sample */}
          {field.sampled ? (
            <div className="card" style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <div className="label" style={{ margin: 0 }}>
                    {(() => {
                      const yr = sampleYear(field);
                      const age = sampleAgeYears(field);
                      const stale = isSampleStale(field);
                      if (yr == null || !field.sample_date) return 'Last soil sample';
                      // "Apr 2022" — months mean the same thing year over year,
                      // dates within a month don't change agronomic state.
                      const monthIdx = parseInt(field.sample_date.slice(5, 7), 10) - 1;
                      const monthName = isNaN(monthIdx)
                        ? ''
                        : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][monthIdx] + ' ';
                      const ageBit = age != null && age > 0
                        ? ` · ${age} year${age === 1 ? '' : 's'} old`
                        : '';
                      return (
                        <>
                          Sampled {monthName}{yr}
                          <span style={{ color: stale ? 'var(--red, #b85b3a)' : 'var(--muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                            {ageBit}
                          </span>
                        </>
                      );
                    })()}
                  </div>
                  {isSampleStale(field) && (
                    <div style={{ fontSize: 11, color: 'var(--red, #b85b3a)', marginTop: 2 }}>
                      Consider resampling — indices drift over 3+ years.
                    </div>
                  )}
                </div>
                {isAdmin && (
                <Link
                  href={`/fields/${field.id}/soil${subFrom}`}
                  style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, padding: '6px 10px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Edit3 size={12} /> Update
                </Link>
                )}
              </div>
              <div style={{ display: 'flex', gap: 14 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>pH</div>
                  <div className="nutrient-num" style={{ fontSize: 22, color: soilMetricColor(field.ph, tgt.pH) }}>{field.ph ?? '—'}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>target {tgt.pH}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>P idx</div>
                  <div className="nutrient-num" style={{ fontSize: 22, color: soilMetricColor(field.p_idx, tgt.pIdx) }}>{field.p_idx ?? '—'}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>target {tgt.pIdx}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>K idx</div>
                  <div className="nutrient-num" style={{ fontSize: 22, color: soilMetricColor(field.k_idx, tgt.kIdx) }}>{field.k_idx ?? '—'}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>target {tgt.kIdx}</div>
                </div>
              </div>
              {field.notes && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>{field.notes}</div>}
            </div>
          ) : (
            <div className="card" style={{ padding: 14, marginBottom: 14, background: 'var(--amber-soft)', borderColor: 'var(--amber)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--amber)', fontWeight: 700 }}>No soil sample on record</div>
                {isAdmin && (
                <Link
                  href={`/fields/${field.id}/soil${subFrom}`}
                  className="btn-amber"
                  style={{ padding: '6px 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Plus size={12} /> Add
                </Link>
                )}
              </div>
              {field.notes && <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-soft)' }}>{field.notes}</div>}
            </div>
          )}

          {/* Soil type chip — small line below the sample card. Always shown
              because every field has a soil type (medium_loam default). */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginTop: -8, marginBottom: 14,
            paddingLeft: 14, fontSize: 11, color: 'var(--muted)',
          }}>
            <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>Soil:</span>
            <span style={{ color: 'var(--ink)' }}>{SOIL_TYPE_SHORT_LABELS[getSoilType(field)]}</span>
            {isAdmin && (
            <Link
              href={`/fields/${field.id}/soil${subFrom}`}
              style={{ color: 'var(--forest-dark, #3d5b29)', textDecoration: 'underline', fontSize: 11 }}
            >
              edit
            </Link>
            )}
          </div>

          {/* Status of next cut. Uses resolved next-cut type so that
              maintenance / rotational-grazing fields don't misleadingly
              show "Building toward silage" when the user has flagged
              the field for something else. */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div className="label" style={{ margin: 0 }}>
                {(() => {
                  if (resolvedNextCutType === 'complete') return <>All {field.cut_profile} cuts taken</>;
                  if (resolvedNextCutType === 'maintenance') return <>After cut {cutsDone} of {field.cut_profile} · Maintenance top-up</>;
                  if (!targets) return <>All {field.cut_profile} cuts taken</>;
                  return <>Building toward cut {nextCutNumber} of {field.cut_profile} · {NEXT_CUT_LABELS[resolvedNextCutType]}</>;
                })()}
              </div>
              {isAdmin && (
              <Link
                href={`/fields/${field.id}/plan${subFrom}`}
                style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, padding: '6px 10px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Edit3 size={12} /> Plan
              </Link>
              )}
            </div>
            {targets && (() => {
              const nUnit = settings.unitSystem === 'acres' ? 'kg/ac' : 'kg/ha';
              const cv = (kgHa: number) => Math.round(nutrientPerArea(kgHa, settings.unitSystem));
              const nView   = { value: cv(availableForNextCut.n), unit: nUnit };
              const pView   = { value: cv(availableForNextCut.p), unit: nUnit };
              const kView   = { value: cv(availableForNextCut.k), unit: nUnit };
              const nTgt    = cv(targets.n);
              const pTgt    = cv(targets.p2o5);
              const kTgt    = cv(targets.k2o);
              const pCarry  = cv(carryover.p);
              const kCarry  = cv(carryover.k);
              const sView   = { value: cv(availableForNextCut.so3), unit: nUnit };
              const mView   = { value: cv(availableForNextCut.mgo), unit: nUnit };
              const showSulphurMagnesium = availableForNextCut.so3 > 0 || availableForNextCut.mgo > 0;
              return (
                <>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                    Applied {windowLabel} · target {fmt(targets.yieldDM, 1)} t DM/ha
                  </div>
                  <NutrientBar label="N"    applied={nView.value} target={nTgt} unit={nView.unit} />
                  <NutrientBar label="P₂O₅" applied={pView.value} target={pTgt} unit={pView.unit} carryover={pCarry} />
                  <NutrientBar label="K₂O"  applied={kView.value} target={kTgt} unit={kView.unit} carryover={kCarry} />
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>
                    N shown as crop-available — slurry/manure already adjusted for typical losses.
                  </div>
                  {showSulphurMagnesium && (
                    <div style={{
                      display: 'flex', gap: 18, marginTop: 4, paddingTop: 8,
                      borderTop: '1px dashed var(--line-soft)',
                      fontSize: 12, color: 'var(--muted)',
                    }}>
                      <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11 }}>Also delivered</span>
                      {availableForNextCut.so3 > 0 && (
                        <span>SO₃ <span className="nutrient-num" style={{ color: 'var(--ink)' }}>{fmt(sView.value)}</span> {sView.unit}</span>
                      )}
                      {availableForNextCut.mgo > 0 && (
                        <span>MgO <span className="nutrient-num" style={{ color: 'var(--ink)' }}>{fmt(mView.value)}</span> {mView.unit}</span>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
            {!targets && (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>Season complete. See <strong>This season</strong> tab for full totals.</div>
            )}
          </div>

          {/* Last applications glance */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 10 }}>Most recent</div>
            {lastSlurry ? (
              <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--line-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Droplets size={14} style={{ color: 'var(--slurry)' }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Slurry</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>{fmtDate(lastSlurry.date_applied)}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                  {lastSlurry.rate_value} {lastSlurry.rate_unit}{lastSlurry.method && ` · ${methodLabel(lastSlurry.method)}`}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--line-soft)' }}>
                No slurry logged yet
              </div>
            )}
            {lastFert ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Sprout size={14} style={{ color: 'var(--forest)' }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Bag fert</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>{fmtDate(lastFert.date_applied)}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                  {products.find((p) => p.id === lastFert.product_id)?.name} · {lastFert.rate_value} {lastFert.rate_unit}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>No fertiliser logged yet</div>
            )}
          </div>

          {/* Cuts */}
          <div className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div className="label" style={{ margin: 0 }}>Cuts taken ({cutsDone}/{field.cut_profile})</div>
              {cutsRemaining > 0 && (
                <Link
                  href={`/fields/${field.id}/cut${subFrom}`}
                  style={{ background: 'transparent', border: '1px solid var(--amber)', color: 'var(--amber)', borderRadius: 4, padding: '6px 10px', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Scissors size={12} /> Log cut
                </Link>
              )}
            </div>
            {fCuts.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>No cuts logged yet this season.</div>
            ) : (
              fCuts.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line-soft)' }}>
                  <Scissors size={14} style={{ color: 'var(--amber)' }} />
                  <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 700 }}>Cut {c.cut_number}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{YIELD_CLASS_LABELS[c.yield_class]}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>{fmtDate(c.cut_date)}</span>
                </div>
              ))
            )}
          </div>

          {/* Lime history */}
          <div className="card" style={{ padding: 14, marginTop: 14 }}>
            <div className="label" style={{ marginBottom: 10 }}>Lime history ({limeApps.length})</div>
            {limeApps.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>No lime applications recorded.</div>
            ) : (
              limeApps.map((a) => {
                const product = products.find((p) => p.id === a.product_id)!;
                const disp = displayRate(a, settings, product.type);
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line-soft)' }}>
                    <Mountain size={14} style={{ color: 'var(--stone)' }} />
                    <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 700 }}>{fmt(disp.value, 1)} {disp.unit}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>{fmtDate(a.date_applied)}</span>
                  </div>
                );
              })
            )}
          </div>

          {/* Field events */}
          <div className="card" style={{ padding: 14, marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div className="label" style={{ margin: 0 }}>Field events</div>
              {isAdmin && (
                <Link
                  href={`/fields/${field.id}/reseed${subFrom}`}
                  style={{ background: 'transparent', border: '1px solid var(--forest)', color: 'var(--forest)', borderRadius: 4, padding: '6px 10px', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Plus size={12} /> Log event
                </Link>
              )}
            </div>
            {fieldEvents.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>No reseed, oversow or plough events logged yet.</div>
            ) : (
              fieldEvents.map((ev) => {
                const sys = ev.grass_system_id ? grassSystems.find((g) => g.id === ev.grass_system_id) : null;
                const typeLabel = { reseed: 'Reseed', oversow: 'Oversow', plough: 'Plough' }[ev.event_type];
                const rateBit = ev.seed_rate_value ? `${ev.seed_rate_value} ${ev.seed_rate_unit ?? 'kg/ac'}` : '';
                const sub = [ev.seed_mix ?? '', rateBit].filter(Boolean).join(' · ');
                return (
                  <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line-soft)' }}>
                    <Sprout size={14} style={{ color: ev.event_type === 'plough' ? 'var(--stone)' : 'var(--forest)', flexShrink: 0 }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 700 }}>
                        {typeLabel}{sys ? ` · ${sys.short_label}` : ''}
                      </div>
                      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDate(ev.event_date)}</span>
                    {isAdmin && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                        <Link
                          href={`/fields/${field.id}/reseed/${ev.id}/edit${subFrom}`}
                          className="btn-ghost"
                          style={{ padding: 4, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center' }}
                          title="Edit this event"
                        >
                          <Edit3 size={13} />
                        </Link>
                        <DeleteFieldEventButton eventId={ev.id} fieldId={field.id} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, fontStyle: 'italic' }}>
              {'The most recent reseed or oversow with a grass system sets the field\u2019s current sward.'}
            </div>
          </div>

          {isAdmin && (
            <DeleteFieldSection fieldId={field.id} fieldName={field.name} />
          )}
        </div>
      )}

      {tab === 'season' && (
        <div style={{ padding: 16 }}>
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label">
              {latestApp ? 'Last application' : `${seasonLabel} applied`}{' '}
              <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--muted)' }}>
                {latestApp ? `· ${latestProduct?.name ?? ''} on ${fmtDate(latestApp.date_applied)}` : `· since ${fmtDate(seasonStart)}`}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 4, flexWrap: 'wrap' }}>
              {(() => {
                const nUnit2 = settings.unitSystem === 'acres' ? 'kg/ac' : 'kg/ha';
                const cv2 = (kgHa: number) => Math.round(nutrientPerArea(kgHa, settings.unitSystem));
                // Headline = the most recent application's supply (falls back to
                // season totals only if somehow there's no latest app).
                const src = latestNut ?? { nPerHa: seasonTotals.n, p2o5PerHa: seasonTotals.p, k2oPerHa: seasonTotals.k, so3PerHa: seasonTotals.so3, mgoPerHa: seasonTotals.mgo };
                const nView = { value: cv2(src.nPerHa), unit: nUnit2 };
                const pView = { value: cv2(src.p2o5PerHa), unit: nUnit2 };
                const kView = { value: cv2(src.k2oPerHa), unit: nUnit2 };
                const sView = { value: cv2(src.so3PerHa), unit: nUnit2 };
                const mView = { value: cv2(src.mgoPerHa), unit: nUnit2 };
                return (
                  <>
                    <div style={{ flex: '1 1 60px' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>N</div>
                      <div className="nutrient-num" style={{ fontSize: 24, color: 'var(--forest-dark)' }}>{fmt(nView.value)}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{nView.unit} avail</div>
                    </div>
                    <div style={{ flex: '1 1 60px' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>P₂O₅</div>
                      <div className="nutrient-num" style={{ fontSize: 24, color: 'var(--forest-dark)' }}>{fmt(pView.value)}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{pView.unit}</div>
                    </div>
                    <div style={{ flex: '1 1 60px' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>K₂O</div>
                      <div className="nutrient-num" style={{ fontSize: 24, color: 'var(--forest-dark)' }}>{fmt(kView.value)}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{kView.unit}</div>
                    </div>
                    <div style={{ flex: '1 1 60px', opacity: seasonTotals.so3 > 0 ? 1 : 0.45 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>SO₃</div>
                      <div className="nutrient-num" style={{ fontSize: 20, color: 'var(--ink)' }}>{fmt(sView.value)}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sView.unit}</div>
                    </div>
                    <div style={{ flex: '1 1 60px', opacity: seasonTotals.mgo > 0 ? 1 : 0.45 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>MgO</div>
                      <div className="nutrient-num" style={{ fontSize: 20, color: 'var(--ink)' }}>{fmt(mView.value)}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{mView.unit}</div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          <NAvailabilityStrip />

          <Link
            href={`/fields/${field.id}/part-applications${subFrom}`}
            className="card"
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, marginTop: 14, textDecoration: 'none' }}
          >
            <Droplets size={18} style={{ color: 'var(--slurry)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 700 }}>Part applications</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>K loading heat map for part-field spreading</div>
            </div>
            <span style={{ color: 'var(--muted)', fontSize: 18 }}>›</span>
          </Link>

          <div className="label" style={{ paddingLeft: 4, marginTop: 4 }}>
            Timeline ({seasonApps.length + fCuts.length})
          </div>
          {seasonApps.length === 0 && fCuts.length === 0 && (
            <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
              No entries this season yet.
            </div>
          )}

          {(() => {
            const items: Array<{ kind: 'app' | 'cut'; date: string; key: string; node: React.ReactNode }> = [];
            seasonApps.forEach((a) => items.push({
              kind: 'app', date: a.date_applied, key: `app-${a.id}`,
              node: <ApplicationCard app={a} products={products} settings={settings} fieldId={field.id} canEdit={canEditEntry(a.created_by)} />,
            }));
            fCuts.forEach((c) => items.push({
              kind: 'cut', date: c.cut_date, key: `cut-${c.id}`,
              node: <CutEntry cut={c} field={field} settings={settings} canEdit={canEditEntry(c.created_by)} />,
            }));
            items.sort((a, b) => b.date.localeCompare(a.date));
            return items.map((i) => <div key={i.key}>{i.node}</div>);
          })()}

          {olderApps.length > 0 && (
            <details style={{ marginTop: 16 }}>
              <summary style={{ cursor: 'pointer', padding: '8px 4px', fontSize: 13, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Earlier than this season ({olderApps.length})
              </summary>
              <div style={{ marginTop: 8 }}>
                {olderApps.map((a) => {
                  const product = products.find((p) => p.id === a.product_id);
                  return (
                    <div key={a.id} className="card" style={{ padding: 10, marginBottom: 6, opacity: 0.75 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {fmtDate(a.date_applied)} · {product?.name}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink)' }}>{a.rate_value} {a.rate_unit}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Footer actions */}
      <div style={{ position: 'sticky', bottom: 0, left: 0, right: 0, padding: 16, background: 'linear-gradient(to top, var(--paper) 70%, transparent)', display: 'flex', gap: 8 }}>
        {cutsRemaining > 0 && (
          <Link
            href={`/fields/${field.id}/cut${subFrom}`}
            className="btn-amber"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none' }}
          >
            <Scissors size={16} /> Cut
          </Link>
        )}
        <Link
          href={`/fields/${field.id}/log${subFrom}`}
          className="btn-primary"
          style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none' }}
        >
          <Plus size={20} /> Log application
        </Link>
      </div>
    </div>
  );
}
