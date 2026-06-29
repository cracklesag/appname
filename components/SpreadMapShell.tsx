'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import type { Map as MlMap, GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import { FertPlanRow, PlanState, planField } from '@/lib/fertplan';
import { nutrientPerArea } from '@/lib/rules';
import { ringsOfGeometry, type FieldGeometry, type Position } from '@/lib/geo';
import { Product } from '@/lib/types';

export interface SpreadMapField {
  id: string;
  name: string;
  boundary: object;            // GeoJSON Polygon/MultiPolygon
  centroid_lat: number | null;
  centroid_lng: number | null;
}

const DEFAULT_STATE: PlanState = {
  defaultOrganicId: '', defaultRate: '', overrides: {},
  excludedProductIds: [], excludedFieldIds: [], slurryOffFieldIds: [],
  granularOverrides: {},
};

// Three rate bands, light→heavy. Strong, satellite-readable colours.
const BAND_COLOURS = ['#fde047', '#fb923c', '#dc2626']; // yellow / orange / red
const BAND_LABELS = ['Light', 'Medium', 'Heavy'];

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

/** A field's planned dose of one product on this sheet. */
interface ProductField {
  id: string;
  name: string;
  rate: number;        // in display units (kg/ac or kg/ha)
  band: number;        // 0..2
  geometry: FieldGeometry;
  centroid: Position;
}

/** One product's whole sheet. */
interface ProductSheet {
  productName: string;
  unit: string;
  fields: ProductField[];
  bands: { min: number; max: number }[];   // rate range per band (display units)
  total: number;                            // total product (kg) for the header
}

