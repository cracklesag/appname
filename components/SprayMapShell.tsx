'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, X, MapPin } from 'lucide-react';
import type { Map as MlMap, GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import type { Position } from '@/lib/geo';

export interface SpraySummary {
  dateLabel: string;
  product: string;
  targets: string[];
  coverage: string;
  areaHa: number | null;
  /** Drawn sprayed sub-area (GeoJSON) when coverage === 'partial'. */
  polygon: object | null;
}
export interface SprayMapField {
  id: string;
  name: string;
  boundary: object; // GeoJSON Polygon/MultiPolygon, [lng,lat]
  sprays: SpraySummary[];
}

function buildSatelliteStyle(mapboxToken: string | null): StyleSpecification {
  const sources: any = mapboxToken
    ? {
        sat: {
          type: 'raster',
          tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${mapboxToken}`],
          tileSize: 512,
          attribution: '© Mapbox © Maxar',
        },
      }
    : {
        sat: {
          type: 'raster',
          url: `https://api.maptiler.com/tiles/satellite-v4/tiles.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY ?? ''}`,
          tileSize: 256,
          attribution: '© MapTiler © OpenStreetMap contributors',
        },
      };
  return { version: 8, sources, layers: [{ id: 'sat', type: 'raster', source: 'sat' }] } as unknown as StyleSpecification;
}

function coordsOf(geom: any): Position[] {
  const rings = geom?.type === 'Polygon' ? geom.coordinates : geom?.type === 'MultiPolygon' ? geom.coordinates.flat() : [];
  const out: Position[] = [];
  for (const ring of rings) for (const p of ring) out.push(p as Position);
  return out;
}

const MATCH_FILL = '#22c55e';   // sprayed & matches filter
const DIM_FILL = '#9aa0a6';     // sprayed but filtered out

export function SprayMapShell({
  fields,
  unitSystem,
  mapboxToken,
  fromHref,
}: {
  fields: SprayMapField[];
  unitSystem: 'acres' | 'hectares';
  mapboxToken: string | null;
  fromHref: string;
}) {
  const areaUnit = unitSystem === 'acres' ? 'ac' : 'ha';
  const toUnit = (ha: number) => (unitSystem === 'acres' ? ha * 2.47105 : ha);

  const sprayed = useMemo(() => fields.filter((f) => f.sprays.length > 0 && f.boundary), [fields]);
  const byId = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);

  const allTargets = useMemo(() => {
    const set = new Set<string>();
    for (const f of sprayed) for (const s of f.sprays) for (const t of s.targets) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [sprayed]);
  const allProducts = useMemo(() => {
    const set = new Set<string>();
    for (const f of sprayed) for (const s of f.sprays) set.add(s.product);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [sprayed]);

  const [target, setTarget] = useState('all');
  const [product, setProduct] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef(false);

  // One feature per spray: a PARTIAL spray shades only its drawn sub-area; a
  // whole-field spray shades the field boundary. `matched` reflects the filter.
  const sprayedFC = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: sprayed.flatMap((f) =>
      f.sprays.map((spr) => {
        const matched = (target === 'all' || spr.targets.includes(target)) && (product === 'all' || spr.product === product);
        const geometry = (spr.coverage === 'partial' && spr.polygon) ? spr.polygon : f.boundary;
        return {
          type: 'Feature' as const,
          geometry: geometry as any,
          properties: { fieldId: f.id, name: f.name, matched: matched ? 1 : 0 },
        };
      }),
    ),
  }), [sprayed, target, product]);

  // Init map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const maplibregl = (await import('maplibre-gl')).default;
      if (cancelled || !containerRef.current) return;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: buildSatelliteStyle(mapboxToken),
        maxZoom: 17,
        center: [-2.5, 54],
        zoom: 12,
      });
      mapRef.current = map;

      map.on('load', () => {
        if (cancelled) return;

        // All field outlines for context.
        map.addSource('allfields', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: fields.filter((f) => f.boundary).map((f) => ({
              type: 'Feature', geometry: f.boundary as any, properties: {},
            })),
          } as any,
        });
        map.addLayer({ id: 'allfields-line', type: 'line', source: 'allfields', paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.5 } });

        // Sprayed fields, filled by match state.
        map.addSource('sprayed', { type: 'geojson', data: sprayedFC as any });
        map.addLayer({
          id: 'sprayed-fill', type: 'fill', source: 'sprayed',
          paint: {
            'fill-color': ['match', ['get', 'matched'], 1, MATCH_FILL, DIM_FILL],
            'fill-opacity': ['match', ['get', 'matched'], 1, 0.55, 0.15],
          },
        });
        map.addLayer({
          id: 'sprayed-line', type: 'line', source: 'sprayed',
          paint: { 'line-color': ['match', ['get', 'matched'], 1, '#ffffff', '#cbd5e1'], 'line-width': ['match', ['get', 'matched'], 1, 2.5, 1] },
        });

        map.on('click', 'sprayed-fill', (e) => {
          const f = e.features && e.features[0];
          if (f) setSelectedId(String(f.properties?.fieldId ?? ''));
        });
        map.on('mouseenter', 'sprayed-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'sprayed-fill', () => { map.getCanvas().style.cursor = ''; });

        // Fit to sprayed fields (or all fields if none sprayed yet).
        const pts = (sprayed.length ? sprayed : fields).flatMap((f) => coordsOf(f.boundary));
        if (pts.length) {
          let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
          for (const [lng, lat] of pts) {
            if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
          }
          map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, maxZoom: 16, duration: 0 });
        }
        readyRef.current = true;
      });
    })();
    return () => {
      cancelled = true;
      readyRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Init once; filter changes are pushed via setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapboxToken]);

  // Push recolour on filter change without re-initialising the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource('sprayed') as GeoJSONSource | undefined;
    if (src) src.setData(sprayedFC as any);
  }, [sprayedFC]);

  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const matchesSpray = (s: SpraySummary) =>
    (target === 'all' || s.targets.includes(target)) && (product === 'all' || s.product === product);

  return (
    <div style={{ position: 'relative' }}>
      {/* Header + filters */}
      <div style={{ background: 'var(--forest-dark)', color: 'var(--brand-cream)', padding: '14px 16px' }}>
        <Link href={fromHref} className="hero-back" style={{ color: 'rgba(239,231,214,0.85)', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', fontSize: 13 }}>
          <ArrowLeft size={15} /> Spray records
        </Link>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '6px 0 2px' }}>Spray map</h1>
        <p style={{ fontSize: 12, color: 'rgba(239,231,214,0.75)', margin: 0 }}>Fields shaded green match the filter · tap a field for detail</p>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '10px 16px', background: '#F4EFE2', borderBottom: '1px solid #E4D9BD' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Target</div>
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} style={{ padding: '8px 10px' }}>
            <option value="all">All targets</option>
            {allTargets.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Product</div>
          <select className="input" value={product} onChange={(e) => setProduct(e.target.value)} style={{ padding: '8px 10px' }}>
            <option value="all">All products</option>
            {allProducts.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {sprayed.length === 0 && (
        <div style={{ padding: 16, fontSize: 13, color: 'var(--muted)', background: '#F4EFE2' }}>
          No spray records on mapped fields yet. Add a spray record (and map the field on the Farm map) to see it here.
        </div>
      )}

      <div ref={containerRef} style={{ width: '100%', height: 'calc(100vh - 230px)', minHeight: 320 }} />

      {/* Detail card */}
      {selected && (
        <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 6px 24px rgba(0,0,0,0.25)', padding: 14, maxHeight: '46%', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{selected.name}</div>
            <button type="button" onClick={() => setSelectedId(null)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><X size={18} /></button>
          </div>
          {selected.sprays.map((s, i) => {
            const hit = matchesSpray(s);
            return (
              <div key={i} style={{ padding: '8px 0', borderTop: i === 0 ? 'none' : '1px solid var(--line-soft)', opacity: hit ? 1 : 0.55 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{s.product}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{s.dateLabel}</div>
                </div>
                {s.targets.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                    {s.targets.map((t) => (
                      <span key={t} style={{ fontSize: 11, background: t === target ? MATCH_FILL : 'var(--forest-soft)', color: t === target ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', borderRadius: 12, padding: '2px 8px' }}>{t}</span>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 5 }}>
                  {s.coverage === 'partial'
                    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={11} /> Part field · {toUnit(s.areaHa ?? 0).toFixed(2)} {areaUnit}</span>
                    : <>Whole field{s.areaHa != null ? ` · ${toUnit(s.areaHa).toFixed(2)} ${areaUnit}` : ''}</>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
