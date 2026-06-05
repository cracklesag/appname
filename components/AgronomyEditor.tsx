'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw, Check } from 'lucide-react';
import { saveAgronomy } from '@/lib/actions';
import type { AgronomyConfig } from '@/lib/types';
import {
  cloneAgronomy,
  P_INDEX_KEYS, P_INDEX_LABELS, K_BAND_KEYS, K_BAND_LABELS, CUT_KEYS, CUT_LABELS,
} from '@/lib/agronomy';

const cell: React.CSSProperties = {
  width: 46, textAlign: 'right', padding: '5px 4px', fontSize: 12,
  border: '1px solid var(--line)', borderRadius: 6, background: 'var(--card)', color: 'var(--ink)',
};
const colHead: React.CSSProperties = { fontSize: 10, color: 'var(--muted)', fontWeight: 700, textAlign: 'center', width: 46 };
const rowHead: React.CSSProperties = { fontSize: 11, color: 'var(--ink-soft)', fontWeight: 700, textAlign: 'left', paddingRight: 6, whiteSpace: 'nowrap' };

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 13, marginBottom: 12 }}>
      <div className="label" style={{ marginBottom: desc ? 3 : 8 }}>{title}</div>
      {desc && <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.45, marginBottom: 10 }}>{desc}</div>}
      <div style={{ overflowX: 'auto' }}>{children}</div>
    </div>
  );
}

