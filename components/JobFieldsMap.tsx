'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Expand, X } from 'lucide-react';
import type { Map as MlMap, GeoJSONSource, StyleSpecification, Marker } from 'maplibre-gl';
import { clusterByGap, bboxDiagonalKm, type GeoPoint } from '@/lib/field-clusters';

type FStatus = 'pending' | 'done' | 'partial' | 'skipped';

interface MapField {
  id?: string;
  field_name: string;
  boundary: unknown | null;
  area_ha?: number | null;
  planned_rate_value?: number | null;
  planned_rate_unit?: string | null;
}

const STATUS_LABEL: Record<Exclude<FStatus, 'pending'>, string> = { done: 'done', partial: 'part done', skipped: 'not done' };
const HA_TO_AC = 2.47105;

function satelliteStyle(): StyleSpecification {
  const mtKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  const mbToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  // MapTiler (auto-capped) when its key is set; otherwise fall back to the same
  // Mapbox token the in-app maps use, so this shared card is never blank.
  const sat = mtKey
    ? { type: 'raster', url: `https://api.maptiler.com/tiles/satellite-v4/tiles.json?key=${mtKey}`, tileSize: 256, attribution: '© MapTiler © OpenStreetMap contributors' }
    : mbToken
    ? { type: 'raster', tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${mbToken}`], tileSize: 512, attribution: '© Mapbox © Maxar' }
    : { type: 'raster', url: 'https://api.maptiler.com/tiles/satellite-v4/tiles.json?key=', tileSize: 256, attribution: '© MapTiler © OpenStreetMap contributors' };
  return {
    version: 8,
    sources: { sat },
    layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
  } as unknown as StyleSpecification;
}

function centroidOf(geometry: { type: string; coordinates: unknown }): [number, number] | null {
  let sx = 0, sy = 0, n = 0;
  const walk = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === 'number') { sx += c[0] as number; sy += c[1] as number; n += 1; }
    else if (Array.isArray(c)) c.forEach(walk);
  };
  walk(geometry.coordinates);
  return n > 0 ? [sx / n, sy / n] : null;
}

// Marker face per status: hollow = still to do, solid green tick = done.
function paintMarker(el: HTMLDivElement, status: FStatus, idx: number) {
  const base = 'width:26px;height:26px;border-radius:50%;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.45);transition:background .15s';
  if (status === 'done') { el.style.cssText = `${base};background:#15803d;border:2px solid #fff;color:#fff`; el.textContent = '✓'; }
  else if (status === 'partial') { el.style.cssText = `${base};background:#f59e0b;border:2px solid #fff;color:#fff`; el.textContent = String(idx); }
  else if (status === 'skipped') { el.style.cssText = `${base};background:#64748b;border:2px solid #fff;color:#fff`; el.textContent = '✕'; }
  else { el.style.cssText = `${base};background:#fff;border:2.5px solid #15803d;color:#15803d`; el.textContent = String(idx); }
}

type MapItem = { f: MapField; idx: number; id: string };

function JobFieldsSubMap({
  items, height = 240, statuses, onSetStatus, detailLine, rateNoun, areaUnit = 'ha',
}: {
  items: MapItem[];
  height?: number;
  statuses?: Record<string, FStatus>;
  onSetStatus?: (id: string, s: FStatus) => void;
  detailLine?: string | null;
  rateNoun?: string | null;
  areaUnit?: 'ha' | 'ac';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const loadedRef = useRef(false);
  const markerEls = useRef<globalThis.Map<string, HTMLDivElement>>(new globalThis.Map());
  const markersRef = useRef<Marker[]>([]);
  const itemsRef = useRef(items);
  const statusesRef = useRef(statuses);
  const interactiveRef = useRef(!!onSetStatus);
  statusesRef.current = statuses;
  interactiveRef.current = !!onSetStatus;

  const [full, setFull] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<FStatus | null>(null);

  const interactive = !!onSetStatus;
  const feats = useMemo(
    () => itemsRef.current
      .map((it) => ({ idx: it.idx, id: it.id, f: it.f, geometry: it.f.boundary as { type: string; coordinates: unknown } | null }))
      .filter((x) => x.geometry && x.geometry.coordinates),
    [],
  );
  const statusOf = (id: string): FStatus => statuses?.[id] ?? 'pending';
  const doneCount = feats.filter((x) => statusOf(x.id) === 'done').length;

  // ---- init the map ONCE (fields are a per-job snapshot; never re-create) ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const maplibregl = (await import('maplibre-gl')).default;
      if (cancelled || !ref.current || mapRef.current || feats.length === 0) return;

      const map = new maplibregl.Map({ container: ref.current, style: satelliteStyle(), maxZoom: 17, center: [-2.7, 54.0], zoom: 11, attributionControl: { compact: true } });
      mapRef.current = map;

      // "Where am I?" — off by default; tapping it triggers the browser's own
      // location-permission prompt, then shows a blue dot + accuracy ring and
      // follows the user (tap again to stop). Pure client-side: the position
      // never leaves the phone.
      map.addControl(new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true, timeout: 10000 },
        trackUserLocation: true,
        showUserLocation: true,
        showAccuracyCircle: true,
        fitBoundsOptions: { maxZoom: 17 },
      }), 'bottom-right');

      map.on('load', () => {
        const st = statusesRef.current;
        const fc = {
          type: 'FeatureCollection',
          features: feats.map((x) => ({ type: 'Feature', properties: { idx: x.idx, fid: x.id, status: st?.[x.id] ?? 'pending' }, geometry: x.geometry })),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.addSource('fields', { type: 'geojson', data: fc as any });
        map.addLayer({
          id: 'fields-fill', type: 'fill', source: 'fields',
          paint: {
            'fill-color': ['match', ['get', 'status'], 'done', '#16a34a', 'partial', '#f59e0b', 'skipped', '#64748b', '#f59e0b'],
            'fill-opacity': ['match', ['get', 'status'], 'done', 0.34, 'partial', 0.34, 'skipped', 0.25, 0.18],
          },
        });
        map.addLayer({ id: 'fields-line', type: 'line', source: 'fields', paint: { 'line-color': '#ffffff', 'line-width': 2 } });

        let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
        const walk = (c: unknown) => {
          if (Array.isArray(c) && typeof c[0] === 'number') {
            const [lng, lat] = c as number[];
            if (lng < minLng) minLng = lng; if (lat < minLat) minLat = lat;
            if (lng > maxLng) maxLng = lng; if (lat > maxLat) maxLat = lat;
          } else if (Array.isArray(c)) c.forEach(walk);
        };
        feats.forEach((x) => {
          walk(x.geometry!.coordinates);
          const cen = centroidOf(x.geometry!);
          if (!cen) return;
          // 40px hit area around a 26px face — tractor-glove friendly.
          const hit = document.createElement('div');
          hit.style.cssText = 'width:40px;height:40px;display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation';
          const face = document.createElement('div');
          paintMarker(face, statusesRef.current?.[x.id] ?? 'pending', x.idx);
          hit.appendChild(face);
          markerEls.current.set(x.id, face);
          // Distance-based tap detection: a bare 'click' is unreliable on map
          // canvases (a few px of finger wobble and the pan handler eats it).
          const activate = () => {
            if (!interactiveRef.current) return;
            setSelected(x.id);
            setConfirming(null);
            setFull(true);
          };
          let downX = 0, downY = 0, downT = 0, handled = false;
          hit.addEventListener('pointerdown', (e) => {
            downX = e.clientX; downY = e.clientY; downT = Date.now(); handled = false;
            e.stopPropagation();
          });
          hit.addEventListener('pointerup', (e) => {
            const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
            if (moved <= 14 && Date.now() - downT < 800) { handled = true; e.stopPropagation(); e.preventDefault(); activate(); }
          });
          hit.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!handled) activate(); // desktop / fallback path
            handled = false;
          });
          const m = new maplibregl.Marker({ element: hit }).setLngLat(cen as [number, number]).addTo(map);
          markersRef.current.push(m);
        });
        if (minLng <= maxLng) {
          map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 44, maxZoom: 16, duration: 0 });
          // Fence panning to these fields + a generous margin: keeps the map on the
          // job's ground and caps stray tile loads, without feeling boxed-in.
          const padX = Math.max((maxLng - minLng) * 0.6, 0.015);
          const padY = Math.max((maxLat - minLat) * 0.6, 0.015);
          map.setMaxBounds([[minLng - padX, minLat - padY], [maxLng + padX, maxLat + padY]]);
        }
        loadedRef.current = true;
      });
    })();
    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      loadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- repaint markers + polygons when statuses change ----
  useEffect(() => {
    feats.forEach((x) => {
      const el = markerEls.current.get(x.id);
      if (el) paintMarker(el, statusOf(x.id), x.idx);
    });
    const map = mapRef.current;
    if (map && loadedRef.current) {
      const src = map.getSource('fields') as GeoJSONSource | undefined;
      if (src) {
        const fc = {
          type: 'FeatureCollection',
          features: feats.map((x) => ({ type: 'Feature', properties: { idx: x.idx, fid: x.id, status: statusOf(x.id) }, geometry: x.geometry })),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        src.setData(fc as any);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses]);

  // ---- fullscreen: move the whole wrapper onto <body> so position:fixed can
  // never be trapped by an ancestor (overflow, transform, webview quirks).
  const outerRef = useRef<HTMLDivElement>(null);
  const homeRef = useRef<{ parent: Node; next: Node | null } | null>(null);
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    if (full && el.parentNode !== document.body) {
      homeRef.current = { parent: el.parentNode as Node, next: el.nextSibling };
      document.body.appendChild(el);
      document.body.style.overflow = 'hidden';
    } else if (!full && homeRef.current && el.parentNode === document.body) {
      const { parent, next } = homeRef.current;
      if (next && next.parentNode === parent) parent.insertBefore(el, next); else parent.appendChild(el);
      homeRef.current = null;
      document.body.style.overflow = '';
    }
    const t1 = requestAnimationFrame(() => mapRef.current?.resize());
    const t2 = setTimeout(() => mapRef.current?.resize(), 280);
    return () => { cancelAnimationFrame(t1); clearTimeout(t2); document.body.style.overflow = ''; };
  }, [full]);

  // If we unmount while parked on <body> (e.g. navigation mid-fullscreen),
  // put the node back first so React's removeChild finds it where it expects.
  useEffect(() => () => {
    const el = outerRef.current;
    if (el && homeRef.current && el.parentNode === document.body) {
      const { parent, next } = homeRef.current;
      if (next && next.parentNode === parent) parent.insertBefore(el, next);
      else (parent as Element).appendChild(el);
    }
    document.body.style.overflow = '';
  }, []);

  // Belt-and-braces: resize whenever the container's size changes (fullscreen,
  // rotation, webview chrome appearing/disappearing).
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  if (feats.length === 0) return null;

  const sel = selected ? feats.find((x) => x.id === selected) ?? null : null;
  const fmtArea = (ha: number | null | undefined) =>
    ha == null ? '' : areaUnit === 'ac' ? `${(ha * HA_TO_AC).toFixed(2)} ac` : `${ha.toFixed(2)} ha`;

  const wrapStyle: React.CSSProperties = full
    ? { position: 'fixed', inset: 0, zIndex: 2000, background: '#0b132b', display: 'flex', flexDirection: 'column' }
    : { position: 'relative', width: '100%', height, borderRadius: 10, overflow: 'hidden', background: '#0b132b' };

  const chip: React.CSSProperties = { position: 'absolute', borderRadius: 8, background: 'rgba(13,19,43,0.82)', color: '#fff', fontSize: 12.5, fontWeight: 700, padding: '7px 11px', zIndex: 5 };

  return (
    <div ref={outerRef} style={wrapStyle}>
      <div ref={ref} style={{ width: '100%', height: '100%', flex: 1 }} />

      {/* progress chip */}
      {interactive && <div style={{ ...chip, top: full ? 'calc(env(safe-area-inset-top, 0px) + 10px)' : 8, left: 8 }}>{doneCount} of {feats.length} done</div>}

      {/* expand / close */}
      <button
        type="button"
        aria-label={full ? 'Close map' : 'Expand map'}
        onClick={() => { setFull(!full); setSelected(null); setConfirming(null); }}
        style={{ ...chip, top: full ? 'calc(env(safe-area-inset-top, 0px) + 10px)' : 8, right: 8, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, touchAction: 'manipulation' }}
      >
        {full ? <X size={16} /> : <Expand size={15} />}{full ? 'Close' : interactive ? 'Tick off on map' : 'Expand'}
      </button>

      {/* hint */}
      {full && interactive && !sel && (
        <div style={{ position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 18px)', left: 16, right: 16, textAlign: 'center', zIndex: 5, pointerEvents: 'none' }}>
          <span style={{ background: 'rgba(13,19,43,0.82)', color: '#fff', fontSize: 13, padding: '8px 14px', borderRadius: 99 }}>Tap a field number to tick it off</span>
        </div>
      )}

      {/* field card */}
      {full && sel && (
        <div style={{ position: 'absolute', left: 10, right: 10, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', zIndex: 6, background: 'var(--card, #fff)', borderRadius: 12, padding: 14, boxShadow: '0 6px 24px rgba(0,0,0,0.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink, #2b2b2b)' }}>
                <span style={{ display: 'inline-flex', width: 20, height: 20, borderRadius: '50%', background: '#15803d', color: '#fff', fontSize: 11, alignItems: 'center', justifyContent: 'center', marginRight: 8, verticalAlign: 'text-bottom' }}>{sel.idx}</span>
                {sel.f.field_name}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--muted, #777)', marginTop: 4 }}>
                {fmtArea(sel.f.area_ha)}{sel.f.planned_rate_value != null ? ` · ${sel.f.planned_rate_value} ${sel.f.planned_rate_unit ?? rateNoun ?? ''}` : ''}
              </div>
              {detailLine && <div style={{ fontSize: 12.5, color: 'var(--ink-soft, #555)', marginTop: 4, lineHeight: 1.4 }}>{detailLine}</div>}
            </div>
            <button type="button" aria-label="Close" onClick={() => { setSelected(null); setConfirming(null); }} style={{ background: 'none', border: 'none', color: 'var(--muted, #777)', cursor: 'pointer', padding: 2 }}><X size={17} /></button>
          </div>

          {confirming ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink, #2b2b2b)', marginBottom: 10 }}>Mark {sel.f.field_name} as {STATUS_LABEL[confirming as Exclude<FStatus, 'pending'>]}?</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={() => setConfirming(null)}>Cancel</button>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ flex: 1 }}
                  onClick={() => { onSetStatus?.(sel.id, confirming); setConfirming(null); setSelected(null); }}
                >
                  Yes — {STATUS_LABEL[confirming as Exclude<FStatus, 'pending'>]}
                </button>
              </div>
            </div>
          ) : (
            <div className="toggle-group" style={{ marginTop: 12 }}>
              {(['done', 'partial', 'skipped'] as const).map((v) => (
                <button key={v} type="button" className={`toggle-btn ${statusOf(sel.id) === v ? 'active' : ''}`} onClick={() => setConfirming(v)}>
                  {v === 'done' ? 'Done' : v === 'partial' ? 'Part' : 'Not done'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Outer wrapper: split a job's fields into separate maps when they fall into
// distinct areas (e.g. an outlying parcel a couple of km off) so the main block
// stays legible instead of one frame zooming right out. One map otherwise.
export function JobFieldsMap({
  fields, height = 240, statuses, onSetStatus, detailLine, rateNoun, areaUnit = 'ha',
}: {
  fields: MapField[];
  height?: number;
  statuses?: Record<string, FStatus>;
  onSetStatus?: (id: string, s: FStatus) => void;
  detailLine?: string | null;
  rateNoun?: string | null;
  areaUnit?: 'ha' | 'ac';
}) {
  const groups = useMemo<MapItem[][]>(() => {
    const items: (MapItem & GeoPoint)[] = [];
    fields.forEach((f, i) => {
      const geom = f.boundary as { type: string; coordinates: unknown } | null;
      if (!geom || !geom.coordinates) return;
      const cen = centroidOf(geom);
      if (!cen) return;
      items.push({ f, idx: i + 1, id: f.id ?? String(i), lng: cen[0], lat: cen[1] });
    });
    if (items.length < 2) return [items];
    const clusters = clusterByGap(items, 1.0);
    // Only split when fields are genuinely far apart and it stays legible: a
    // single group, a tight job (< 2 km across), or a very fragmented one all
    // render as one map.
    if (clusters.length <= 1 || bboxDiagonalKm(items) < 2.0 || clusters.length > 3) return [items];
    return [...clusters].sort((a, b) => b.length - a.length); // main block first
  }, [fields]);

  if (groups.length <= 1) {
    return (
      <JobFieldsSubMap items={groups[0] ?? []} height={height} statuses={statuses}
        onSetStatus={onSetStatus} detailLine={detailLine} rateNoun={rateNoun} areaUnit={areaUnit} />
    );
  }

  return (
    <div>
      {groups.map((g, gi) => {
        const n = g.length;
        const names = g.map((it) => it.f.field_name).filter(Boolean);
        const label = gi === 0
          ? `Main block · ${n} field${n === 1 ? '' : 's'}`
          : `${names.slice(0, 2).join(', ')}${n > 2 ? ` +${n - 2}` : ''} · ${n} field${n === 1 ? '' : 's'}`;
        return (
          <div key={gi} style={{ marginBottom: gi < groups.length - 1 ? 12 : 0 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted, #777)', textTransform: 'uppercase', letterSpacing: '.04em', margin: '0 2px 6px' }}>{label}</div>
            <JobFieldsSubMap items={g} height={height} statuses={statuses}
              onSetStatus={onSetStatus} detailLine={detailLine} rateNoun={rateNoun} areaUnit={areaUnit} />
          </div>
        );
      })}
    </div>
  );
}
