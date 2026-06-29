"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// components/TopicMap.tsx
// Read-only map for report pages ("topic maps"). Renders field boundaries on a
// satellite basemap coloured by a single topic (lime status / P / K / block /
// type / agreement). No editing — it reuses the shared colour logic so it can
// never drift from the whole-farm map. maplibre-gl loads lazily, only once the
// card is expanded, so report pages stay light by default.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MlMap, GeoJSONSource, MapMouseEvent, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ChevronDown, ChevronRight, Map as MapIcon } from "lucide-react";
import {
  buildColouring, valueLabelFor, COLOURS,
  type ColourField, type ColourMode, type ColourLabels,
} from "@/lib/map-colours";

const MODE_LABEL: Record<ColourMode, string> = {
  none: "Plain", ph: "Lime status", p: "P index", k: "K index",
  block: "Block", type: "Allocation type", agreement: "Agreement",
};

function buildSatelliteStyle(token: string | null): StyleSpecification {
  const sources: any = token
    ? { sat: { type: "raster", tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${token}`], tileSize: 512, attribution: "© Mapbox © Maxar" } }
    : { sat: { type: "raster", url: `https://api.maptiler.com/tiles/satellite-v4/tiles.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY ?? ''}`, tileSize: 256, attribution: "© MapTiler © OpenStreetMap contributors" } };
  return { version: 8, sources, layers: [{ id: "sat", type: "raster", source: "sat" }] } as unknown as StyleSpecification;
}

function boundsOf(fields: ColourField[]): [[number, number], [number, number]] | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const visit = (coords: any) => {
    if (typeof coords[0] === "number") {
      const [lng, lat] = coords;
      if (lng < minLng) minLng = lng; if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng; if (lat > maxLat) maxLat = lat;
    } else for (const c of coords) visit(c);
  };
  for (const f of fields) if (f.boundary) visit(f.boundary.coordinates);
  if (minLng === Infinity) return null;
  return [[minLng, minLat], [maxLng, maxLat]];
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export function TopicMap({
  fields, modes, labels, title = "Map", defaultOpen = false, height = 300,
}: {
  fields: ColourField[];
  modes: ColourMode[];
  labels?: ColourLabels;
  title?: string;
  defaultOpen?: boolean;
  height?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [mode, setMode] = useState<ColourMode>(modes[0] ?? "none");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  const token = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN as string | undefined) ?? null;
  const lab: ColourLabels = labels ?? { block: {}, type: {}, agreement: {} };
  const mapped = useMemo(() => fields.filter((f) => f.boundary), [fields]);
  const colouring = useMemo(() => buildColouring(mapped, mode, lab), [mapped, mode, lab]);
  const fieldsById = useMemo(() => new Map(mapped.map((f) => [f.id, f])), [mapped]);

  // Init the map once the card is opened. Tears down on collapse/unmount.
  useEffect(() => {
    if (!open || mapped.length === 0) return;
    let cancelled = false;
    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: buildSatelliteStyle(token),
        maxZoom: 17,
        center: [-1.6, 53.0],
        zoom: 5,
        attributionControl: { compact: true },
      } as any);
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        const toFC = () => ({
          type: "FeatureCollection" as const,
          features: mapped.map((f) => ({
            type: "Feature" as const, geometry: f.boundary,
            properties: { id: f.id, name: f.name, colour: colouring.colourOf(f) },
          })),
        });
        map.addSource("fields", { type: "geojson", data: toFC() as any });
        map.addLayer({ id: "fields-fill", type: "fill", source: "fields", paint: { "fill-color": ["get", "colour"], "fill-opacity": 0.45 } });
        map.addLayer({ id: "fields-line", type: "line", source: "fields", paint: { "line-color": "#ffffff", "line-width": 2.5 } });

        const b = boundsOf(mapped);
        if (b) map.fitBounds(b, { padding: 36, maxZoom: 16, duration: 0 });
        map.resize();

        map.on("click", "fields-fill", (e: MapMouseEvent & { features?: any[] }) => {
          const ft = e.features?.[0];
          if (!ft) return;
          const f = fieldsById.get(ft.properties?.id);
          if (!f) return;
          const html = `<div style="font-weight:700;margin-bottom:2px">${escapeHtml(f.name)}</div><div style="font-size:12px;color:#555">${escapeHtml(valueLabelFor(f, mode, lab))}</div>`;
          popupRef.current?.remove();
          popupRef.current = new maplibregl.Popup({ closeButton: true }).setLngLat(e.lngLat).setHTML(html).addTo(map);
        });
        map.on("mouseenter", "fields-fill", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "fields-fill", () => { map.getCanvas().style.cursor = ""; });

        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      popupRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mapped.length, token]);

  // Recolour when the mode (or data) changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource("fields") as GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: mapped.map((f) => ({ type: "Feature", geometry: f.boundary, properties: { id: f.id, name: f.name, colour: colouring.colourOf(f) } })),
    } as any);
  }, [colouring, mapped, ready]);

  const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden", marginBottom: 12 };

  return (
    <div style={card}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", padding: "12px 14px", cursor: "pointer", fontFamily: "inherit" }}
      >
        <MapIcon size={16} style={{ color: "var(--forest)" }} />
        <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>{open ? title : `Show ${title.toLowerCase()}`}</span>
        <span style={{ marginLeft: "auto", color: "var(--muted)" }}>{open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
      </button>

      {open && (
        <div style={{ padding: "0 14px 14px" }}>
          {modes.length > 1 && (
            <div className="toggle-group" role="group" aria-label="Colour by" style={{ flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {modes.map((m) => (
                <button key={m} type="button" className={`toggle-btn ${mode === m ? "active" : ""}`} onClick={() => setMode(m)} style={{ fontSize: 13, padding: "6px 12px" }}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          )}

          {mapped.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)", padding: "16px 2px" }}>
              No mapped field boundaries yet. Add boundaries on the Farm map to see this.
            </div>
          ) : (
            <>
              <div ref={containerRef} style={{ height, borderRadius: 10, overflow: "hidden", background: "var(--paper-deep)" }} />
              {colouring.legend.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 10 }}>
                  {colouring.legend.map((row, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-soft)" }}>
                      <span style={{ width: 11, height: 11, borderRadius: 3, background: row.colour, flexShrink: 0 }} />
                      {row.label}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>Tap a field for its value. Read-only — edit boundaries on the Farm map.</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