function centroidOfGeometry(geom: FieldGeometry, fallback: Position): Position {
  const rings = ringsOfGeometry(geom);
  if (rings.length === 0) return fallback;
  let sx = 0, sy = 0, n = 0;
  for (const p of rings[0]) { sx += p[0]; sy += p[1]; n++; }
  return n ? [sx / n, sy / n] : fallback;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function SpreadMapShell({
  rows, geometry, products, unitSystem, slurryUnit, mode, mapboxToken, fromHref,
  minSpreadP2O5KgPerHa, minSpreadK2OKgPerHa,
}: {
  rows: FertPlanRow[];
  geometry: SpreadMapField[];
  products: Product[];
  unitSystem: 'acres' | 'hectares';
  slurryUnit: 'gal/ac' | 'm3/ha';
  mode: 'granular' | 'slurry';
  mapboxToken: string | null;
  fromHref: string;
  minSpreadP2O5KgPerHa: number;
  minSpreadK2OKgPerHa: number;
}) {
  const [state, setState] = useState<PlanState>(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('swardly_plan_state');
      if (raw) setState({ ...DEFAULT_STATE, ...JSON.parse(raw) });
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  const organics = useMemo(
    () => products.filter((p) => p.type === 'slurry' || p.type === 'solid_manure'),
    [products],
  );
  const granular = useMemo(() => products.filter((p) => p.type === 'bag_fert'), [products]);
  const geomById = useMemo(
    () => new Map(geometry.map((g) => [g.id, g])),
    [geometry],
  );

  const sys = unitSystem === 'acres' ? 'acres' : 'hectares';
  const isSlurry = mode === 'slurry';

  // Plan every field still on the list, then group into one sheet per product.
  const sheets = useMemo<ProductSheet[]>(() => {
    const planned = rows
      .filter((r) => !state.excludedFieldIds.includes(r.id))
      .map((r) => planField(r, state, organics, granular, {
        slurryUnit, unitSystem, minSpreadP2O5KgPerHa, minSpreadK2OKgPerHa,
      }));

    // Collect per product: productName -> [{field, rate(display), geometry}]
    type Raw = { id: string; name: string; rate: number; geom: FieldGeometry; centroid: Position };
    const byProduct = new Map<string, Raw[]>();

    const add = (productName: string, fieldId: string, fieldName: string, rateDisplay: number) => {
      const g = geomById.get(fieldId);
      if (!g || !g.boundary || rateDisplay <= 0) return; // only mappable, dosed fields
      const geom = g.boundary as FieldGeometry;
      const fallback: Position = [g.centroid_lng ?? 0, g.centroid_lat ?? 0];
      const centroid = (g.centroid_lng != null && g.centroid_lat != null)
        ? [g.centroid_lng, g.centroid_lat] as Position
        : centroidOfGeometry(geom, fallback);
      if (!byProduct.has(productName)) byProduct.set(productName, []);
      byProduct.get(productName)!.push({ id: fieldId, name: fieldName, rate: rateDisplay, geom, centroid });
    };

    for (const pf of planned) {
      if (isSlurry) {
        if (pf.organicName && pf.slurryTotal > 0) {
          // Slurry rate is the per-area rate the user set (already display-unit-ish).
          const rate = parseFloat(pf.rateStr) || 0;
          add(pf.organicName, pf.row.id, pf.row.name, rate);
        }
      } else {
        for (const pp of pf.planProducts) {
          // Convert kg/ha → display unit.
          const rateDisplay = Math.round(nutrientPerArea(pp.rateKgPerHa, sys));
          add(pp.productName, pf.row.id, pf.row.name, rateDisplay);
        }
      }
    }

    // Build a sheet per product, with 3 rate bands relative to that product's
    // own min/max on this list (so shading is meaningful for any product).
    const out: ProductSheet[] = [];
    for (const [productName, list] of byProduct) {
      const rates = list.map((r) => r.rate);
      const min = Math.min(...rates);
      const max = Math.max(...rates);
      const span = max - min;
      const bandOf = (rate: number): number => {
        if (span <= 0) return 1;                 // all the same → middle band
        const t = (rate - min) / span;           // 0..1
        return t < 1 / 3 ? 0 : t < 2 / 3 ? 1 : 2;
      };
      const bandRanges = [0, 1, 2].map((b) => {
        const inBand = list.filter((r) => bandOf(r.rate) === b).map((r) => r.rate);
        return inBand.length
          ? { min: Math.min(...inBand), max: Math.max(...inBand) }
          : { min: 0, max: 0 };
      });
      const unit = isSlurry
        ? (organics.find((o) => o.name === productName)?.type === 'solid_manure'
            ? (sys === 'acres' ? 't/ac' : 't/ha')
            : slurryUnit)
        : (sys === 'acres' ? 'kg/ac' : 'kg/ha');

      const fields: ProductField[] = list.map((r) => ({
        id: r.id, name: r.name, rate: r.rate, band: bandOf(r.rate), geometry: r.geom, centroid: r.centroid,
      }));

      // Total physical product (kg) across the sheet — informational header.
      // For granular we have totalKg on planProducts; recompute simply here.
      const total = 0; // header total is shown from list count instead (kept simple)

      out.push({ productName, unit, fields, bands: bandRanges, total });
    }
    // Stable order: most fields first.
    return out.sort((a, b) => b.fields.length - a.fields.length);
  }, [rows, state, organics, granular, geomById, slurryUnit, unitSystem, sys, isSlurry, minSpreadP2O5KgPerHa, minSpreadK2OKgPerHa]);

  const mappableCount = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sheets) for (const f of s.fields) ids.add(f.id);
    return ids.size;
  }, [sheets]);

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Controls (hidden in print) */}
      <div className="no-print" style={{ background: 'var(--forest-dark)', color: 'var(--brand-cream)', padding: '14px 16px' }}>
        <Link href={fromHref} className="hero-back" style={{ color: 'rgba(239,231,214,0.85)' }}>
          <ArrowLeft size={15} /> Back to list
        </Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>
              {isSlurry ? 'Slurry' : 'Granular'} map sheets
            </h1>
            <p style={{ fontSize: 12, color: 'rgba(239,231,214,0.75)', margin: '2px 0 0' }}>
              One page per product · fields shaded by rate
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--brand-cream)', color: 'var(--forest-dark)', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            <Printer size={15} /> Print / save PDF
          </button>
        </div>
      </div>

      <div className="no-print" style={{ padding: '10px 16px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, background: '#F4EFE2', borderBottom: '1px solid #E4D9BD' }}>
        Each product is on its own landscape page. Tip: in the print dialog choose <strong>Landscape</strong> and turn on
        “Background graphics” so the satellite imagery and colours print. A field getting two products appears on both pages.
      </div>

      {!loaded ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
      ) : sheets.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          {mappableCount === 0 && geometry.length === 0
            ? 'No field boundaries mapped yet — map your fields on the Farm map first, then the spread sheets can show them.'
            : 'Nothing to map for this spread list. Set rates on the fertiliser plan, then come back.'}
        </div>
      ) : (
        sheets.map((sheet, i) => (
          <ProductMapPage
            key={sheet.productName + i}
            sheet={sheet}
            mapboxToken={mapboxToken}
            isSlurry={isSlurry}
          />
        ))
      )}

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; }
          .map-page { page-break-after: always; break-after: page; }
          .map-page:last-child { page-break-after: auto; break-after: auto; }
        }
        @page { size: landscape; margin: 8mm; }
      `}</style>
    </div>
  );
}

/** One product = one landscape page: header + legend + satellite map. */
function ProductMapPage({
  sheet, mapboxToken, isSlurry,
}: {
  sheet: ProductSheet;
  mapboxToken: string | null;
  isSlurry: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<any[]>([]);

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
        // Let the WebGL canvas be captured when screenshotting/printing.
        canvasContextAttributes: { preserveDrawingBuffer: true },
      });
      mapRef.current = map;

      map.on('load', () => {
        if (cancelled) return;

        // Field fills coloured by band.
        const features = sheet.fields.map((f) => ({
          type: 'Feature' as const,
          geometry: f.geometry as any,
          properties: { name: f.name, rate: f.rate, band: f.band },
        }));
        map.addSource('sheet', { type: 'geojson', data: { type: 'FeatureCollection', features } as any });
        map.addLayer({
          id: 'sheet-fill',
          type: 'fill',
          source: 'sheet',
          paint: {
            'fill-color': [
              'match', ['get', 'band'],
              0, BAND_COLOURS[0],
              1, BAND_COLOURS[1],
              2, BAND_COLOURS[2],
              BAND_COLOURS[1],
            ],
            'fill-opacity': 0.55,
          },
        });
        map.addLayer({
          id: 'sheet-line',
          type: 'line',
          source: 'sheet',
          paint: { 'line-color': '#ffffff', 'line-width': 2 },
        });

        // Name + rate labels as HTML markers. The raster satellite style has
        // no glyphs endpoint, so a MapLibre symbol layer's text wouldn't
        // render; HTML markers are reliable and print as real DOM on top of
        // the captured canvas.
        for (const f of sheet.fields) {
          const el = document.createElement('div');
          el.style.cssText =
            'text-align:center;color:#fff;font-weight:700;font-size:12px;line-height:1.2;' +
            'text-shadow:0 0 3px #000,0 0 3px #000,0 1px 2px #000;pointer-events:none;white-space:nowrap;';
          el.innerHTML =
            `${escapeHtml(f.name)}<br><span style="font-weight:600">${f.rate} ${escapeHtml(sheet.unit)}</span>`;
          const marker = new maplibregl.Marker({ element: el }).setLngLat(f.centroid as any).addTo(map);
          markersRef.current.push(marker);
        }

        // Fit to all fields on this sheet, with padding. Tighter zoom when few.
        const all: Position[] = [];
        for (const f of sheet.fields) {
          const g = f.geometry as any;
          const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
          for (const ring of rings) for (const p of ring) all.push(p as Position);
        }
        if (all.length) {
          let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
          for (const [lng, lat] of all) {
            if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
          }
          map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
            padding: 70, maxZoom: 16, duration: 0,
          });
        }
      });
    })();
    return () => {
      cancelled = true;
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [sheet, mapboxToken]);

  return (
    <div className="map-page" style={{ padding: 16 }}>
      {/* Sheet header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
            {isSlurry ? 'Slurry spread' : 'Granular spread'}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)' }}>{sheet.productName}</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {sheet.fields.length} field{sheet.fields.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
        {[0, 1, 2].map((b) => {
          const r = sheet.bands[b];
          if (r.max === 0 && r.min === 0) return null;
          const label = r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
          return (
            <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ width: 16, height: 12, borderRadius: 3, background: BAND_COLOURS[b], border: '1px solid rgba(0,0,0,0.2)' }} />
              <span style={{ color: 'var(--ink)' }}>
                <strong>{BAND_LABELS[b]}</strong> {label} {sheet.unit}
              </span>
            </div>
          );
        })}
      </div>

      {/* The map */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: 540, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}
      />
    </div>
  );
}
