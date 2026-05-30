'use client';

/**
 * A compact heat-map bar for a single soil metric (pH, P index, K index).
 * Fill width scales the value against `max`; fill colour is green at/above
 * target, amber when close (≥80%), red when low. A faint tick marks the
 * target so "good" is visible at a glance. Shared across the snapshot and
 * spreading reports so the soil read is consistent everywhere.
 */
export function SoilHeatBar({
  label, value, target, max,
}: {
  label: string;
  value: number | null | undefined;
  target: number | null | undefined;
  max: number;
}) {
  const hasValue = value != null;
  const pct = hasValue ? Math.max(4, Math.min(100, (value! / max) * 100)) : 0;
  const targetPct = target != null ? Math.max(0, Math.min(100, (target / max) * 100)) : null;

  let fill = 'var(--muted)';
  if (hasValue && target != null) {
    if (value! >= target) fill = 'var(--forest, #5a7a3a)';
    else if (value! >= target * 0.8) fill = 'var(--amber, #c98a2b)';
    else fill = 'var(--red, #b85b3a)';
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', width: 18, flexShrink: 0 }}>{label}</span>
      <div style={{ position: 'relative', flex: 1, height: 8, background: 'var(--line-soft, #e8e4da)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: fill, borderRadius: 4, transition: 'width .2s' }} />
        {targetPct != null && (
          <div style={{ position: 'absolute', top: -1, bottom: -1, left: `${targetPct}%`, width: 2, background: 'var(--ink-soft, #6b6358)', opacity: 0.5 }} />
        )}
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: hasValue ? 'var(--ink)' : 'var(--muted)', width: 26, textAlign: 'right', flexShrink: 0 }}>
        {hasValue ? value : '—'}
      </span>
    </div>
  );
}
