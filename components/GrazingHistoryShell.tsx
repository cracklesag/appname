'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, Droplet, Gauge } from 'lucide-react';
import { FieldGrazingHistory } from '@/lib/rules';

type SortKey = 'grown' | 'n' | 'efficiency' | 'name';

export function GrazingHistoryShell({
  history, seasonLabel, fromHref,
}: {
  history: FieldGrazingHistory[];
  seasonLabel: string;
  fromHref: string;
}) {
  const [sort, setSort] = useState<SortKey>('grown');

  const sorted = useMemo(() => {
    const arr = [...history];
    arr.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'n') return b.nKgPerHa - a.nKgPerHa;
      if (sort === 'efficiency') return (b.dmPerKgN ?? -1) - (a.dmPerKgN ?? -1);
      // grown — nulls last
      return (b.grassGrownKgDmHa ?? -1) - (a.grassGrownKgDmHa ?? -1);
    });
    return arr;
  }, [history, sort]);

  const anyReadings = history.some((h) => h.readings > 0);
  const totalN = history.reduce((s, h) => s + h.nKgPerHa, 0);

  return (
    <div style={{ paddingBottom: 60 }}>
      <div style={{ background: 'linear-gradient(135deg, #3d5b29 0%, #2c4220 100%)', color: 'var(--brand-cream, #efe7d6)', padding: '18px 16px 20px' }}>
        <Link href={fromHref} className="hero-back" style={{ color: 'rgba(239,231,214,0.85)' }}>
          <ArrowLeft size={15} /> Back
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 3px' }}>Field history</h1>
        <p style={{ fontSize: 12.5, color: 'rgba(239,231,214,0.8)', margin: 0 }}>
          {seasonLabel} · nitrogen applied and grass grown by field
        </p>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {/* Sort chips */}
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 4, marginBottom: 12 }}>
          {([['grown', 'Grass grown'], ['n', 'N applied'], ['efficiency', 'Efficiency'], ['name', 'Name']] as [SortKey, string][]).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSort(k)}
              style={{
                flexShrink: 0, whiteSpace: 'nowrap',
                background: sort === k ? 'var(--forest)' : 'var(--card)',
                color: sort === k ? '#fff' : 'var(--ink-soft)',
                border: `1px solid ${sort === k ? 'var(--forest)' : 'var(--line)'}`,
                borderRadius: 999, padding: '6px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {!anyReadings && (
          <div style={{ background: '#F4EFE2', border: '1px solid #E4D9BD', borderRadius: 10, padding: '10px 12px', fontSize: 11.5, color: '#6B5D34', lineHeight: 1.5, marginBottom: 14 }}>
            Nitrogen totals come from your logged applications. To see grass grown and performance, log a
            plate-meter cover reading for a field now and then on the grazing screen — two readings or more
            and the growth shows here.
          </div>
        )}

        {/* Per-field cards */}
        {sorted.map((h) => (
          <div key={h.fieldId} className="card" style={{ padding: 13, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{h.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                  {h.areaHa.toFixed(1)} ha{h.groupName ? ` · ${h.groupName}` : ''}
                </div>
              </div>
              {h.dmPerKgN != null && (
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--forest-dark)', background: 'var(--forest-soft, #e7efe2)', padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap' }}>
                  {h.dmPerKgN} kg DM/kg N
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
              <Metric icon={<Droplet size={13} />} label="N applied" value={`${h.nKgPerHa}`} unit="kg/ha" />
              <Metric
                icon={<TrendingUp size={13} />}
                label="Grass grown"
                value={h.grassGrownKgDmHa != null ? `${h.grassGrownKgDmHa.toLocaleString()}` : '—'}
                unit={h.grassGrownKgDmHa != null ? 'kg DM/ha' : ''}
                sub={h.readings > 0 ? `${h.readings} reading${h.readings === 1 ? '' : 's'}` : 'no readings'}
              />
              {h.avgGrowthRate != null && (
                <Metric icon={<Gauge size={13} />} label="Avg growth" value={`${h.avgGrowthRate}`} unit="kg DM/ha/day" />
              )}
              {h.latestCover != null && (
                <Metric label="Latest cover" value={`${h.latestCover.toLocaleString()}`} unit="kg DM/ha" />
              )}
            </div>
          </div>
        ))}

        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginTop: 8 }}>
          Total nitrogen across all fields this season: <strong>{totalN.toLocaleString()} kg/ha</strong> (summed).
          “Grass grown” is the sum of the rises between consecutive cover readings — a drop means the paddock
          was grazed or cut, which can’t be measured across, so those gaps are skipped. It’s an indicative
          figure to compare fields, not an exact yield.
        </div>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, unit, sub }: { icon?: React.ReactNode; label: string; value: string; unit: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 3 }}>
        {icon}{label}
      </div>
      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)' }}>
        {value} {unit && <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--muted)' }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}
