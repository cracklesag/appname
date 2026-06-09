'use client';

import { useMemo, useState } from 'react';
import { Clock, MapPin } from 'lucide-react';
import type { TimesheetJob } from '@/lib/data';
import { jobTypeDef } from '@/lib/jobTypes';

const HA_TO_AC = 2.47105;
type Period = 'week' | 'month' | 'season' | 'year' | 'all';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'season', label: 'Season' }, { id: 'year', label: 'Year' }, { id: 'all', label: 'All' },
];

function startOf(period: Period): Date | null {
  const now = new Date();
  if (period === 'all') return null;
  if (period === 'week') { const d = new Date(now); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); d.setHours(0, 0, 0, 0); return d; }
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === 'year') return new Date(now.getFullYear(), 0, 1);
  // season: Swardly's grass year starts 1 Oct
  const startYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(startYear, 9, 1);
}

function fmtMins(m: number) { const h = Math.floor(m / 60); const mm = m % 60; return h > 0 ? `${h}h ${mm}m` : `${mm}m`; }
function fmtDate(iso: string) { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch { return ''; } }

export function TimesheetView({ jobs, unitSystem }: { jobs: TimesheetJob[]; unitSystem: 'acres' | 'hectares' }) {
  const [period, setPeriod] = useState<Period>('season');
  const [farm, setFarm] = useState<string>('all');
  const acres = unitSystem === 'acres';
  const area = (ha: number) => acres ? `${(ha * HA_TO_AC).toFixed(1)} ac` : `${ha.toFixed(1)} ha`;

  const farms = useMemo(() => Array.from(new Set(jobs.map((j) => j.farm_name).filter((f): f is string => !!f))).sort(), [jobs]);

  const filtered = useMemo(() => {
    const start = startOf(period);
    return jobs.filter((j) => {
      if (farm !== 'all' && (j.farm_name ?? '') !== farm) return false;
      if (start && new Date(j.work_date).getTime() < start.getTime()) return false;
      return true;
    });
  }, [jobs, period, farm]);

  const totals = useMemo(() => {
    let mins = 0, ha = 0;
    const byType = new Map<string, number>();
    for (const j of filtered) { mins += j.work_minutes ?? 0; ha += j.area_done_ha; byType.set(j.job_type, (byType.get(j.job_type) ?? 0) + j.area_done_ha); }
    return { mins, ha, count: filtered.length, byType };
  }, [filtered]);

  // group by farm
  const groups = useMemo(() => {
    const m = new Map<string, TimesheetJob[]>();
    for (const j of filtered) { const k = j.farm_name ?? 'Unassigned'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(j); }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const rangeLabel = (() => { const s = startOf(period); return s ? `since ${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'all time'; })();

  return (
    <div>
      {/* period chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {PERIODS.map((p) => (
          <button key={p.id} type="button" onClick={() => setPeriod(p.id)} className={`toggle-btn ${period === p.id ? 'active' : ''}`} style={{ flex: '0 0 auto', padding: '7px 14px' }}>{p.label}</button>
        ))}
      </div>
      {farms.length > 0 && (
        <select className="input" value={farm} onChange={(e) => setFarm(e.target.value)} style={{ marginBottom: 12 }}>
          <option value="all">All farms</option>
          {farms.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      )}

      {/* summary */}
      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>{rangeLabel}</div>
        <div style={{ display: 'flex', gap: 18 }}>
          <div><div style={{ fontSize: 22, fontWeight: 800, color: 'var(--forest-dark)' }}>{totals.count}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>jobs</div></div>
          <div><div style={{ fontSize: 22, fontWeight: 800, color: 'var(--forest-dark)' }}>{fmtMins(totals.mins)}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>logged</div></div>
          <div><div style={{ fontSize: 22, fontWeight: 800, color: 'var(--forest-dark)' }}>{area(totals.ha)}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>covered</div></div>
        </div>
        {totals.byType.size > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
            {Array.from(totals.byType.entries()).filter(([, ha]) => ha > 0).map(([t, ha]) => (
              <span key={t} style={{ fontSize: 12, background: 'var(--forest-soft)', color: 'var(--forest-dark)', padding: '3px 9px', borderRadius: 99 }}>{jobTypeDef(t)?.label ?? t} · {area(ha)}</span>
            ))}
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No completed jobs in this period.</div>
      ) : (
        groups.map(([farmName, items]) => {
          const gMins = items.reduce((s, j) => s + (j.work_minutes ?? 0), 0);
          const gHa = items.reduce((s, j) => s + j.area_done_ha, 0);
          return (
            <div key={farmName} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 2px 6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}><MapPin size={14} style={{ color: 'var(--forest)' }} />{farmName}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtMins(gMins)} · {area(gHa)}</div>
              </div>
              {items.map((j) => (
                <div key={j.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{j.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{jobTypeDef(j.job_type)?.label ?? j.job_type} · {fmtDate(j.work_date)} · {j.field_count} field{j.field_count === 1 ? '' : 's'}{j.status === 'submitted' ? ' · awaiting approval' : ''}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={12} style={{ color: 'var(--muted)' }} />{j.work_minutes ? fmtMins(j.work_minutes) : '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{area(j.area_done_ha)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}
