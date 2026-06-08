'use client';

// Boundary-only freehand drawing of a part-application spread area. Plain
// parchment background — NO satellite/raster tiles (the user wants just the
// field shape, and it avoids imagery licensing). Reuses the pure geometry
// helpers from lib/geo: snapPoint (vertex snap-to-boundary on release) and
// ringsOfGeometry. Deliberate inward deviations stay put — snapPoint only
// pulls vertices that land within tolerance of the boundary.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, X, Eraser, Magnet } from 'lucide-react';
import {
  snapPoint, ringsOfGeometry, polygonAreaHectares,
  type FieldGeometry, type Position, type SnapRing,
} from '@/lib/geo';
import { KG_PER_HA_TO_KG_PER_AC } from '@/lib/partials';

interface Props {
  boundary: FieldGeometry;
  productName: string;
  /** kg K₂O per hectare this application delivers (for the loading preview). */
  k2oPerHa: number;
  /** Hide the K₂O loading preview (e.g. for non-fertiliser uses like spray). Defaults to showing it. */
  showLoading?: boolean;
  /** Field area unit for the area readout. */
  unitSystem: 'acres' | 'hectares';
  onCancel: () => void;
  onDone: (geometry: FieldGeometry, areaHa: number) => void;
}

interface Pt { x: number; y: number; }

