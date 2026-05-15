import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
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
} from '@/lib/rules';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [fields, products, applications, cuts, settings] = await Promise.all([
    loadFields(),
    loadAllProducts(),
    loadAllApplications(),
    loadAllCuts(),
    loadSettings(),
  ]);

  const seasonStart = getSeasonStart();
  const seasonLabel = getSeasonLabel();

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Fields" subtitle={`APP_NAME · ${seasonLabel}`} />
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
                      {f.acres} ac · {f.cut_profile} cut
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

                {targets && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
                    <MiniBar label="N" applied={sinceTotals.n} target={targets.n} />
                    <MiniBar label="P" applied={sinceTotals.p} target={targets.p2o5} />
                    <MiniBar label="K" applied={sinceTotals.k} target={targets.k2o} />
                  </div>
                )}
              </Link>
            );
          })}

          {fields.length === 0 && (
            <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
              No fields yet. Run the seed script to load Mill Farm data, or add fields from Settings.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
