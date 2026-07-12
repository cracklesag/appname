'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DIARY_LAYERS, eventsByDay, type DiaryEvent, type DiaryLayerKey } from '@/lib/diary';
import { MONTH_NAMES } from '@/lib/rules';

const STORE_KEY = 'diary.calLayers';
const ALL_KEYS = DIARY_LAYERS.map((l) => l.key);

function loadVisible(): Set<DiaryLayerKey> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return new Set(ALL_KEYS);
    const arr = JSON.parse(raw) as DiaryLayerKey[];
    const valid = arr.filter((k) => ALL_KEYS.includes(k));
    return valid.length > 0 ? new Set(valid) : new Set(ALL_KEYS);
  } catch { return new Set(ALL_KEYS); }
}

/**
 * Month calendar of farm activity. Events are derived server-side and passed
 * in; this component only filters (layer chips, persisted) and renders. Dot
 * markers per layer keep the grid quiet; tap a day for the detail list below.
 */
export function DiaryCalendar({ events }: { events: DiaryEvent[] }) {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-based
  const [visible, setVisible] = useState<Set<DiaryLayerKey>>(() =>
    typeof window === 'undefined' ? new Set(ALL_KEYS) : loadVisible(),
  );
  const [selected, setSelected] = useState<string>(todayIso);

  const toggleLayer = (k: DiaryLayerKey) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      try { localStorage.setItem(STORE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const byDay = useMemo(() => eventsByDay(events, visible), [events, visible]);

  // Build the month grid: Monday-first weeks.
  const first = new Date(Date.UTC(year, month, 1));
  const startDow = (first.getUTCDay() + 6) % 7; // 0 = Monday
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array<null>(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); };

  const dayEvents = byDay.get(selected) ?? [];
  const colorOf = (k: DiaryLayerKey) => DIARY_LAYERS.find((l) => l.key === k)?.color ?? 'var(--ink)';

  return (
    <div>
      {/* Layer filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {DIARY_LAYERS.map((l) => {
          const on = visible.has(l.key);
          return (
            <button
              key={l.key}
              type="button"
              onClick={() => toggleLayer(l.key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700,
                cursor: 'pointer',
                border: `1px solid ${on ? l.color : 'var(--line)'}`,
                background: on ? 'var(--card)' : 'transparent',
                color: on ? 'var(--ink)' : 'var(--muted)',
                opacity: on ? 1 : 0.6,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 4, background: l.color, opacity: on ? 1 : 0.35 }} />
              {l.label}
            </button>
          );
        })}
      </div>

      {/* Month header */}
      <div className="card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button type="button" onClick={prevMonth} aria-label="Previous month" style={{ border: 'none', background: 'transparent', color: 'var(--forest-dark)', cursor: 'pointer', padding: 6 }}><ChevronLeft size={18} /></button>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink)' }}>{MONTH_NAMES[month]} {year}</div>
          <button type="button" onClick={nextMonth} aria-label="Next month" style={{ border: 'none', background: 'transparent', color: 'var(--forest-dark)', cursor: 'pointer', padding: 6 }}><ChevronRight size={18} /></button>
        </div>

        {/* Weekday header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>{d}</div>
          ))}
        </div>

        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {cells.map((iso, i) => {
            if (!iso) return <div key={`x-${i}`} />;
            const evs = byDay.get(iso) ?? [];
            const isToday = iso === todayIso;
            const isSel = iso === selected;
            const layers = [...new Set(evs.map((e) => e.layer))].slice(0, 4);
            return (
              <button
                key={iso}
                type="button"
                onClick={() => setSelected(iso)}
                style={{
                  minHeight: 44, borderRadius: 8, cursor: 'pointer',
                  border: `1.5px solid ${isSel ? 'var(--forest)' : 'transparent'}`,
                  background: isToday ? 'var(--forest-soft)' : 'transparent',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                  padding: '4px 0',
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: isToday ? 800 : 500, color: 'var(--ink)' }}>{Number(iso.slice(8, 10))}</span>
                {layers.length > 0 && (
                  <span style={{ display: 'flex', gap: 2 }}>
                    {layers.map((l) => (
                      <span key={l} style={{ width: 5, height: 5, borderRadius: 3, background: colorOf(l) }} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected-day detail */}
      <div style={{ marginTop: 12 }}>
        <div className="label" style={{ paddingLeft: 4, marginBottom: 8 }}>
          {selected === todayIso ? 'Today' : selected.split('-').reverse().join('/')}
          {dayEvents.length > 0 ? ` · ${dayEvents.length}` : ''}
        </div>
        {dayEvents.length === 0 ? (
          <div className="card" style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>
            Nothing on this day.
          </div>
        ) : (
          dayEvents.map((e) => (
            <Link key={e.key} href={e.href} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 6, textDecoration: 'none' }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: colorOf(e.layer), flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>{e.label}</span>
              <ChevronRight size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
