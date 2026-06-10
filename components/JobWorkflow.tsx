'use client';

import { useState } from 'react';
import { CheckCircle2, Clock } from 'lucide-react';
import { saveJobCompletion, approveJob, reopenJob } from '@/lib/actions';

type FStatus = 'pending' | 'done' | 'partial' | 'skipped';
interface WField {
  id: string; name: string; area: number | null;
  plannedRate: number | null; plannedUnit: string | null;
  status: FStatus; actualRate: number | null;
}
interface Line extends WField { actualStr: string; }

const STATUS_OPTS: { v: FStatus; label: string }[] = [
  { v: 'done', label: 'Done' },
  { v: 'partial', label: 'Part' },
  { v: 'skipped', label: 'Not done' },
];

export function JobWorkflow({
  jobId, status, role, autoLog, rateNoun, hasRate, fields, unitSystem, fmtDateStr, approvedAt,
}: {
  jobId: string;
  status: 'draft' | 'sent' | 'submitted' | 'approved' | 'archived';
  role: 'admin' | 'assignee' | 'viewer';
  autoLog: boolean;
  rateNoun: string | null;
  hasRate: boolean;
  fields: WField[];
  unitSystem: 'acres' | 'hectares';
  fmtDateStr: string | null;
  approvedAt: string | null;
}) {
  const areaUnit = unitSystem === 'acres' ? 'ac' : 'ha';
  const toUnit = (ha: number) => (unitSystem === 'acres' ? ha * 2.47105 : ha);

  const [lines, setLines] = useState<Line[]>(
    fields.map((f) => ({ ...f, actualStr: f.actualRate != null ? String(f.actualRate) : '' })),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setStatus = (id: string, v: FStatus) =>
    setLines((prev) => prev.map((l) => {
      if (l.id !== id) return l;
      const next: Line = { ...l, status: l.status === v ? 'pending' : v };
      // pre-fill the actual rate with the planned rate when first marking done/part
      if ((next.status === 'done' || next.status === 'partial') && next.actualStr.trim() === '' && next.plannedRate != null) {
        next.actualStr = String(next.plannedRate);
      }
      return next;
    }));
  const setActual = (id: string, s: string) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, actualStr: s } : l)));

  const completions = lines.map((l) => ({
    id: l.id,
    status: l.status,
    actual_rate: l.actualStr.trim() === '' ? null : Number(l.actualStr),
    note: null,
  }));
  const anyMarked = lines.some((l) => l.status !== 'pending');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      await saveJobCompletion(fd);
    } catch (err) {
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) setError(err.message);
      setSubmitting(false);
    }
  }

  const StatusPill = ({ s }: { s: FStatus }) => {
    const map: Record<FStatus, { t: string; c: string }> = {
      done: { t: 'Done', c: 'var(--forest-dark)' },
      partial: { t: 'Part done', c: '#b06a37' },
      skipped: { t: 'Not done', c: 'var(--muted)' },
      pending: { t: 'Not marked', c: 'var(--muted)' },
    };
    return <span style={{ fontSize: 12, fontWeight: 700, color: map[s].c }}>{map[s].t}</span>;
  };

  // ----- Approved: read-only summary -----
  if (status === 'approved') {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--forest-soft)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
          <CheckCircle2 size={18} style={{ color: 'var(--forest-dark)' }} />
          <div style={{ fontSize: 13.5, color: 'var(--ink)' }}>Logged{fmtDateStr ? ` on ${fmtDateStr}` : ''}. Records were written to the relevant fields.</div>
        </div>
        {lines.map((l) => (
          <div key={l.id} className="card" style={{ padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{l.name}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {l.area != null ? `${toUnit(l.area).toFixed(2)} ${areaUnit}` : ''}
                {l.actualRate != null && hasRate ? ` · ${l.actualRate} ${l.plannedUnit ?? rateNoun ?? ''}` : ''}
              </div>
            </div>
            <StatusPill s={l.status} />
          </div>
        ))}
      </div>
    );
  }

  // ----- Submitted, admin: review + approve -----
  if (status === 'submitted' && role === 'admin') {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
          <Clock size={17} style={{ color: '#b06a37' }} />
          <div style={{ fontSize: 13.5, color: 'var(--ink)' }}>Submitted — review and approve to log the records.</div>
        </div>
        {lines.map((l) => (
          <div key={l.id} className="card" style={{ padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{l.name}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {l.area != null ? `${toUnit(l.area).toFixed(2)} ${areaUnit}` : ''}
                {l.actualRate != null && hasRate ? ` · applied ${l.actualRate} ${l.plannedUnit ?? rateNoun ?? ''}` : ''}
              </div>
            </div>
            <StatusPill s={l.status} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <form action={reopenJob} style={{ flex: 1 }}>
            <input type="hidden" name="id" value={jobId} />
            <button type="submit" className="btn-ghost" style={{ width: '100%' }}>Send back</button>
          </form>
          <form action={approveJob} style={{ flex: 2 }}>
            <input type="hidden" name="id" value={jobId} />
            <button type="submit" className="btn-primary" style={{ width: '100%' }}>Approve &amp; log</button>
          </form>
        </div>
      </div>
    );
  }

  // ----- Submitted, non-admin: waiting -----
  if (status === 'submitted') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px' }}>
        <Clock size={17} style={{ color: '#b06a37' }} />
        <div style={{ fontSize: 13.5, color: 'var(--ink)' }}>Submitted — waiting for the farm to approve.</div>
      </div>
    );
  }

  // ----- Sent: completion form (assignee or admin) -----
  if (role === 'viewer') {
    return <div style={{ fontSize: 13, color: 'var(--muted)' }}>This job hasn&apos;t been sent to you.</div>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="completions" value={JSON.stringify(completions)} />
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>Tick off each field as you go, then submit.</div>
      {lines.map((l) => (
        <div key={l.id} className="card" style={{ padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{l.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {l.area != null ? `${toUnit(l.area).toFixed(2)} ${areaUnit}` : ''}
              {l.plannedRate != null && hasRate ? ` · ${l.plannedRate} ${l.plannedUnit ?? rateNoun ?? ''}` : ''}
            </div>
          </div>
          <div className="toggle-group">
            {STATUS_OPTS.map((o) => (
              <button key={o.v} type="button" className={`toggle-btn ${l.status === o.v ? 'active' : ''}`} onClick={() => setStatus(l.id, o.v)}>{o.label}</button>
            ))}
          </div>
          {hasRate && (l.status === 'done' || l.status === 'partial') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Applied</span>
              <input type="number" className="input" inputMode="decimal" step="any" min="0" value={l.actualStr} onChange={(e) => setActual(l.id, e.target.value)} style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--muted)', width: 60 }}>{l.plannedUnit ?? rateNoun ?? ''}</span>
            </div>
          )}
        </div>
      ))}
      {error && <div style={{ margin: '4px 0 10px', padding: 10, background: 'var(--red-soft, #ffe5e5)', color: 'var(--red, #b00)', fontSize: 13, borderRadius: 6 }}>{error}</div>}
      <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: 4 }} disabled={submitting || !anyMarked}>
        {submitting ? 'Saving…' : autoLog ? 'Submit & log' : 'Submit for approval'}
      </button>
      {!autoLog && <div style={{ fontSize: 11.5, color: 'var(--muted)', textAlign: 'center', marginTop: 8 }}>This will be sent to the farm to approve before it&apos;s logged.</div>}
    </form>
  );
}
