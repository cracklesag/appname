'use client';

import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';

interface MapField { field_name: string; boundary: unknown | null; }

function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Imagery © Esri' } },
    layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
  } as unknown as StyleSpecification;
}

// Rough centroid from all coordinates of a Polygon / MultiPolygon geometry.
function centroidOf(geometry: { type: string; coordinates: unknown }): [number, number] | null {
  let sx = 0, sy = 0, n = 0;
  const walk = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === 'number') { sx += c[0] as number; sy += c[1] as number; n += 1; }
    else if (Array.isArray(c)) c.forEach(walk);
  };
  walk(geometry.coordinates);
  return n > 0 ? [sx / n, sy / n] : null;
}

export function JobFieldsMap({ fields, height = 240 }: { fields: MapField[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const maplibregl = (await import('maplibre-gl')).default;
      if (cancelled || !ref.current || mapRef.current) return;

      const feats = fields
        .map((f, i) => ({ idx: i + 1, name: f.field_name, geometry: f.boundary as { type: string; coordinates: unknown } | null }))
        .filter((f) => f.geometry && f.geometry.coordinates);
      if (feats.length === 0) return;

      const map = new maplibregl.Map({ container: ref.current, style: satelliteStyle(), center: [-2.7, 54.0], zoom: 11, attributionControl: false });
      mapRef.current = map;

      map.on('load', () => {
        const fc = { type: 'FeatureCollection', features: feats.map((f) => ({ type: 'Feature', properties: { idx: f.idx }, geometry: f.geometry })) };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.addSource('fields', { type: 'geojson', data: fc as any });
        map.addLayer({ id: 'fields-fill', type: 'fill', source: 'fields', paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.22 } });
        map.addLayer({ id: 'fields-line', type: 'line', source: 'fields', paint: { 'line-color': '#ffffff', 'line-width': 2 } });

        let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
        const walk = (c: unknown) => {
          if (Array.isArray(c) && typeof c[0] === 'number') {
            const [lng, lat] = c as number[];
            if (lng < minLng) minLng = lng; if (lat < minLat) minLat = lat;
            if (lng > maxLng) maxLng = lng; if (lat > maxLat) maxLat = lat;
          } else if (Array.isArray(c)) c.forEach(walk);
        };
        feats.forEach((f) => {
          walk(f.geometry!.coordinates);
          const cen = centroidOf(f.geometry!);
          if (cen) {
            const el = document.createElement('div');
            el.textContent = String(f.idx);
            el.style.cssText = 'width:22px;height:22px;border-radius:50%;background:#15803d;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)';
            new maplibregl.Marker({ element: el }).setLngLat(cen as [number, number]).addTo(map);
          }
        });
        if (minLng <= maxLng) map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 44, maxZoom: 16, duration: 0 });
      });
    })();
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [fields]);

  return <div ref={ref} style={{ width: '100%', height, borderRadius: 10, overflow: 'hidden', background: '#0b132b' }} />;
}
