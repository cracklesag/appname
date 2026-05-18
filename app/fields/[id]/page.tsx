import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Droplets, Sprout, Mountain, Edit3, Plus, Scissors } from 'lucide-react';
import { Header } from '@/components/Header';
import { NutrientBar } from '@/components/NutrientBar';
import {
  ApplicationCard, CutEntry, NAvailabilityStrip,
} from '@/components/FieldDetailCards';
import {
  loadField, loadApplicationsForField, loadCutsForField, loadAllProducts, loadSettings,
} from '@/lib/data';
import {
  CUT_TYPE_LABELS, displayBagAmount, displayFieldArea, displayRate, fmt, fmtDate, fmtDateShort,
  getCutTargets, getOfftakeForCut, getSeasonLabel, getSeasonStart, METHOD_LABELS,
  soilMetricColor, sumNutrients, YIELD_CLASS_LABELS,
} from '@/lib/rules';

export const dynamic = 'force-dynamic';

export default async function FieldDetailPage({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: 'overview' | 'season' };
}) {
  const tab = searchParams.tab === 'season' ? 'season' : 'overview';

  const [field, applications, cuts, products, settings] = await Promise.all([
    loadField(params.id),
    loadApplicationsForField(params.id),
    loadCutsForField(params.id),
    loadAllProducts(),
    loadSettings(),
  ]);

  if (!field) notFound();

  const seasonStart = getSeasonStart();
  const seasonLabel = getSeasonLabel();

  const fApps = applications; // already date-desc
  const seasonApps = fApps.filter((a) => a.date_applied >= seasonStart);
  const olderApps = fApps.filter((a) => a.date_applied < seasonStart);
  const fCuts = cuts.filter((c) => c.cut_date >= seasonStart); // already date-desc

  const lastCut = fCuts[0];
  const windowStart = lastCut ? lastCut.cut_date : seasonStart;
  const cutsDone = fCuts.length;
  const nextCutNumber = Math.min(cutsDone + 1, field.cut_profile);
  const cutsRemaining = Math.max(0, field.cut_profile - cutsDone);
  const targets = cutsRemaining > 0 ? getCutTargets(field, nextCutNumber, settings) : null;

  const appsSinceCut = seasonApps.filter((a) => a.date_applied >= windowStart);
  const sinceCutTotals = sumNutrients(appsSinceCut, products);

  // Carryover from before last cut, but within season — P and K only
  let carryover = { p: 0, k: 0 };
  if (lastCut) {
    const preCutApps = seasonApps.filter((a) => a.date_applied < windowStart);
    const preCutTotals = sumNutrients(preCutApps, products);
    let pOff = 0, kOff = 0;
    [...fCuts].sort((a, b) => a.cut_date.localeCompare(b.cut_date)).forEach((c) => {
      const o = getOfftakeForCut(field.cut_profile, c.cut_number, c.yield_class, settings, c.cut_type);
      pOff += o.p2o5; kOff += o.k2o;
    });
    carryover = {
      p: Math.max(0, preCutTotals.p - pOff),
      k: Math.max(0, preCutTotals.k - kOff),
    };
  }

  const availableForNextCut = {
    n: sinceCutTotals.n,
    p: sinceCutTotals.p + carryover.p,
    k: sinceCutTotals.k + carryover.k,
  };

  const seasonTotals = sumNutrients(seasonApps, products);

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
          return `${fmt(a.value, 1)} ${a.unit} · ${field.cut_profile}-cut`;
        })()}
        backHref="/"
      />

      <div className="tabs">
        <Link href={`/fields/${field.id}`} className={`tab ${tab === 'overview' ? 'active' : ''}`} scroll={false}>Overview</Link>
        <Link href={`/fields/${field.id}?tab=season`} className={`tab ${tab === 'season' ? 'active' : ''}`} scroll={false}>This season</Link>
      </div>

      {tab === 'overview' && (
        <div style={{ padding: 16 }}>
          {/* Soil sample */}
          {field.sampled ? (
            <div className="card" style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div className="label" style={{ margin: 0 }}>
                  Last soil sample{field.sample_date ? ` · ${fmtDate(field.sample_date)}` : ''}
                </div>
                <Link
                  href={`/fields/${field.id}/soil`}
                  style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, padding: '6px 10px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Edit3 size={12} /> Update
                </Link>
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
                <Link
                  href={`/fields/${field.id}/soil`}
                  className="btn-amber"
                  style={{ padding: '6px 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Plus size={12} /> Add
                </Link>
              </div>
              {field.notes && <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-soft)' }}>{field.notes}</div>}
            </div>
          )}

          {/* Status of next cut */}
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div className="label" style={{ margin: 0 }}>
                {targets
                  ? <>Building toward cut {nextCutNumber} of {field.cut_profile} · {CUT_TYPE_LABELS[targets.cutType]}</>
                  : <>All {field.cut_profile} cuts taken</>}
              </div>
              <Link
                href={`/fields/${field.id}/plan`}
                style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, padding: '6px 10px', fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Edit3 size={12} /> Plan
              </Link>
            </div>
            {targets && (() => {
              const nView   = displayBagAmount(availableForNextCut.n, settings.bagFertUnit);
              const pView   = displayBagAmount(availableForNextCut.p, settings.bagFertUnit);
              const kView   = displayBagAmount(availableForNextCut.k, settings.bagFertUnit);
              const nTgt    = displayBagAmount(targets.n,    settings.bagFertUnit).value;
              const pTgt    = displayBagAmount(targets.p2o5, settings.bagFertUnit).value;
              const kTgt    = displayBagAmount(targets.k2o,  settings.bagFertUnit).value;
              const pCarry  = displayBagAmount(carryover.p,  settings.bagFertUnit).value;
              const kCarry  = displayBagAmount(carryover.k,  settings.bagFertUnit).value;
              return (
                <>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                    Applied {windowLabel} · target {fmt(targets.yieldDM, 1)} t DM/ha
                  </div>
                  <NutrientBar label="N"    applied={nView.value} target={nTgt} unit={nView.unit} />
                  <NutrientBar label="P₂O₅" applied={pView.value} target={pTgt} unit={pView.unit} carryover={pCarry} />
                  <NutrientBar label="K₂O"  applied={kView.value} target={kTgt} unit={kView.unit} carryover={kCarry} />
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
                  {lastSlurry.rate_value} {lastSlurry.rate_unit}{lastSlurry.method && ` · ${METHOD_LABELS[lastSlurry.method]}`}
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
                  href={`/fields/${field.id}/cut`}
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
            <div className="label" style={{ marginBottom: 10 }}>Field events</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
              {field.last_ploughed ? `Last ploughed: ${fmtDate(field.last_ploughed)}` : 'No ploughing event logged'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {field.last_reseeded ? `Last reseeded: ${fmtDate(field.last_reseeded)}` : 'No reseed event logged'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, fontStyle: 'italic' }}>
              Update via the field's soil sample screen.
            </div>
          </div>
        </div>
      )}

      {tab === 'season' && (
        <div style={{ padding: 16 }}>
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label">
              {seasonLabel} applied{' '}
              <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--muted)' }}>· since {fmtDate(seasonStart)}</span>
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
              {(() => {
                const nView = displayBagAmount(seasonTotals.n, settings.bagFertUnit);
                const pView = displayBagAmount(seasonTotals.p, settings.bagFertUnit);
                const kView = displayBagAmount(seasonTotals.k, settings.bagFertUnit);
                return (
                  <>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>N</div>
                      <div className="nutrient-num" style={{ fontSize: 24, color: 'var(--forest-dark)' }}>{fmt(nView.value)}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{nView.unit} avail</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>P₂O₅</div>
                      <div className="nutrient-num" style={{ fontSize: 24, color: 'var(--forest-dark)' }}>{fmt(pView.value)}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{pView.unit}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>K₂O</div>
                      <div className="nutrient-num" style={{ fontSize: 24, color: 'var(--forest-dark)' }}>{fmt(kView.value)}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{kView.unit}</div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          <NAvailabilityStrip />

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
              node: <ApplicationCard app={a} products={products} settings={settings} fieldId={field.id} />,
            }));
            fCuts.forEach((c) => items.push({
              kind: 'cut', date: c.cut_date, key: `cut-${c.id}`,
              node: <CutEntry cut={c} field={field} settings={settings} />,
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
            href={`/fields/${field.id}/cut`}
            className="btn-amber"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none' }}
          >
            <Scissors size={16} /> Cut
          </Link>
        )}
        <Link
          href={`/fields/${field.id}/log`}
          className="btn-primary"
          style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none' }}
        >
          <Plus size={20} /> Log application
        </Link>
      </div>
    </div>
  );
}
