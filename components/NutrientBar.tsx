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

/**
 * Need-vs-supply bar with overshoot, for the fertiliser plan and P/K status.
 *
 * The track's first 100% is the field's NEED; a fixed overshoot zone to the
 * right fills PINK when supply exceeds need. When need is zero (field at/above
 * target index), any supply is shown as over-application in pink.
 *
 *   under target → green fill, hollow remainder
 *   on target    → full green
 *   over target  → green to 100% + pink overshoot segment
 */
export function SupplyBar({
  label,
  need,
  supply,
  unit = 'kg/ha',
}: {
  label: string;
  need: number;
  supply: number;
  unit?: string;
}) {
  const hasNeed = need > 0.5;
  const metFrac = hasNeed ? Math.min(1, supply / need) : 0;
  const overAbs = hasNeed ? Math.max(0, supply - need) : supply;
  const overFrac = hasNeed ? Math.min(1, overAbs / need) : (supply > 0.5 ? 1 : 0);

  const under = hasNeed && supply < need - 0.5;
  const over = overAbs > 0.5;

  const GREEN = 'var(--forest, #5a7a3a)';
  const GREEN_SOFT = 'var(--forest-soft, #e6efd9)';
  // Overshoot colour — red, shown as a solid band on top of a full green need
  // zone so an over-applied nutrient still reads as "need met, plus extra".
  const RED = 'var(--red, #b85b3a)';
  const RED_SOFT = '#f3dcd2';
  const NEUTRAL = 'var(--line, #d9d2c4)';

  // When there's no need (high index), the whole bar represents "over" — fill
  // it green to show the requirement is satisfied, with red marking the excess.
  const needZoneFill = hasNeed ? metFrac : 1;

  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {hasNeed ? (
            <>
              <span className="nutrient-num" style={{ color: over ? RED : 'var(--ink)', fontWeight: 700 }}>{fmt(Math.round(supply))}</span>
              {' / '}{fmt(Math.round(need))} {unit}
            </>
          ) : supply > 0.5 ? (
            <><span className="nutrient-num" style={{ color: RED, fontWeight: 700 }}>{fmt(Math.round(supply))}</span> {unit} · none needed</>
          ) : (
            <span style={{ color: GREEN }}>at target ✓</span>
          )}
        </span>
      </div>

      <div style={{ display: 'flex', height: 9, borderRadius: 5, overflow: 'hidden', background: NEUTRAL }}>
        {/* Need zone (100% of need) — green fills the covered portion, and
            stays full once met even when over-applied. */}
        <div style={{ flex: '1 1 0', position: 'relative', background: GREEN_SOFT }}>
          <div style={{ position: 'absolute', inset: 0, width: `${needZoneFill * 100}%`, background: GREEN }} />
        </div>
        {/* Overshoot zone — solid red band marking the excess above need. */}
        <div style={{ flex: '0 0 35%', position: 'relative', background: RED_SOFT }}>
          <div style={{ position: 'absolute', inset: 0, width: `${overFrac * 100}%`, background: RED }} />
        </div>
      </div>

      {over && (
        <div style={{ fontSize: 10, color: RED, marginTop: 2, fontWeight: 600 }}>over by {fmt(Math.round(overAbs))} {unit}</div>
      )}
      {under && (
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>short by {fmt(Math.round(need - supply))} {unit}</div>
      )}
    </div>
  );
}
