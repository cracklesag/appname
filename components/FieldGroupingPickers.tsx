'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AllocationType, Agreement } from '@/lib/types';
import { SCHEME_LABEL } from '@/lib/agreements';
import { setFieldAllocationType, setFieldAgreements } from '@/lib/actions';

/** Allocation-type select — auto-submits and refreshes so the cap updates. */
export function FieldTypePicker({
  fieldId, current, types,
}: {
  fieldId: string;
  current: string | null;
  types: AllocationType[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function change(next: string) {
    if (next === value) return;
    const prev = value;
    setValue(next);
    setError(null);
    const fd = new FormData();
    fd.set('field_id', fieldId);
    fd.set('allocation_type_id', next);
    startTransition(async () => {
      try { await setFieldAllocationType(fd); router.refresh(); }
      catch (e) { if (e instanceof Error) setError(e.message); setValue(prev); }
    });
  }

  return (
    <div>
      <select className="select" value={value} onChange={(e) => change(e.target.value)} disabled={isPending} style={{ fontSize: 13 }}>
        <option value="">— Untyped —</option>
        {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      {isPending && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>Saving…</div>}
      {error && <div style={{ fontSize: 11, color: 'var(--red, #b85b3a)', marginTop: 4 }}>{error}</div>}
    </div>
  );
}

/** Agreements multi-select — collapsible list of tickboxes with a Save. */
export function FieldAgreementsPicker({
  fieldId, current, agreements,
}: {
  fieldId: string;
  current: string[];
  agreements: Agreement[];
}) {
  const router = useRouter();
  const initial = useMemo(() => new Set(current), [current]);
  const [selected, setSelected] = useState<Set<string>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const changed = useMemo(() => {
    if (selected.size !== initial.size) return true;
    for (const id of selected) if (!initial.has(id)) return true;
    return false;
  }, [selected, initial]);

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set('field_id', fieldId);
    fd.set('agreement_ids', Array.from(selected).join(','));
    startTransition(async () => {
      try { await setFieldAgreements(fd); router.refresh(); }
      catch (e) { if (e instanceof Error) setError(e.message); }
    });
  }

  if (agreements.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--muted)' }}>No agreements yet — <a href="/settings/agreements" style={{ color: 'var(--forest-dark, #3d5b29)' }}>add one in settings</a>.</div>;
  }

  const currentLabels = agreements.filter((a) => initial.has(a.id)).map((a) => a.code);

  return (
    <details>
      <summary style={{ cursor: 'pointer', fontSize: 13, listStyle: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ color: currentLabels.length ? 'var(--ink)' : 'var(--muted)' }}>
          {currentLabels.length ? currentLabels.join(', ') : 'None — tap to add'}
        </span>
        <span style={{ fontSize: 12, color: 'var(--forest-dark)', fontWeight: 700 }}>Edit</span>
      </summary>
      <div style={{ marginTop: 10 }}>
        {agreements.map((a) => (
          <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} disabled={isPending} style={{ width: 16, height: 16, flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--forest-dark)', background: 'var(--forest-soft)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>{a.code}</span>
            <span style={{ fontSize: 12.5, minWidth: 0 }}>{a.name} <span style={{ color: 'var(--muted)' }}>· {SCHEME_LABEL[a.scheme]}</span></span>
          </label>
        ))}
        {error && <div style={{ fontSize: 11, color: 'var(--red, #b85b3a)', marginTop: 4 }}>{error}</div>}
        <button type="button" className="btn-primary" onClick={save} disabled={!changed || isPending} style={{ marginTop: 8, fontSize: 12, padding: '7px 14px', opacity: !changed ? 0.5 : 1 }}>
          {isPending ? 'Saving…' : 'Save agreements'}
        </button>
      </div>
    </details>
  );
}
