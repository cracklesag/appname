'use client';

import { useState, useTransition } from 'react';
import { ChevronDown, ChevronRight, Leaf, Calendar, AlertTriangle, Sprout } from 'lucide-react';
import { saveGroupProfile } from '@/lib/actions';
import { Group } from '@/lib/types';

const MGMT_OPTIONS: { value: '' | 'silage' | 'rotational' | 'maintenance'; label: string }[] = [
  { value: '', label: 'No profile (general)' },
  { value: 'silage', label: 'Silage' },
  { value: 'rotational', label: 'Rotational grazing' },
  { value: 'maintenance', label: 'Maintenance / low input' },
];

/** 'MM-DD' → 'YYYY-MM-DD' (this year) for the date input; '' if unset. */
function mdToInputDate(md: string | null): string {
  if (!md || !/^\d{2}-\d{2}$/.test(md)) return '';
  return `${new Date().getFullYear()}-${md}`;
}

function hasProfile(g: Group): boolean {
  return !!(g.management_type || g.earliest_fert_md || g.low_input || g.nvz || g.profile_note);
}

export function GroupProfilesSection({ groups }: { groups: Group[] }) {
  if (groups.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--muted)', padding: '4px 2px' }}>
        Create a group above first — then you can give it a management profile here.
      </div>
    );
  }
  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 12px' }}>
        Optional. Give a block a management profile and the plan will flag things like spreading too
        early, going over a low-input cap, or NVZ closed periods. Profiles only show warnings — they
        never change the recommended amounts. Leave a block with no profile and it behaves as normal.
      </p>
      {groups.map((g) => <GroupProfileRow key={g.id} group={g} />)}
    </div>
  );
}

function GroupProfileRow({ group }: { group: Group }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  const [type, setType] = useState<string>(group.management_type ?? '');
  const [date, setDate] = useState<string>(mdToInputDate(group.earliest_fert_md));
  const [lowInput, setLowInput] = useState<boolean>(group.low_input);
  const [maxN, setMaxN] = useState<string>(group.max_n_kg_per_ha != null ? String(group.max_n_kg_per_ha) : '');
  const [nvz, setNvz] = useState<boolean>(group.nvz);
  const [note, setNote] = useState<string>(group.profile_note ?? '');
  const [grazeN, setGrazeN] = useState<string>(group.graze_n_kg_per_ha != null ? String(group.graze_n_kg_per_ha) : '');
  const [grazeInt, setGrazeInt] = useState<string>(group.graze_interval_days != null ? String(group.graze_interval_days) : '');

  const profiled = hasProfile(group);

  function save() {
    const fd = new FormData();
    fd.set('id', group.id);
    fd.set('management_type', type);
    fd.set('earliest_fert_md', date);
    fd.set('low_input', lowInput ? 'true' : 'false');
    fd.set('max_n_kg_per_ha', maxN);
    fd.set('nvz', nvz ? 'true' : 'false');
    fd.set('profile_note', note);
    fd.set('graze_n_kg_per_ha', grazeN);
    fd.set('graze_interval_days', grazeInt);
    start(async () => {
      await saveGroupProfile(fd);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setOpen(false);
    });
  }

  // Summary chips for the collapsed row.
  const chips: string[] = [];
  if (group.management_type === 'rotational') chips.push('Rotational');
  else if (group.management_type === 'maintenance') chips.push('Low input');
  else if (group.management_type === 'silage') chips.push('Silage');
  if (group.low_input && group.max_n_kg_per_ha != null) chips.push(`≤${group.max_n_kg_per_ha} N`);
  if (group.nvz) chips.push('NVZ');

  return (
    <div className="card" style={{ padding: 0, marginBottom: 8, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px',
          background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        {open ? <ChevronDown size={18} style={{ color: 'var(--muted)', flexShrink: 0 }} />
              : <ChevronRight size={18} style={{ color: 'var(--muted)', flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{group.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>
            {profiled ? chips.join(' · ') || 'Profile set' : 'No profile'}
          </div>
        </div>
        {saved && <span style={{ fontSize: 11, color: 'var(--forest)', fontWeight: 700 }}>Saved</span>}
      </button>

      {open && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--line)' }}>
          {/* Management type */}
          <Label icon={<Sprout size={13} />} text="Management" />
          <select
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value)}
            style={{ fontSize: 14, marginBottom: 14 }}
          >
            {MGMT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          {/* Earliest fertiliser date */}
          <Label icon={<Calendar size={13} />} text="Earliest fertiliser date" />
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ fontSize: 14, marginBottom: 4 }}
          />
          <Hint>Only the day & month are used — it repeats every year. Spreading before this is flagged. Leave blank for none.</Hint>

          {/* Low input cap */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)', margin: '14px 0 0' }}>
            <input type="checkbox" checked={lowInput} onChange={(e) => setLowInput(e.target.checked)} />
            <span><Leaf size={13} style={{ verticalAlign: -2, color: 'var(--forest)' }} /> Low-input block</span>
          </label>
          {lowInput && (
            <div style={{ marginTop: 8 }}>
              <Label text="Max N per dressing (kg/ha)" />
              <input
                type="number" inputMode="numeric" min={0}
                className="input" placeholder="e.g. 40"
                value={maxN}
                onChange={(e) => setMaxN(e.target.value)}
                style={{ fontSize: 14 }}
              />
              <Hint>A planned dressing above this is flagged. Leave blank to just label the block low-input.</Hint>
            </div>
          )}

          {/* NVZ */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)', margin: '14px 0 0' }}>
            <input type="checkbox" checked={nvz} onChange={(e) => setNvz(e.target.checked)} />
            <span><AlertTriangle size={13} style={{ verticalAlign: -2, color: '#c98a2b' }} /> In an NVZ (flag closed-period reminders)</span>
          </label>

          {/* Grazing maintenance schedule — relevant for grazing blocks */}
          {(type === 'rotational' || type === 'maintenance') && (
            <div style={{ marginTop: 14, padding: '10px 12px', background: 'var(--paper-deep, #F4EFE2)', borderRadius: 8 }}>
              <Label text="Grazing top-up schedule (optional)" />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number" inputMode="numeric" min={0} className="input"
                  placeholder="40" value={grazeN} onChange={(e) => setGrazeN(e.target.value)}
                  style={{ fontSize: 14, width: 80 }}
                />
                <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>kg N/ha every</span>
                <input
                  type="number" inputMode="numeric" min={1} className="input"
                  placeholder="28" value={grazeInt} onChange={(e) => setGrazeInt(e.target.value)}
                  style={{ fontSize: 14, width: 70 }}
                />
                <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>days</span>
              </div>
              <Hint>A simple flat plan for this block (e.g. 40 kg N/ha every 28 days). Advisory only — it’s a reminder, it doesn’t auto-apply.</Hint>
            </div>
          )}

          {/* Note */}
          <div style={{ marginTop: 14 }}>
            <Label text="Note (optional)" />
            <input
              type="text" className="input" maxLength={120}
              placeholder="e.g. Boggy in the corner — keep off till dry"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ fontSize: 14 }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="btn-primary"
              style={{ flex: 1, padding: '10px', fontSize: 14, fontWeight: 700 }}
            >
              {pending ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Label({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
      {icon}{text}
    </div>
  );
}
function Hint({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>{children}</div>;
}
