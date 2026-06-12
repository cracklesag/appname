'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, Droplet, Gauge, BadgeCheck } from 'lucide-react';
import { FieldGrazingHistory, BlockGrazingSummary } from '@/lib/rules';

type SortKey = 'grown' | 'n' | 'efficiency' | 'name';
type View = 'field' | 'block';

export function GrazingHistoryShell({
  history, blocks, seasonLabel, fromHref,
}: {
  history: FieldGrazingHistory[];
  blocks: BlockGrazingSummary[];
  seasonLabel: string;
  fromHref: string;
}) {
  const [view, setView] = useState<View>('field');
  const [sort, setSort] = useState<SortKey>('grown');
  const [groupId, setGroupId] = useState<string | 'all'>('all');

  const groupChips = useMemo(() => {
    const chips: { v: string | 'all'; label: string }[] = [{ v: 'all', label: 'All' }];
    for (const b of blocks) chips.push({ v: b.groupId ?? 'ungrouped', label: b.groupName });
    return chips;
  }, [blocks]);

  const filteredHistory = useMemo(() => {
    if (groupId === 'all') return history;
    if (groupId === 'ungrouped') return history.filter((h) => !h.groupId);
    return history.filter((h) => h.groupId === groupId);
  }, [history, groupId]);

  const sortedFields = useMemo(() => {
    const arr = [...filteredHistory];
    arr.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'n') return b.nKgPerHa - a.nKgPerHa;
      if (sort === 'efficiency') return (b.dmPerKgN ?? -1) - (a.dmPerKgN ?? -1);
      return (b.grassGrownKgDmHa ?? -1) - (a.grassGrownKgDmHa ?? -1);
    });
    return arr;
  }, [filteredHistory, sort]);

  const anyData = history.some((h) => h.readings > 0 || h.grazings > 0);
  const totalN = filteredHistory.reduce((s, h) => s + h.nKgPerHa, 0);

  return (
    <div style={{ paddingBottom: 60 }}>
      <div style={{ background: 'linear-gradient(135deg, #3d5b29 0%, #2c4220 100%)', color: 'var(--brand-cream, #efe7d6)', padding: '18px 16px 20px' }}>
        <Link href={fromHref} className="hero-back" style={{ color: 'rgba(239,231,214,0.85)' }}>
          <ArrowLeft size={15} /> Back
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 3px' }}>Field history</h1>
        <p style={{ fontSize: 12.5, color: 'rgba(239,231,214,0.8)', margin: 0 }}>
          {seasonLabel} &middot; nitrogen in, grass grown out
        </p>
      </div>

      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {(['field', 'block'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{
                flex: 1, padding: '8px', fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: 'pointer',
                background: view === v ? 'var(--forest-dark)' : 'var(--card)',
                color: view === v ? 'var(--brand-cream)' : 'var(--ink-soft)',
                border: `1px solid ${view === v ? 'var(--forest)' : 'var(--line)'}`,
              }}
            >
              {v === 'field' ? 'By field' : 'By block'}
            </button>
          ))}
        </div>

        {!anyData && (
          <div style={{ background: '#F4EFE2', border: '1px solid #E4D9BD', borderRadius: 10, padding: '10px 12px', fontSize: 11.5, color: '#6B5D34', lineHeight: 1.5, marginBottom: 14 }}>
            Nitrogen totals come from your logged applications. For grass grown, log grazings (pre &amp; post
            cover) or plate-meter readings on the grazing screen &mdash; a grazing or two and the measured
            output shows here.
          </div>
        )}

        {view === 'field' ? (
          <>
            {groupChips.length > 1 && (
              <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 4, marginBottom: 10 }}>
                {groupChips.map((c) => (
                  <button
                    key={String(c.v)}
                    type="button"
                    onClick={() => setGroupId(c.v)}
                    style={{
                      flexShrink: 0, whiteSpace: 'nowrap',
                      background: groupId === c.v ? 'var(--forest-dark)' : 'var(--card)',
                      color: groupId === c.v ? 'var(--brand-cream)' : 'var(--ink-soft)',
                      border: `1px solid ${groupId === c.v ? 'var(--forest)' : 'var(--line)'}`,
                      borderRadius: 999, padding: '6px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 4, marginBottom: 12 }}>
              {([['grown', 'Grass grown'], ['n', 'N applied'], ['efficiency', 'Efficiency'], ['name', 'Name']] as [SortKey, string][]).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSort(k)}
                  style={{
                    flexShrink: 0, whiteSpace: 'nowrap',
                    background: sort === k ? 'var(--paper-deep, #ece4d2)' : 'transparent',
                    color: 'var(--ink-soft)',
                    border: `1px solid ${sort === k ? 'var(--ink-soft)' : 'var(--line)'}`,
                    borderRadius: 999, padding: '5px 11px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {sortedFields.map((h) => (
              <div key={h.fieldId} className="card" style={{ padding: 13, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{h.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                      {h.areaHa.toFixed(1)} ha{h.groupName ? ` \u00b7 ${h.groupName}` : ''}
                      {h.grazings > 0 ? ` \u00b7 ${h.grazings} grazing${h.grazings === 1 ? '' : 's'}` : ''}
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
                    value={h.grassGrownKgDmHa != null ? h.grassGrownKgDmHa.toLocaleString() : '\u2014'}
                    unit={h.grassGrownKgDmHa != null ? 'kg DM/ha' : ''}
                    badge={h.grassGrownKgDmHa != null ? (h.measured ? 'measured' : 'estimate') : undefined}
                  />
                  {h.grazedOfftakeKgDmHa != null && (
                    <Metric label="Grazed off" value={h.grazedOfftakeKgDmHa.toLocaleString()} unit="kg DM/ha" />
                  )}
                  {h.avgGrowthRate != null && (
                    <Metric icon={<Gauge size={13} />} label="Avg growth" value={`${h.avgGrowthRate}`} unit="kg DM/ha/day" />
                  )}
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            {blocks.map((b) => (
              <div key={String(b.groupId)} className="card" style={{ padding: 14, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{b.groupName}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                      {b.fields} field{b.fields === 1 ? '' : 's'} &middot; {b.areaHa} ha
                    </div>
                  </div>
                  {b.dmPerKgN != null && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--forest-dark)', background: 'var(--forest-soft, #e7efe2)', padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap' }}>
                      {b.dmPerKgN} kg DM/kg N
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
                  <Metric icon={<Droplet size={13} />} label="N applied" value={`${b.nKgPerHa}`} unit="kg/ha" sub="area-weighted" />
                  <Metric
                    icon={<TrendingUp size={13} />}
                    label="Grass grown"
                    value={b.grassGrownKgDmHa != null ? b.grassGrownKgDmHa.toLocaleString() : '\u2014'}
                    unit={b.grassGrownKgDmHa != null ? 'kg DM/ha' : ''}
                    badge={b.grassGrownKgDmHa != null ? (b.measured ? 'measured' : 'estimate') : undefined}
                    sub="area-weighted"
                  />
                </div>
              </div>
            ))}
          </>
        )}

        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginTop: 8 }}>
          {view === 'field' ? <>Total nitrogen across these fields: <strong>{totalN.toLocaleString()} kg/ha</strong> (summed).{' '}</> : null}
          A <strong>measured</strong> figure comes from logged grazings (pre-grazing cover minus residual, plus
          the change in standing cover) &mdash; the proper offtake. An <strong>estimate</strong> is the sum of
          rises between plate readings, used only when there are no grazings to measure from.
        </div>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, unit, sub, badge }: { icon?: React.ReactNode; label: string; value: string; unit: string; sub?: string; badge?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 3 }}>
        {icon}{label}
      </div>
      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)' }}>
        {value} {unit && <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--muted)' }}>{unit}</span>}
      </div>
      {badge && (
        <div style={{ fontSize: 9.5, fontWeight: 700, color: badge === 'measured' ? 'var(--forest)' : 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 2, marginTop: 1 }}>
          {badge === 'measured' && <BadgeCheck size={11} />}{badge}
        </div>
      )}
      {sub && !badge && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}
