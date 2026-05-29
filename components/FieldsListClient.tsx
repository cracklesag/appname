'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ChevronDown, SlidersHorizontal } from 'lucide-react';

/**
 * Collapsible, grouped fields list (Option 2). Groups are foldable section
 * headers; each shows its field count and a tiny P/K status dot summary.
 * A toggle shows/hides the per-field nutrient bars (N/P/K progress) so the
 * list can be compact or detailed to taste.
 *
 * All data is computed server-side and passed in as plain serialisable props
 * — this component only handles the interactive folding + toggle.
 */

export type FieldRow = {
  id: string;
  name: string;
  /** e.g. "4.2 ac · 3 cut" */
  meta: string;
  /** soil sample present */
  sampled: boolean;
  ph: number | null;
  pIdx: number | null;
  kIdx: number | null;
  phColor: string;
  pColor: string;
  kColor: string;
  staleYear: number | null;
  /** cut-state line, e.g. "Building toward cut 2 · since cut 1 on 24 Feb" or "All 3 cuts taken" */
  cutLine: string;
  /** nutrient bar values; null when field is complete (no target) */
  bars: null | {
    n: { applied: number; target: number; unit: string };
    p: { applied: number; target: number; unit: string };
    k: { applied: number; target: number; unit: string };
  };
};

export type FieldGroup = {
  key: string;
  label: string | null; // null label = ungrouped
  rows: FieldRow[];
  /** severity dots for the collapsed summary: any below-target P/K */
  hasShort: boolean;
};

function MiniBarInline({ label, applied, target, unit }: { label: string; applied: number; target: number; unit: string }) {
  const pct = target > 0 ? Math.min(100, Math.round((applied / target) * 100)) : 0;
  const short = applied < target;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
      <span style={{ width: 12, fontSize: 11, color: 'var(--muted)' }}>{label}</span>
      <div style={{ flex: 1, height: 6, borderRadius: 4, background: 'var(--paper-deep)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 4, background: short ? 'var(--amber)' : 'var(--forest)' }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--muted)', width: 78, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(applied)}/{Math.round(target)} {unit}
      </span>
    </div>
  );
}

export function FieldsListClient({ groups }: { groups: FieldGroup[] }) {
  // All groups expanded by default. Track collapsed keys.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showBars, setShowBars] = useState(false);

  const multiGroup = groups.length > 1;

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div>
      {/* Toolbar: nutrient bar toggle */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => setShowBars((v) => !v)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: showBars ? 'var(--forest-soft)' : 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: '7px 11px',
            fontSize: 12,
            fontWeight: 700,
            color: showBars ? 'var(--forest-dark)' : 'var(--ink-soft)',
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          <SlidersHorizontal size={14} /> {showBars ? 'Hide nutrient bars' : 'Show nutrient bars'}
        </button>
      </div>

      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.key);
        return (
          <div key={g.key} style={{ marginBottom: 8 }}>
            {/* Group header (only when there's more than one group, or it's a real named group) */}
            {(multiGroup || g.label) && (
              <button
                type="button"
                onClick={() => toggle(g.key)}
                aria-expanded={!isCollapsed}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'transparent',
                  border: 'none',
                  borderTop: '0.5px solid var(--line-soft)',
                  padding: '11px 4px 9px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  {isCollapsed ? <ChevronRight size={16} style={{ color: 'var(--muted)' }} /> : <ChevronDown size={16} style={{ color: 'var(--muted)' }} />}
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{g.label ?? 'Ungrouped'}</span>
                  <span style={{ fontSize: 11, color: 'var(--stone)' }}>{g.rows.length}</span>
                </span>
                {isCollapsed && g.hasShort && (
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--amber)' }} />
                )}
              </button>
            )}

            {!isCollapsed && g.rows.map((f) => (
              <Link
                key={f.id}
                href={`/fields/${f.id}?from=/fields`}
                className="card field-row"
                style={{ padding: '13px 15px', marginBottom: 7, display: 'block' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="display" style={{ fontSize: 18, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>{f.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{f.meta}</div>
                    {f.sampled && (
                      <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 12, flexWrap: 'wrap' }}>
                        <span><span style={{ color: 'var(--muted)' }}>pH </span><span style={{ color: f.phColor, fontWeight: 700 }}>{f.ph ?? '—'}</span></span>
                        <span><span style={{ color: 'var(--muted)' }}>P </span><span style={{ color: f.pColor, fontWeight: 700 }}>{f.pIdx ?? '—'}</span></span>
                        <span><span style={{ color: 'var(--muted)' }}>K </span><span style={{ color: f.kColor, fontWeight: 700 }}>{f.kIdx ?? '—'}</span></span>
                        {f.staleYear != null && <span style={{ color: 'var(--red, #b85b3a)' }}>· {f.staleYear} (stale)</span>}
                      </div>
                    )}
                  </div>
                  <ChevronRight size={18} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 2 }} />
                </div>

                <div style={{ marginTop: 7, fontSize: 12, color: 'var(--muted)' }}>{f.cutLine}</div>

                {showBars && f.bars && (
                  <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--line-soft)' }}>
                    <MiniBarInline label="N" {...f.bars.n} />
                    <MiniBarInline label="P" {...f.bars.p} />
                    <MiniBarInline label="K" {...f.bars.k} />
                  </div>
                )}
              </Link>
            ))}
          </div>
        );
      })}
    </div>
  );
}