export default function PartApplicationDraw({
  boundary, productName, k2oPerHa, unitSystem, onCancel, onDone, showLoading = true,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 360, h: 440 });
  const [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState<Pt[]>([]);
  const [result, setResult] = useState<{ geo: FieldGeometry; ha: number } | null>(null);
  const [snapOn, setSnapOn] = useState(true);

  // Measure the drawing surface so the projection fits the viewport.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rings = useMemo<SnapRing[]>(() => ringsOfGeometry(boundary), [boundary]);

  // --- projection (equirectangular, aspect-corrected by cos(lat)) ----------
  const proj = useMemo(() => {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const ring of rings) for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng; if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng; if (lat > maxLat) maxLat = lat;
    }
    const latMid = (minLat + maxLat) / 2;
    const kx = Math.cos((latMid * Math.PI) / 180) || 1;
    const wxMin = minLng * kx, wxMax = maxLng * kx;
    const worldW = Math.max(1e-9, wxMax - wxMin);
    const worldH = Math.max(1e-9, maxLat - minLat);
    const pad = 22;
    const scale = Math.min((size.w - 2 * pad) / worldW, (size.h - 2 * pad) / worldH);
    const drawnW = worldW * scale, drawnH = worldH * scale;
    const offX = (size.w - drawnW) / 2;
    const offY = (size.h - drawnH) / 2;
    return {
      toXY: (lng: number, lat: number): Pt => ({
        x: offX + (lng * kx - wxMin) * scale,
        y: offY + (maxLat - lat) * scale,
      }),
      toLngLat: (x: number, y: number): Position => [
        ((x - offX) / scale + wxMin) / kx,
        maxLat - (y - offY) / scale,
      ],
    };
  }, [rings, size]);

  // Boundary outline as an SVG path (every ring).
  const boundaryPath = useMemo(() => {
    let d = '';
    for (const ring of rings) {
      ring.forEach(([lng, lat], i) => {
        const p = proj.toXY(lng, lat);
        d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)} `;
      });
      d += 'Z ';
    }
    return d.trim();
  }, [rings, proj]);

  const drawnPath = useMemo(() => {
    if (points.length === 0) return '';
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  }, [points]);

  const resultPath = useMemo(() => {
    if (!result) return '';
    const ring = (result.geo.type === 'Polygon'
      ? result.geo.coordinates[0]
      : result.geo.coordinates[0][0]) as Position[];
    return ring.map(([lng, lat], i) => {
      const p = proj.toXY(lng, lat);
      return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }).join(' ') + ' Z';
  }, [result, proj]);

  // --- pointer handling ----------------------------------------------------
  const ptFromEvent = useCallback((e: React.PointerEvent): Pt => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const onDown = useCallback((e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setResult(null);
    setDrawing(true);
    setPoints([ptFromEvent(e)]);
  }, [ptFromEvent]);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (!drawing) return;
    const p = ptFromEvent(e);
    setPoints((prev) => {
      const last = prev[prev.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 2.5) return prev; // downsample
      return [...prev, p];
    });
  }, [drawing, ptFromEvent]);

  const finish = useCallback(() => {
    setDrawing(false);
    setPoints((prev) => {
      if (prev.length < 3) return [];
      // px → [lng,lat], snap each vertex to the boundary (if enabled).
      let ring: Position[] = prev.map((p) => proj.toLngLat(p.x, p.y));
      if (snapOn) ring = ring.map((ll) => snapPoint(ll, rings, 14).point);
      // Close the ring.
      const first = ring[0], lastP = ring[ring.length - 1];
      if (first[0] !== lastP[0] || first[1] !== lastP[1]) ring = [...ring, first];
      const geo: FieldGeometry = { type: 'Polygon', coordinates: [ring] };
      const ha = polygonAreaHectares(geo);
      if (!(ha > 0)) return [];
      setResult({ geo, ha });
      return prev;
    });
  }, [proj, rings, snapOn]);

  const clear = () => { setResult(null); setPoints([]); };

  const areaLabel = result
    ? unitSystem === 'acres'
      ? `${(result.ha * 2.47105).toFixed(2)} ac`
      : `${result.ha.toFixed(2)} ha`
    : null;
  const kPerAc = Math.round(k2oPerHa * KG_PER_HA_TO_KG_PER_AC);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--paper)', zIndex: 50, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button" onClick={onCancel} aria-label="Cancel"
          style={{ background: 'transparent', border: 'none', color: 'var(--muted)', display: 'inline-flex', padding: 4 }}
        >
          <X size={22} />
        </button>
        <div>
          <div className="display" style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>Draw the spread area</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{productName} · trace the part of the field that got spread</div>
        </div>
        <button
          type="button" onClick={() => setSnapOn((s) => !s)}
          style={{
            marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
            border: '1px solid var(--line)', borderRadius: 999, padding: '5px 10px', fontSize: 12, fontWeight: 700,
            background: snapOn ? 'var(--forest-soft)' : 'var(--card)',
            color: snapOn ? 'var(--forest-dark)' : 'var(--muted)',
          }}
        >
          <Magnet size={13} /> Snap {snapOn ? 'on' : 'off'}
        </button>
      </div>

      {/* Drawing surface */}
      <div
        ref={wrapRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        style={{ flex: 1, margin: '0 16px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--paper-deep)', touchAction: 'none', overflow: 'hidden', position: 'relative' }}
      >
        <svg width={size.w} height={size.h} style={{ display: 'block', position: 'absolute', inset: 0 }}>
          {/* field outline */}
          <path d={boundaryPath} fill="var(--card)" stroke="var(--forest)" strokeWidth={2} strokeLinejoin="round" opacity={0.95} />
          {/* live freehand stroke */}
          {drawing && drawnPath && (
            <path d={drawnPath} fill="none" stroke="var(--amber)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          )}
          {/* committed result */}
          {result && resultPath && (
            <path d={resultPath} fill="var(--forest)" fillOpacity={0.28} stroke="var(--forest-dark)" strokeWidth={2} strokeLinejoin="round" />
          )}
        </svg>
        {points.length === 0 && !result && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>
            Drag your finger to outline the spread area
          </div>
        )}
      </div>

      {/* Readout + actions */}
      <div style={{ padding: 16 }}>
        {result && (
          <div className="card" style={{ padding: '10px 12px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Area drawn</div>
              <div className="nutrient-num" style={{ fontSize: 18, color: 'var(--ink)' }}>{areaLabel}</div>
            </div>
            {showLoading && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>K₂O loading</div>
                <div className="nutrient-num" style={{ fontSize: 18, color: 'var(--forest-dark)' }}>~{kPerAc} <span style={{ fontSize: 12, color: 'var(--muted)' }}>kg/ac</span></div>
              </div>
            )}
            <button
              type="button" onClick={clear}
              style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, padding: '7px 10px', fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}
            >
              <Eraser size={13} /> Redraw
            </button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button" onClick={onCancel} className="btn-ghost"
            style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => result && onDone(result.geo, result.ha)}
            className="btn-primary"
            disabled={!result}
            style={{ flex: 2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: result ? 1 : 0.5 }}
          >
            <Check size={18} /> Use this area
          </button>
        </div>
      </div>
    </div>
  );
}
