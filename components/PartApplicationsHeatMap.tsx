'use client';

// Per-field K₂O loading heat map. Plain parchment background (NO satellite),
// boundary outline drawn on top of a smooth canvas heat fill. Overlaps
// accumulate — a patch of ground spread twice reads a higher band. Bands are
// kg K₂O per acre. Also shows reconciliation coverage and the list of part
// applications with pending/counted badges.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildHeatGrid, K_BAND_COLOURS, K_BAND_LABELS, RECONCILE_COVERAGE_THRESHOLD,
  type HeatPatch,
} from '@/lib/partials';
import { ringsOfGeometry, type FieldGeometry, type Position } from '@/lib/geo';

export interface HeatListItem {
  id: string;
  dateLabel: string;
  product: string;
  rateLabel: string;
  areaLabel: string;
  kPerAc: number;
  status: 'pending' | 'counted';
}

interface Props {
  boundary: FieldGeometry;
  patches: HeatPatch[];
  items: HeatListItem[];
  unitSystem: 'acres' | 'hectares';
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const BAND_RGB = K_BAND_COLOURS.map(hexToRgb);

export default function PartApplicationsHeatMap({ boundary, patches, items, unitSystem }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(340);

  const grid = useMemo(() => buildHeatGrid(boundary, patches, 120), [boundary, patches]);
  // Keep the canvas aspect equal to the grid (cells are ~square in metres).
  const height = Math.round((width * grid.rows) / grid.cols);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(Math.min(440, w));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // 1) Heat fill: paint the grid to a small offscreen canvas, scale up smooth.
    const { cols, rows, band } = grid;
    const off = document.createElement('canvas');
    off.width = cols; off.height = rows;
    const octx = off.getContext('2d');
    if (octx) {
      const img = octx.createImageData(cols, rows);
      for (let i = 0; i < cols * rows; i++) {
        const b = band[i];
        const o = i * 4;
        if (b < 0) { img.data[o + 3] = 0; continue; } // outside / no application → transparent
        const [r, g, bl] = BAND_RGB[b];
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = bl; img.data[o + 3] = 205;
      }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, cols, rows, 0, 0, width, height);
    }

    // 2) Boundary outline on top, using the same bbox → px transform.
    const { bbox } = grid;
    const wDeg = bbox.maxLng - bbox.minLng || 1e-9;
    const hDeg = bbox.maxLat - bbox.minLat || 1e-9;
    const toPx = (lng: number, lat: number) => ({
      x: ((lng - bbox.minLng) / wDeg) * width,
      y: ((bbox.maxLat - lat) / hDeg) * height,
    });
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2B4129'; // --forest-dark
    ctx.lineJoin = 'round';
    for (const ring of ringsOfGeometry(boundary) as Position[][]) {
      ctx.beginPath();
      ring.forEach(([lng, lat], i) => {
        const p = toPx(lng, lat);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.stroke();
    }
  }, [grid, width, height, boundary]);

  const coveragePct = Math.round(grid.coverageFraction * 100);
  const thresholdPct = Math.round(RECONCILE_COVERAGE_THRESHOLD * 100);
  const reconciled = grid.coverageFraction >= RECONCILE_COVERAGE_THRESHOLD;
  // Only show legend bands up to the highest present (keeps it tidy).
  const lastBand = Math.max(0, grid.maxBand);

  return (
    <div ref={wrapRef}>
      {/* Heat map */}
      <div className="card" style={{ padding: 12 }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height, display: 'block', borderRadius: 6, background: 'var(--paper-deep)' }}
        />
        {/* Legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginTop: 10 }}>
          {K_BAND_COLOURS.slice(0, lastBand + 1).map((c, i) => (
            <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ink-soft)' }}>
              <span style={{ width: 13, height: 13, borderRadius: 3, background: c, border: '1px solid rgba(0,0,0,0.1)' }} />
              {K_BAND_LABELS[i]}
            </div>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>kg K₂O / ac</div>
        </div>
      </div>

      {/* Coverage / reconciliation */}
      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span className="label">Field coverage</span>
          <span className="nutrient-num" style={{ fontSize: 15, color: reconciled ? 'var(--forest-dark)' : 'var(--ink)' }}>{coveragePct}%</span>
        </div>
        <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'var(--line-soft)', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, width: `${Math.min(100, coveragePct)}%`, background: reconciled ? 'var(--forest)' : 'var(--amber)' }} />
          {/* threshold marker */}
          <div style={{ position: 'absolute', top: -2, bottom: -2, left: `${thresholdPct}%`, width: 2, background: 'var(--ink-soft)', opacity: 0.6 }} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
          {reconciled
            ? 'Reconciled — these part applications now count in the field\u2019s nutrient totals, area-weighted.'
            : `Pending — part applications stay out of the field totals until coverage reaches ${thresholdPct}%.`}
        </div>
      </div>

      {/* List */}
      <div className="label" style={{ paddingLeft: 4, marginTop: 14, marginBottom: 4 }}>
        Part applications ({items.length})
      </div>
      {items.length === 0 ? (
        <div className="card" style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          No part applications drawn yet.
        </div>
      ) : (
        items.map((it) => (
          <div key={it.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 700 }}>{it.dateLabel}</div>
                <div style={{ fontSize: 14, color: 'var(--ink)', marginTop: 2 }}>{it.product}</div>
              </div>
              <span
                style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                  background: it.status === 'counted' ? 'var(--forest-soft)' : 'var(--amber-soft)',
                  color: it.status === 'counted' ? 'var(--forest-dark)' : 'var(--amber)',
                }}
              >
                {it.status === 'counted' ? 'Counted' : 'Pending'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--ink-soft)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line-soft)' }}>
              <span>{it.rateLabel}</span>
              <span>{it.areaLabel}</span>
              <span style={{ marginLeft: 'auto' }}>~{it.kPerAc} kg K₂O/ac</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
