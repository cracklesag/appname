import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, Plus, FileUp } from 'lucide-react';
import { Header } from '@/components/Header';
import { MiniBar } from '@/components/NutrientBar';
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
  getSeasonLabel,
  getSeasonStart,
  soilMetricColor,
  sumNutrients,
  displayBagAmount,
  displayFieldArea,
  fmt,
} from '@/lib/rules';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
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
        <div style={{ marginTop: 4 }}>
          {fields.map((f) => {
            const fApps = applications.filter((a) => a.field_id === f.id);
            const fCuts = cuts
              .filter((c) => c.field_id === f.id && c.cut_date >= seasonStart);
            const cutsDone = fCuts.length;
            const lastCut = fCuts[0];
            const windowStart = lastCut ? lastCut.cut_date : seasonStart;
            const sinceCutApps = fApps.filter((a) => a.date_applied >= windowStart);
            const sinceTotals = sumNutrients(sinceCutApps, products);
            const nextCut = Math.min(cutsDone + 1, f.cut_profile);
            const targets = cutsDone < f.cut_profile ? getCutTargets(f, nextCut, settings) : null;

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
                  {targets ? (
                    <>
                      Building toward <strong style={{ color: 'var(--forest-dark)' }}>cut {nextCut}</strong>
                      {' · '}
                      {lastCut ? `since cut ${lastCut.cut_number} on ${fmtDateShort(lastCut.cut_date)}` : 'since season start'}
                    </>
                  ) : (
                    <>All {f.cut_profile} cuts taken</>
                  )}
                </div>

                {targets && (() => {
                  const nView = displayBagAmount(sinceTotals.n,  settings.bagFertUnit);
                  const pView = displayBagAmount(sinceTotals.p,  settings.bagFertUnit);
                  const kView = displayBagAmount(sinceTotals.k,  settings.bagFertUnit);
                  const nTgt  = displayBagAmount(targets.n,      settings.bagFertUnit).value;
                  const pTgt  = displayBagAmount(targets.p2o5,   settings.bagFertUnit).value;
                  const kTgt  = displayBagAmount(targets.k2o,    settings.bagFertUnit).value;
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
