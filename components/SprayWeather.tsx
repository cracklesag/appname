'use client';

import { useEffect, useState } from 'react';
import { Wind, CloudRain } from 'lucide-react';

// Spray-conditions check, free Open-Meteo forecast, fetched client-side at the
// field's centroid. Verdicts follow the Code of Practice rules of thumb:
//   - ideal wind Force 2 (4–7 mph); gentle Force 3 (8–12 mph) workable
//   - below ~2 mph = drift/inversion risk; above ~12 mph = don't spray
//   - rain soon after spraying defeats most products (rainfastness varies)
// Forecast guidance only — the label and conditions on the day decide.

interface HourRow {
  iso: string;
  wind: number;     // mph
  gust: number;     // mph
  rainProb: number; // %
}

type Verdict = 'good' | 'marginal' | 'poor';

function verdictFor(h: HourRow): Verdict {
  if (h.wind > 12 || h.gust > 18 || h.rainProb >= 60) return 'poor';
  if (h.wind < 2 || h.wind > 9 || h.gust > 14 || h.rainProb >= 35) return 'marginal';
  return 'good';
}

const V_LABEL: Record<Verdict, string> = { good: 'Good', marginal: 'Marginal', poor: 'Poor' };
const V_BG: Record<Verdict, string> = { good: 'var(--forest-soft, #e3efe7)', marginal: '#fdf0dd', poor: '#fde5e0' };
const V_FG: Record<Verdict, string> = { good: 'var(--forest-dark, #1b5e4a)', marginal: '#9a6320', poor: '#a13c2a' };

export function SprayWeather({ lat, lng, label }: { lat: number; lng: number; label?: string | null }) {
  const [rows, setRows] = useState<HourRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setFailed(false);
    (async () => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&hourly=wind_speed_10m,wind_gusts_10m,precipitation_probability&wind_speed_unit=mph&forecast_days=2&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('forecast unavailable');
        const data = (await res.json()) as { hourly?: { time: string[]; wind_speed_10m: number[]; wind_gusts_10m: number[]; precipitation_probability: number[] } };
        const h = data.hourly;
        if (!h?.time?.length) throw new Error('no data');
        const now = Date.now();
        const all: HourRow[] = h.time.map((t, i) => ({
          iso: t,
          wind: Math.round(h.wind_speed_10m[i] ?? 0),
          gust: Math.round(h.wind_gusts_10m[i] ?? 0),
          rainProb: Math.round(h.precipitation_probability[i] ?? 0),
        }));
        // From the current hour, every 2 hours, 7 rows ≈ the working day ahead.
        const start = all.findIndex((r) => new Date(r.iso).getTime() >= now - 30 * 60000);
        const picked = all.slice(Math.max(0, start)).filter((_, i) => i % 2 === 0).slice(0, 7);
        if (!cancelled) setRows(picked);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [lat, lng]);

  if (failed) return null; // offline / blocked — say nothing rather than nag
  if (!rows) {
    return (
      <div className="card" style={{ padding: 12, marginBottom: 12, fontSize: 12.5, color: 'var(--muted)' }}>
        Checking spray conditions{label ? ` at ${label}` : ''}…
      </div>
    );
  }

  const current = rows[0];
  const overall = verdictFor(current);
  const nextGood = rows.find((r) => verdictFor(r) === 'good');
  const fmtHour = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hh = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    return sameDay ? hh : `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${hh}`;
  };

  return (
    <div className="card" style={{ padding: 14, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="label" style={{ margin: 0 }}>Spray conditions{label ? ` · ${label}` : ''}</div>
        <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: V_BG[overall], color: V_FG[overall] }}>{V_LABEL[overall]} now</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
          <Wind size={15} style={{ color: 'var(--muted)' }} />{current.wind} mph
          <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--muted)' }}>gusting {current.gust}</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
          <CloudRain size={15} style={{ color: 'var(--muted)' }} />{current.rainProb}%
          <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--muted)' }}>rain chance</span>
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {rows.map((r) => {
          const v = verdictFor(r);
          return (
            <div key={r.iso} style={{ flex: '0 0 auto', minWidth: 64, textAlign: 'center', padding: '7px 6px', borderRadius: 8, background: V_BG[v] }}>
              <div style={{ fontSize: 10.5, color: V_FG[v], fontWeight: 700 }}>{fmtHour(r.iso)}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: V_FG[v], marginTop: 2 }}>{r.wind} mph</div>
              <div style={{ fontSize: 10.5, color: V_FG[v] }}>{r.rainProb}%</div>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.45 }}>
        {overall !== 'good' && nextGood ? `Better window around ${fmtHour(nextGood.iso)}. ` : ''}
        Forecast guidance only — always follow the product label and judge conditions in the field.
      </div>
    </div>
  );
}