export function AgronomyEditor({ initial, defaults }: { initial: AgronomyConfig; defaults: AgronomyConfig }) {
  const [cfg, setCfg] = useState<AgronomyConfig>(() => cloneAgronomy(initial));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const num = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const touch = () => { setDirty(true); setSaved(false); };

  const setMatrix = (key: 'silageP' | 'silageK', r: string, c: string, v: number) => {
    setCfg((p) => ({ ...p, [key]: { ...p[key], [r]: { ...p[key][r], [c]: v } } }));
    touch();
  };
  const setRow = (key: 'grazingP' | 'grazingK' | 'firstCutAutumnK' | 'extraK', c: string, v: number) => {
    setCfg((p) => ({ ...p, [key]: { ...p[key], [c]: v } }));
    touch();
  };
  const setYield = (profile: string, idx: number, v: number) => {
    setCfg((p) => {
      const arr = [...(p.baseYields[profile] || [])];
      arr[idx] = v;
      return { ...p, baseYields: { ...p.baseYields, [profile]: arr } };
    });
    touch();
  };

  const Matrix = ({ k }: { k: 'silageP' | 'silageK' }) => {
    const colKeys = k === 'silageP' ? P_INDEX_KEYS : K_BAND_KEYS;
    const colLabels = k === 'silageP' ? P_INDEX_LABELS : K_BAND_LABELS;
    const unitLabel = k === 'silageP' ? 'P index' : 'K index';
    return (
      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...rowHead, fontSize: 10, color: 'var(--muted)' }}>{unitLabel} →</th>
            {colKeys.map((c, i) => <th key={c} style={colHead}>{colLabels[i]}</th>)}
          </tr>
        </thead>
        <tbody>
          {CUT_KEYS.map((r, ri) => (
            <tr key={r}>
              <td style={rowHead}>{CUT_LABELS[ri]}</td>
              {colKeys.map((c) => (
                <td key={c} style={{ padding: 2 }}>
                  <input type="number" inputMode="numeric" style={cell}
                    value={cfg[k][r]?.[c] ?? 0}
                    onChange={(e) => setMatrix(k, r, c, num(e.target.value))} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const Row = ({ k, colKeys, colLabels, head }: { k: 'grazingP' | 'grazingK' | 'firstCutAutumnK' | 'extraK'; colKeys: string[]; colLabels: string[]; head: string }) => (
    <table style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...rowHead, fontSize: 10, color: 'var(--muted)' }}>{head} →</th>
          {colKeys.map((c, i) => <th key={c} style={colHead}>{colLabels[i]}</th>)}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style={rowHead}>kg/ha</td>
          {colKeys.map((c) => (
            <td key={c} style={{ padding: 2 }}>
              <input type="number" inputMode="numeric" style={cell}
                value={cfg[k][c] ?? 0}
                onChange={(e) => setRow(k, c, num(e.target.value))} />
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );

  const onSave = () => {
    start(async () => {
      await saveAgronomy(JSON.stringify(cfg));
      setDirty(false);
      setSaved(true);
      router.refresh();
    });
  };
  const onReset = () => {
    start(async () => {
      await saveAgronomy(''); // clears the override → back to built-in RB209
      setCfg(cloneAgronomy(defaults));
      setDirty(false);
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <div>
      <div className="card" style={{ padding: 13, marginBottom: 12, background: '#FBF1D9', border: '1px solid #E8D08A' }}>
        <div style={{ fontSize: 12, color: '#6B5616', lineHeight: 1.5 }}>
          These are the reference figures the whole app calculates from, based on published UK nutrient guidance. They&apos;re correct out of the box —
          only change them after a discussion with your agronomist. A bad value flows into every recommendation.
          You can always <strong>Reset to defaults</strong> below.
        </div>
      </div>

      <Section title="Silage P₂O₅ recommendation" desc="kg/ha per cut, by soil P index.">
        <Matrix k="silageP" />
      </Section>
      <Section title="Silage K₂O recommendation" desc="kg/ha per cut, by soil K index. First-cut spring value is capped below and the balance moved to autumn.">
        <Matrix k="silageK" />
      </Section>
      <Section title="Grazing P₂O₅ / K₂O" desc="kg/ha for a grazed sward, by soil index. Lower than cutting — grazing recycles nutrients.">
        <div style={{ marginBottom: 8 }}><Row k="grazingP" colKeys={P_INDEX_KEYS} colLabels={P_INDEX_LABELS} head="P₂O₅ · P index" /></div>
        <Row k="grazingK" colKeys={K_BAND_KEYS} colLabels={K_BAND_LABELS} head="K₂O · K index" />
      </Section>
      <Section title="First-cut potash split" desc="Of the first cut's K, this much (kg/ha, by K index) goes on the PREVIOUS AUTUMN; spring is capped at the value below.">
        <Row k="firstCutAutumnK" colKeys={K_BAND_KEYS} colLabels={K_BAND_LABELS} head="Autumn K · K index" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <div style={{ flex: 1, fontSize: 12, color: 'var(--ink)' }}>First-cut spring K cap</div>
          <input type="number" inputMode="numeric" style={{ ...cell, width: 64 }}
            value={cfg.springCap}
            onChange={(e) => { setCfg((p) => ({ ...p, springCap: num(e.target.value) })); touch(); }} />
          <span style={{ fontSize: 12, color: 'var(--muted)', width: 38 }}>kg/ha</span>
        </div>
      </Section>
      <Section title="Catch-up K after cutting" desc="Extra K₂O (kg/ha) added on cutting systems at K index 2+ or below, by number of cuts.">
        <Row k="extraK" colKeys={CUT_KEYS} colLabels={['1 cut', '2 cut', '3 cut', '4 cut']} head="Cuts in system" />
      </Section>
      <Section title="Crop offtake per tonne" desc="kg removed per tonne of dry matter harvested. Drives the running P/K balance.">
        <div style={{ display: 'flex', gap: 14 }}>
          {(['n', 'p2o5', 'k2o'] as const).map((f) => (
            <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', width: 30 }}>{f === 'n' ? 'N' : f === 'p2o5' ? 'P₂O₅' : 'K₂O'}</span>
              <input type="number" inputMode="decimal" style={{ ...cell, width: 56 }}
                value={cfg.offtakePerT[f]}
                onChange={(e) => { setCfg((p) => ({ ...p, offtakePerT: { ...p.offtakePerT, [f]: num(e.target.value) } })); touch(); }} />
            </div>
          ))}
        </div>
      </Section>
      <Section title="Base yields" desc="Modelled DM yield (t/ha) per cut, by cut profile. Multiplied by your yield-class and cut-type multipliers.">
        {CUT_KEYS.map((profile) => (
          <div key={profile} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ ...rowHead, width: 70 }}>{profile}-cut</span>
            {(cfg.baseYields[profile] || []).map((v, idx) => (
              <input key={idx} type="number" inputMode="decimal" style={{ ...cell, width: 50 }}
                value={v}
                onChange={(e) => setYield(profile, idx, num(e.target.value))} />
            ))}
          </div>
        ))}
      </Section>
      <Section title="Recommendation targets" desc="The maintenance target the recommendations build toward. (Field-card colour targets are set separately under the main settings.)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ flex: 1, fontSize: 12, color: 'var(--ink)' }}>Target P index</div>
          <input type="number" inputMode="numeric" min={0} max={4} style={{ ...cell, width: 56 }}
            value={cfg.targetPIndex}
            onChange={(e) => { setCfg((p) => ({ ...p, targetPIndex: num(e.target.value) })); touch(); }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, fontSize: 12, color: 'var(--ink)' }}>Target K band</div>
          <select value={cfg.targetKBand} className="input" style={{ width: 80 }}
            onChange={(e) => { setCfg((p) => ({ ...p, targetKBand: e.target.value })); touch(); }}>
            {K_BAND_KEYS.map((b, i) => <option key={b} value={b}>{K_BAND_LABELS[i]}</option>)}
          </select>
        </div>
      </Section>

      <div style={{ position: 'sticky', bottom: 0, background: 'var(--paper)', paddingTop: 10, paddingBottom: 14, display: 'flex', gap: 8 }}>
        <button type="button" onClick={onReset} disabled={pending}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 14px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 13, fontWeight: 700, color: 'var(--ink-soft)', cursor: 'pointer' }}>
          <RotateCcw size={15} /> Reset to defaults
        </button>
        <button type="button" onClick={onSave} disabled={pending || !dirty}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 14px', background: dirty ? 'var(--forest)' : 'var(--line)', color: dirty ? 'var(--paper)' : 'var(--muted)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: dirty ? 'pointer' : 'default' }}>
          {saved && !dirty ? <><Check size={15} /> Saved</> : pending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
