'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { Field } from '@/lib/types';
import { setAgreementMembership } from '@/lib/actions';
import { fmt } from '@/lib/rules';

/**
 * Set which fields are in one agreement. Agreements are many-to-many, so there's
 * no "move" — a field can be in several. Members pre-ticked; commits the whole
 * set via setAgreementMembership.
 */
export function AgreementMembershipEditor({
  agreementId, agreementName, fields, memberFieldIds,
}: {
  agreementId: string;
  agreementName: string;
  fields: Field[];
  memberFieldIds: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initial = useMemo(() => new Set(memberFieldIds), [memberFieldIds]);
  const [selected, setSelected] = useState<Set<string>>(initial);

  const sorted = useMemo(() => {
    const s = [...fields].sort((a, b) => a.name.localeCompare(b.name));
    return [...s.filter((f) => initial.has(f.id)), ...s.filter((f) => !initial.has(f.id))];
  }, [fields, initial]);

  const { added, removed, hasChanges } = useMemo(() => {
    let added = 0, removed = 0;
    for (const id of selected) if (!initial.has(id)) added++;
    for (const id of initial) if (!selected.has(id)) removed++;
    return { added, removed, hasChanges: added > 0 || removed > 0 };
  }, [selected, initial]);

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set('agreement_id', agreementId);
    fd.set('field_ids', Array.from(selected).join(','));
    startTransition(async () => {
      try { await setAgreementMembership(fd); router.refresh(); }
      catch (e) { if (e instanceof Error) setError(e.message); }
    });
  }

  return (
    <div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '4px 0 12px', lineHeight: 1.5 }}>
        Tick the fields covered by <strong style={{ color: 'var(--ink)' }}>{agreementName}</strong>. A field can be in
        several agreements at once, so ticking here doesn't remove it from any other.
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, padding: 10, background: 'var(--paper-deep, #f4ede1)', borderRadius: 4 }}>
        <strong style={{ color: 'var(--ink)' }}>{selected.size}</strong> of {fields.length} ticked
        {hasChanges && <span> · {added > 0 && <strong style={{ color: 'var(--ink)' }}>+{added}</strong>}{added > 0 && removed > 0 && ', '}{removed > 0 && <strong style={{ color: 'var(--ink)' }}>−{removed}</strong>} pending</span>}
      </div>
      {error && <div style={{ padding: 10, marginBottom: 12, borderRadius: 4, background: 'var(--red-soft, #f5dcd2)', color: 'var(--red, #b85b3a)', fontSize: 12 }}>{error}</div>}

      {sorted.map((f) => (
        <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 10px', marginBottom: 6, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} disabled={isPending} style={{ width: 18, height: 18, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{f.name}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{fmt(f.ha, 1)} ha</div>
          </div>
        </label>
      ))}

      <div style={{ position: 'sticky', bottom: 0, padding: '14px 0 0', background: 'linear-gradient(to top, var(--paper) 60%, transparent)' }}>
        <button type="button" className="btn-primary" onClick={save} disabled={!hasChanges || isPending} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: !hasChanges ? 0.5 : 1 }}>
          <Save size={16} /> {isPending ? 'Saving…' : 'Save assignments'}
        </button>
      </div>
    </div>
  );
}
