'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Save, Sprout } from 'lucide-react';
import { Field, FieldEvent, FieldEventType, GrassSystem, SeedRateUnit } from '@/lib/types';
import { addFieldEvent, updateFieldEvent } from '@/lib/actions';
import { ErrorBanner } from './InlineWarning';

const TYPES: FieldEventType[] = ['reseed', 'oversow', 'plough'];
const TYPE_LABELS: Record<FieldEventType, string> = {
  reseed: 'Reseed',
  oversow: 'Oversow',
  plough: 'Plough',
};
const TYPE_HINTS: Record<FieldEventType, string> = {
  reseed: 'Full reseed. Sets the field\u2019s current sward to what you sow.',
  oversow: 'Oversow into the existing sward (e.g. clover into ryegrass). Pick the resulting sward — it becomes the field\u2019s current sward.',
  plough: 'Ploughing only — no seed recorded.',
};

export function FieldEventForm({
  field,
  grassSystems,
  hiddenGrassSystemIds,
  existing,
  returnTo,
}: {
  field: Field;
  grassSystems: GrassSystem[];
  hiddenGrassSystemIds: string[];
  existing?: FieldEvent;
  returnTo?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!existing;

  const visibleGrassSystems = useMemo(() => {
    const hidden = new Set(hiddenGrassSystemIds);
    const keep = new Set(
      [field.grass_system_id, existing?.grass_system_id].filter(Boolean) as string[],
    );
    return grassSystems.filter((s) => !hidden.has(s.id) || keep.has(s.id));
  }, [grassSystems, hiddenGrassSystemIds, field.grass_system_id, existing]);

  const defaultSystem =
    field.grass_system_id ??
    grassSystems.find((s) => s.seed_key === 'perennial_ryegrass')?.id ??
    visibleGrassSystems[0]?.id ??
    '';

  const [eventType, setEventType] = useState<FieldEventType>(existing?.event_type ?? 'reseed');
  const [date, setDate] = useState(existing?.event_date ?? today);
  const [grassSystemId, setGrassSystemId] = useState<string>(
    existing ? (existing.grass_system_id ?? '') : defaultSystem,
  );
  const [seedMix, setSeedMix] = useState(existing?.seed_mix ?? '');
  const [seedRate, setSeedRate] = useState(
    existing?.seed_rate_value != null ? String(existing.seed_rate_value) : '',
  );
  const [seedRateUnit, setSeedRateUnit] = useState<SeedRateUnit>(existing?.seed_rate_unit ?? 'kg/ac');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isPlough = eventType === 'plough';

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!date) {
      setError('Pick a date.');
      return;
    }
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      await (isEdit ? updateFieldEvent : addFieldEvent)(fd);
    } catch (err) {
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) {
        setError(err.message);
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="hidden" name="field_id" value={field.id} />
      <input type="hidden" name="event_type" value={eventType} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}

      <div style={{ padding: 16, paddingBottom: 100 }}>
        {/* Event type */}
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 8 }}>Event type</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {TYPES.map((t) => {
              const active = eventType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setEventType(t)}
                  style={{
                    flex: 1,
                    padding: '9px 6px',
                    fontSize: 13,
                    fontWeight: 700,
                    borderRadius: 6,
                    cursor: 'pointer',
                    border: active ? '1px solid var(--forest)' : '1px solid var(--line)',
                    background: active ? 'var(--forest)' : 'var(--card)',
                    color: active ? 'white' : 'var(--ink)',
                  }}
                >
                  {TYPE_LABELS[t]}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
            {TYPE_HINTS[eventType]}
          </div>
        </div>

        {/* Date */}
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Date</div>
          <input
            type="date"
            name="event_date"
            className="input"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {/* Grass system + seed details — not for a plough-only event */}
        {!isPlough && (
          <>
            <div className="card" style={{ padding: 14, marginBottom: 14 }}>
              <div className="label" style={{ marginBottom: 6 }}>Sown with (grass system)</div>
              <select
                name="grass_system_id"
                className="select"
                value={grassSystemId}
                onChange={(e) => setGrassSystemId(e.target.value)}
              >
                <option value="">— not recorded —</option>
                {visibleGrassSystems.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {(() => {
                const selected = grassSystems.find((s) => s.id === grassSystemId);
                if (!selected?.description) return null;
                return (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
                    {selected.description}
                  </div>
                );
              })()}
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                This becomes the field&apos;s current sward (latest reseed/oversow wins).{' '}
                <Link href="/settings/grass-systems" style={{ color: 'var(--forest-dark, #3d5b29)' }}>
                  Manage systems
                </Link>
              </div>
            </div>

            <div className="card" style={{ padding: 14, marginBottom: 14 }}>
              <div className="label" style={{ marginBottom: 6 }}>Seed mix <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· optional</span></div>
              <input
                type="text"
                name="seed_mix"
                className="input"
                placeholder="e.g. AberGain PRG + white clover"
                value={seedMix}
                maxLength={120}
                autoComplete="off"
                onChange={(e) => setSeedMix(e.target.value)}
              />

              <div className="label" style={{ marginBottom: 6, marginTop: 14 }}>Seed rate <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· optional</span></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number"
                  name="seed_rate_value"
                  className="input"
                  placeholder="e.g. 14"
                  step="0.5"
                  min="0"
                  value={seedRate}
                  onChange={(e) => setSeedRate(e.target.value)}
                  style={{ flex: 1 }}
                />
                <select
                  name="seed_rate_unit"
                  className="select"
                  value={seedRateUnit}
                  onChange={(e) => setSeedRateUnit(e.target.value as SeedRateUnit)}
                  style={{ width: 110 }}
                >
                  <option value="kg/ac">kg/ac</option>
                  <option value="kg/ha">kg/ha</option>
                </select>
              </div>
            </div>
          </>
        )}

        {/* Notes */}
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Notes <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· optional</span></div>
          <textarea
            name="notes"
            className="textarea"
            rows={3}
            placeholder="Anything worth remembering about this reseed/plough…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <ErrorBanner error={error} />

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary"
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6 }}
        >
          {eventType === 'plough' ? <Save size={18} /> : <Sprout size={18} />}
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : `Log ${TYPE_LABELS[eventType].toLowerCase()}`}
        </button>
      </div>
    </form>
  );
}
