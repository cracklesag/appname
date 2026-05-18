import { fmt } from '@/lib/rules';

export function NutrientBar({
  label,
  applied,
  target,
  carryover,
  unit = 'kg/ha',
}: {
  label: React.ReactNode;
  applied: number;
  target: number;
  carryover?: number;
  unit?: string;
}) {
  const tgt = Math.max(target || 0, 1);
  const pct = Math.max(0, Math.min(110, (applied / tgt) * 100));
  const short = target - applied;
  const isShort = short > 0;
  let color = 'var(--forest)';
  if (isShort && pct < 50) color = 'var(--red)';
  else if (isShort) color = 'var(--amber)';

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
          {label}
          {carryover != null && carryover > 0 && (
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)', marginLeft: 6 }}>
              incl. {fmt(carryover)} carryover
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: "'Fraunces', serif", fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ color: 'var(--ink)' }}>{fmt(applied)}</span> / {fmt(target)} {unit}
        </div>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div style={{ fontSize: 11, marginTop: 4, color: isShort ? color : 'var(--muted)', fontWeight: isShort ? 700 : 400 }}>
        {isShort ? `Short by ${fmt(short)} ${unit}` : `Surplus of ${fmt(-short)} ${unit}`}
      </div>
    </div>
  );
}

export function MiniBar({
  label,
  applied,
  target,
  unit,
}: {
  label: string;
  applied: number;
  target: number;
  unit?: string;
}) {
  const tgt = Math.max(target || 0, 1);
  const pct = Math.max(0, Math.min(110, (applied / tgt) * 100));
  const short = target - applied;
  let color = 'var(--forest)';
  if (short > 0 && pct < 50) color = 'var(--red)';
  else if (short > 0) color = 'var(--amber)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', minWidth: 12 }}>{label}</span>
      <div className="progress-track" style={{ flex: 1, height: 6 }}>
        <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="nutrient-num" style={{ fontSize: 10, color: 'var(--muted)', minWidth: 70, textAlign: 'right' }}>
        {fmt(applied)} / {fmt(target)}{unit ? ` ${unit}` : ''}
      </span>
    </div>
  );
}
