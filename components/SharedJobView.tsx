'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Lock } from 'lucide-react';
import { loadSharedJob, submitSharedJob } from '@/lib/actions';
import { JobFieldsMap } from './JobFieldsMap';

type FStatus = 'pending' | 'done' | 'partial' | 'skipped';
type Phase = 'loading' | 'needpin' | 'badpin' | 'notfound' | 'expired' | 'ready' | 'submitted';

interface SField { id: string; field_name: string; boundary: unknown | null; area_ha: number | null; planned_rate_value: number | null; planned_rate_unit: string | null; status: string; actual_rate_value: number | null; }
interface SJob { id: string; title: string; job_type: string; farm_name: string | null; instruction: string | null; product_name: string | null; rate_value: number | null; rate_unit: string | null; rate_noun: string | null; water_l_per_ha: number | null; spray_spec: { name: string; l_per_ha: number | null }[] | null; notes: string | null; due_date: string | null; contractor_label: string | null; status: string; }
interface Line extends SField { uiStatus: FStatus; actualStr: string; }

const OPTS: { v: FStatus; label: string }[] = [{ v: 'done', label: 'Done' }, { v: 'partial', label: 'Part' }, { v: 'skipped', label: 'Not done' }];

export function SharedJobView({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [pin, setPin] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [job, setJob] = useState<SJob | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(withPin?: string) {
    const res = await loadSharedJob(token, withPin);
    if (res.status === 'ok' && res.job) {
      setJob(res.job);
      setLines((res.fields ?? []).map((f) => ({ ...f, uiStatus: (f.status as FStatus) ?? 'pending', actualStr: f.actual_rate_value != null ? String(f.actual_rate_value) : '' })));
      if (res.job.status === 'submitted') setPhase('submitted'); else setPhase('ready');
      if (withPin) setPin(withPin);
    } else if (res.status === 'needpin') setPhase('needpin');
    else if (res.status === 'badpin') setPhase('badpin');
    else if (res.status === 'expired') setPhase('expired');
    else setPhase('notfound');
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  const isApp = job?.job_type && ['slurry', 'manure', 'fertiliser', 'lime'].includes(job.job_type);
  const hasRate = !!isApp || job?.job_type === 'spray';
  const instructionLine = (() => {
    if (!job) return '';
    if (isApp) return `${job.product_name ?? 'Product'}${job.rate_value != null ? ` @ ${job.rate_value} ${job.rate_noun ?? ''}` : ''}`;
    if (job.job_type === 'spray') {
      const mix = (job.spray_spec ?? []).map((s) => `${s.name}${s.l_per_ha != null ? ` @ ${s.l_per_ha} L/ha` : ''}`).join(' + ');
      return `${mix || 'Spray'}${job.water_l_per_ha != null ? ` · ${job.water_l_per_ha} L/ha water` : ''}`;
    }
    return job.instruction ?? '';
  })();

  const setStatus = (id: string, v: FStatus) =>
    setLines((prev) => prev.map((l) => {
      if (l.id !== id) return l;
      const next = { ...l, uiStatus: l.uiStatus === v ? ('pending' as FStatus) : v };
      if ((next.uiStatus === 'done' || next.uiStatus === 'partial') && next.actualStr.trim() === '' && next.planned_rate_value != null) next.actualStr = String(next.planned_rate_value);
      return next;
    }));
  const setActual = (id: string, s: string) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, actualStr: s } : l)));
  const anyMarked = lines.some((l) => l.uiStatus !== 'pending');

  async function submit() {
    setError(null);
    setSubmitting(true);
    const completions = lines.map((l) => ({ id: l.id, status: l.uiStatus, actual_rate: l.actualStr.trim() === '' ? null : Number(l.actualStr), note: null }));
    const res = await submitSharedJob(token, pin, JSON.stringify(completions));
    if (res.ok) setPhase('submitted');
    else { setError(res.error ?? 'Could not submit'); setSubmitting(false); }
  }

  const card: React.CSSProperties = { background: 'var(--card, #fff)', border: '1px solid var(--line, #e5e0d5)', borderRadius: 10, padding: 14, marginBottom: 12 };
  const wrap: React.CSSProperties = { padding: 16, minHeight: '100vh' };

  if (phase === 'loading') return <div style={wrap}><div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading job…</div></div>;

  if (phase === 'notfound') return <div style={wrap}><div style={card}><div style={{ fontWeight: 700, marginBottom: 6 }}>Link not found</div><div style={{ fontSize: 13, color: 'var(--muted)' }}>This job link is invalid or has been revoked. Ask the farm for a new one.</div></div></div>;
  if (phase === 'expired') return <div style={wrap}><div style={card}><div style={{ fontWeight: 700, marginBottom: 6 }}>Link expired</div><div style={{ fontSize: 13, color: 'var(--muted)' }}>This job link has expired. Ask the farm to send a fresh link.</div></div></div>;

  if (phase === 'needpin' || phase === 'badpin') {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center' }}>
          <Lock size={22} style={{ color: 'var(--forest, #2f7d6a)' }} />
          <div style={{ fontWeight: 700, margin: '8px 0 4px' }}>Enter PIN</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>This job sheet is PIN-protected.</div>
          {phase === 'badpin' && <div style={{ fontSize: 13, color: '#b00', marginBottom: 10 }}>Wrong PIN — try again.</div>}
          <input type="text" inputMode="numeric" value={pinInput} onChange={(e) => setPinInput(e.target.value)} placeholder="PIN" className="input" style={{ textAlign: 'center', marginBottom: 10 }} />
          <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={() => { setPhase('loading'); load(pinInput); }}>View job</button>
        </div>
      </div>
    );
  }

  if (phase === 'submitted') {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center' }}>
          <CheckCircle2 size={26} style={{ color: 'var(--forest-dark, #1b5e4a)' }} />
          <div style={{ fontWeight: 700, margin: '8px 0 4px' }}>Submitted — thank you</div>
          <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>Your update has been sent to the farm. They&apos;ll review and confirm it. You can close this page.</div>
        </div>
      </div>
    );
  }

  // ready
  return (
    <div style={wrap}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--forest, #2f7d6a)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>Job sheet</div>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink, #2b2b2b)', margin: '0 0 2px' }}>{job?.title}</h1>
      {job?.farm_name && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--forest, #2f7d6a)', marginBottom: 12 }}>From {job.farm_name}</div>}

      <div style={card}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>What to do</div>
        <div style={{ fontSize: 15, color: 'var(--ink, #2b2b2b)', lineHeight: 1.45 }}>{instructionLine || '—'}</div>
        {job?.notes && <div style={{ fontSize: 13, color: 'var(--ink-soft, #555)', marginTop: 8 }}>{job.notes}</div>}
        {job?.due_date && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>Due {job.due_date}</div>}
      </div>

      {lines.some((l) => l.boundary) && <div style={{ marginBottom: 12 }}><JobFieldsMap fields={lines.map((l) => ({ field_name: l.field_name, boundary: l.boundary }))} /></div>}

      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', margin: '4px 0 8px' }}>Fields — tick off as you go</div>
      {lines.map((l, i) => (
        <div key={l.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink, #2b2b2b)' }}><span style={{ display: 'inline-flex', width: 20, height: 20, borderRadius: '50%', background: 'var(--forest, #15803d)', color: '#fff', fontSize: 11, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>{i + 1}</span>{l.field_name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {l.area_ha != null ? `${l.area_ha.toFixed(2)} ha` : ''}{l.planned_rate_value != null && hasRate ? ` · ${l.planned_rate_value} ${l.planned_rate_unit ?? job?.rate_noun ?? ''}` : ''}
            </div>
          </div>
          <div className="toggle-group">
            {OPTS.map((o) => (
              <button key={o.v} type="button" className={`toggle-btn ${l.uiStatus === o.v ? 'active' : ''}`} onClick={() => setStatus(l.id, o.v)}>{o.label}</button>
            ))}
          </div>
          {hasRate && (l.uiStatus === 'done' || l.uiStatus === 'partial') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Applied</span>
              <input type="number" inputMode="decimal" step="any" min="0" className="input" value={l.actualStr} onChange={(e) => setActual(l.id, e.target.value)} style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--muted)', width: 56 }}>{l.planned_rate_unit ?? job?.rate_noun ?? ''}</span>
            </div>
          )}
        </div>
      ))}

      {error && <div style={{ margin: '4px 0 10px', padding: 10, background: '#ffe5e5', color: '#b00', fontSize: 13, borderRadius: 6 }}>{error}</div>}
      <button type="button" className="btn-primary" style={{ width: '100%', marginTop: 4 }} disabled={submitting || !anyMarked} onClick={submit}>{submitting ? 'Sending…' : 'Submit to farm'}</button>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', textAlign: 'center', marginTop: 8, paddingBottom: 24 }}>The farm will review and confirm before it&apos;s recorded.</div>
    </div>
  );
}
