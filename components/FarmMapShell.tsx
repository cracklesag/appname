"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// components/FarmMapShell.tsx
// Whole-farm map. Renders field boundaries on a satellite basemap, colours them by a chosen
// status, lets the farmer adopt their registered RPA parcels by SBI (England) or draw a field
// by hand, and reconcile mapped vs entered area.
//
// Renderer: MapLibre GL (open-source). Basemap is Mapbox Satellite when a token is set, else
// Esri World Imagery for preview. maplibre-gl is imported dynamically (it touches `window`).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type {
  Map as MlMap,
  GeoJSONSource,
  MapMouseEvent,
  StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { RpaParcel } from "@/lib/rpa";
import { locateFieldAtPoint, snapPoint, ringsOfGeometry, type FieldGeometry, type LocatableField, type SnapRing } from "@/lib/geo";
import {
  saveFarmMapSettings,
  getAdoptableParcels,
  adoptParcel,
  saveDrawnBoundary,
  acceptMappedArea,
} from "@/lib/map-actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type MapField = {
  id: string;
  name: string;
  ha: number;
  acres: number;
  ph: number | null;
  p_idx: number | null;
  k_idx: number | null;
  limeStatus?: 'ok' | 'low' | 'due' | 'unknown';
  boundary: any | null; // GeoJSON geometry, [lng,lat]
  centroid_lat: number | null;
  centroid_lng: number | null;
  area_ha_mapped: number | null;
  boundary_source: string | null;
  rpa_sheet_id: string | null;
  rpa_parcel_id: string | null;
};

type MapSettings = {
  sbi: string | null;
  os_licence_accepted_at: string | null;
  os_licence_acceptor: string | null;
} | null;

type Props = {
  fields: MapField[];
  mapSettings: MapSettings;
  mapboxToken: string | null;
};

type Mode = "view" | "adopt" | "draw";
type ColourMode = "none" | "ph" | "p" | "k";

// ---------------------------------------------------------------------------
// Constants — colours echo the app's forest / amber / red conventions.
// INTEGRATION: swap these for the app's exact design tokens if they differ.
// ---------------------------------------------------------------------------
const COLOURS = {
  good: "#3f8f4f",
  warn: "#e0a210",
  bad: "#d6492f",
  unknown: "#9aa0a6",
  neutral: "#2f7d6a",
  parcel: "#22d3ee",
  draw: "#f59e0b",
  allocated: "#f97316", // already-adopted parcels — strong orange, reads clearly on satellite
};

const UK_DEFAULT: { center: [number, number]; zoom: number } = {
  center: [-1.6, 53.0],
  zoom: 5.2,
};

const VIEW_KEY = "swardly_map_view";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
function indexColour(v: number | null): string {
  if (v == null) return COLOURS.unknown;
  if (v <= 1) return COLOURS.bad; // deficient → build up
  if (v === 2) return COLOURS.good; // target
  return COLOURS.warn; // index 3+ → high, hold
}

function statusColourFor(f: MapField, mode: ColourMode): string {
  if (mode === "none") return COLOURS.neutral;
  if (mode === "ph") {
    // Lime status from the recommendation engine (server-computed).
    if (!f.limeStatus || f.limeStatus === "unknown") return COLOURS.unknown;
    if (f.limeStatus === "ok") return COLOURS.good;
    if (f.limeStatus === "low") return COLOURS.warn;
    return COLOURS.bad; // 'due'
  }
  if (mode === "p") return indexColour(f.p_idx);
  return indexColour(f.k_idx);
}

function fieldsToFC(fields: MapField[], mode: ColourMode) {
  return {
    type: "FeatureCollection" as const,
    features: fields
      .filter((f) => f.boundary)
      .map((f) => ({
        type: "Feature" as const,
        geometry: f.boundary,
        properties: {
          id: f.id,
          name: f.name,
          colour: statusColourFor(f, mode),
          ha: f.ha,
          mapped: f.area_ha_mapped,
          source: f.boundary_source ?? "",
        },
      })),
  };
}

/** Key identifying an RPA parcel: sheet + parcel id. */
function parcelKey(sheetId: string | null, parcelId: string | null): string {
  return `${sheetId ?? ""}|${parcelId ?? ""}`;
}

function parcelsToFC(parcels: RpaParcel[], allocated: Map<string, string>) {
  return {
    type: "FeatureCollection" as const,
    features: parcels.map((p) => {
      const fieldName = allocated.get(parcelKey(p.sheetId, p.parcelId)) ?? null;
      return {
        type: "Feature" as const,
        geometry: p.geometry,
        properties: {
          rpaId: p.rpaId,
          ref: `${p.sheetId} ${p.parcelId}`,
          areaHa: p.areaHa,
          allocated: fieldName ? 1 : 0,
          fieldName: fieldName ?? "",
        },
      };
    }),
  };
}

function drawToFC(points: [number, number][]) {
  const features: any[] = [];
  if (points.length >= 3) {
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...points, points[0]]] },
      properties: {},
    });
  }
  if (points.length >= 2) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: points },
      properties: {},
    });
  }
  for (const p of points) {
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} });
  }
  return { type: "FeatureCollection" as const, features };
}

function buildSatelliteStyle(mapboxToken: string | null): StyleSpecification {
  const sources: any = mapboxToken
    ? {
        sat: {
          type: "raster",
          tiles: [
            `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${mapboxToken}`,
          ],
          tileSize: 256,
          attribution: "© Mapbox © Maxar",
        },
      }
    : {
        sat: {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          attribution:
            "Imagery © Esri, Maxar, Earthstar Geographics — preview only; set a Mapbox token for production",
        },
      };
  return { version: 8, sources, layers: [{ id: "sat", type: "raster", source: "sat" }] } as unknown as StyleSpecification;
}

function readSavedView(): { center: [number, number]; zoom: number } | null {
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (Array.isArray(v.center) && typeof v.zoom === "number") return v;
  } catch {
    /* ignore */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function FarmMapShell({ fields, mapSettings, mapboxToken }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const mlRef = useRef<any>(null); // the maplibre-gl module (for Popup)
  const popupRef = useRef<any>(null);
  const geolocateRef = useRef<any>(null);

  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [colourMode, setColourMode] = useState<ColourMode>("none");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // current GPS location → which field am I in
  const [currentLoc, setCurrentLoc] = useState<{
    position: [number, number];
    accuracyMeters: number | null;
    insideId: string | null;
    nearestId: string | null;
    nearestMeters: number | null;
  } | null>(null);

  // SBI / licence
  const licenceAccepted = !!mapSettings?.os_licence_accepted_at;
  const [sbi, setSbi] = useState(mapSettings?.sbi ?? "");
  const [licenceChecked, setLicenceChecked] = useState(licenceAccepted);
  const [acceptor, setAcceptor] = useState(mapSettings?.os_licence_acceptor ?? "");

  // adopt
  const [parcels, setParcels] = useState<RpaParcel[]>([]);
  const [selectedParcel, setSelectedParcel] = useState<RpaParcel | null>(null);
  const router = useRouter();
  const [adoptTarget, setAdoptTarget] = useState<string>(""); // "" = new field
  const [newFieldName, setNewFieldName] = useState("");

  // draw
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [drawFinished, setDrawFinished] = useState<FieldGeometry | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [drawName, setDrawName] = useState("");
  const [drawTarget, setDrawTarget] = useState<string>("");

  // refs that map event handlers read (avoid stale closures)
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const parcelsRef = useRef(parcels);
  parcelsRef.current = parcels;

  // mapped fields in the shape the GPS locator needs (boundary + centroid)
  const locatable = useMemo<LocatableField[]>(
    () =>
      fields
        .filter((f) => f.boundary)
        .map((f) => ({
          id: f.id,
          geometry: f.boundary as FieldGeometry,
          centroid:
            f.centroid_lng != null && f.centroid_lat != null
              ? { lng: f.centroid_lng, lat: f.centroid_lat }
              : null,
        })),
    [fields]
  );
  const locatableRef = useRef(locatable);
  locatableRef.current = locatable;

  const fieldsById = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.id, f])),
    [fields]
  );

  const unmappedFields = useMemo(() => fields.filter((f) => !f.boundary), [fields]);

  // Map of already-adopted parcels: "sheetId|parcelId" -> field name. Lets the
  // adopt overlay show which registered parcels are already saved as fields, so
  // re-pulling the SBI doesn't look like a fresh slate.
  const allocatedParcels = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fields) {
      if (f.boundary_source === "rpa" && (f.rpa_sheet_id || f.rpa_parcel_id)) {
        m.set(parcelKey(f.rpa_sheet_id, f.rpa_parcel_id), f.name);
      }
    }
    return m;
  }, [fields]);
  const allocatedRef = useRef(allocatedParcels);
  allocatedRef.current = allocatedParcels;

  // Boundary rings the draw tool can snap to: every mapped field's boundary
  // plus every pulled parcel. Rebuilt when fields/parcels change; read via a
  // ref inside the (init-once) click handler.
  const snapRings = useMemo<SnapRing[]>(() => {
    const rings: SnapRing[] = [];
    for (const f of fields) rings.push(...ringsOfGeometry(f.boundary as FieldGeometry | null));
    for (const p of parcels) rings.push(...ringsOfGeometry(p.geometry as FieldGeometry));
    return rings;
  }, [fields, parcels]);
  const snapRingsRef = useRef(snapRings);
  snapRingsRef.current = snapRings;
  const snapEnabledRef = useRef(snapEnabled);
  snapEnabledRef.current = snapEnabled;
  const drawPointsRef = useRef(drawPoints);
  drawPointsRef.current = drawPoints;

  const flash = useCallback((m: string) => {
    setMessage(m);
    window.setTimeout(() => setMessage(null), 3500);
  }, []);

  // --- init map once -------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !containerRef.current) return;
      mlRef.current = maplibregl;

      const saved = readSavedView();
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: buildSatelliteStyle(mapboxToken),
        center: saved?.center ?? UK_DEFAULT.center,
        zoom: saved?.zoom ?? UK_DEFAULT.zoom,
        // attribution control is shown by default — required to credit the imagery source
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      // "You are here" + which-field detection.
      const geolocate = new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserLocation: true,
        showAccuracyCircle: true,
      });
      geolocateRef.current = geolocate;
      map.addControl(geolocate, "top-right");

      geolocate.on("geolocate", (e: any) => {
        const point: [number, number] = [e.coords.longitude, e.coords.latitude];
        const loc = locateFieldAtPoint(point, locatableRef.current);
        setCurrentLoc({
          position: point,
          accuracyMeters: e.coords.accuracy ?? null,
          insideId: loc.insideId,
          nearestId: loc.nearestId,
          nearestMeters: loc.nearestMeters,
        });
      });
      geolocate.on("trackuserlocationend", () => setCurrentLoc(null));
      geolocate.on("error", () => setCurrentLoc(null));

      map.on("load", () => {
        // Sources
        map.addSource("fields", { type: "geojson", data: fieldsToFC(fields, "none") as any });
        map.addSource("parcels", { type: "geojson", data: parcelsToFC([], new Map()) as any });
        map.addSource("draw", { type: "geojson", data: drawToFC([]) as any });

        // Field layers
        map.addLayer({
          id: "fields-fill",
          type: "fill",
          source: "fields",
          paint: { "fill-color": ["get", "colour"], "fill-opacity": 0.35 },
        });
        map.addLayer({
          id: "fields-line",
          type: "line",
          source: "fields",
          paint: { "line-color": ["get", "colour"], "line-width": 2 },
        });

        // Parcel layers (hidden until adopt mode). Allocated parcels (already
        // saved as a field) shade orange; available ones stay cyan.
        map.addLayer({
          id: "parcels-fill",
          type: "fill",
          source: "parcels",
          layout: { visibility: "none" },
          paint: {
            "fill-color": ["case", ["==", ["get", "allocated"], 1], COLOURS.allocated, COLOURS.parcel],
            "fill-opacity": ["case", ["==", ["get", "allocated"], 1], 0.4, 0.18],
          },
        });
        map.addLayer({
          id: "parcels-line",
          type: "line",
          source: "parcels",
          layout: { visibility: "none" },
          paint: {
            "line-color": ["case", ["==", ["get", "allocated"], 1], COLOURS.allocated, COLOURS.parcel],
            "line-width": 2,
            "line-dasharray": [2, 1],
          },
        });

        // Draw layers (hidden until draw mode)
        map.addLayer({
          id: "draw-fill",
          type: "fill",
          source: "draw",
          layout: { visibility: "none" },
          paint: { "fill-color": COLOURS.draw, "fill-opacity": 0.2 },
        });
        map.addLayer({
          id: "draw-line",
          type: "line",
          source: "draw",
          layout: { visibility: "none" },
          paint: { "line-color": COLOURS.draw, "line-width": 2 },
        });
        map.addLayer({
          id: "draw-points",
          type: "circle",
          source: "draw",
          layout: { visibility: "none" },
          paint: { "circle-radius": 5, "circle-color": COLOURS.draw, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 },
        });

        // Fit to mapped fields, if any
        fitToFields(map, fields);
        setReady(true);
      });

      // Field popups (view mode only)
      map.on("click", "fields-fill", (e: MapMouseEvent & { features?: any[] }) => {
        if (modeRef.current !== "view") return;
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties || {};
        const mappedTxt =
          p.mapped != null ? `${Number(p.mapped).toFixed(2)} ha mapped` : "no mapped area";
        const html = `<div style="font:13px/1.4 system-ui;min-width:140px">
            <strong>${escapeHtml(p.name)}</strong><br/>
            ${Number(p.ha).toFixed(2)} ha entered · ${mappedTxt}<br/>
            <span style="color:#6b7280">source: ${escapeHtml(p.source || "—")}</span><br/>
            <a href="/fields/${encodeURIComponent(p.id)}" style="color:#2f7d6a">Open field →</a>
          </div>`;
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: true })
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(map);
      });

      // Parcel selection (adopt mode)
      map.on("click", "parcels-fill", (e: MapMouseEvent & { features?: any[] }) => {
        if (modeRef.current !== "adopt") return;
        const props = e.features?.[0]?.properties ?? {};
        const id = props.rpaId;
        const parcel = parcelsRef.current.find((pp) => pp.rpaId === String(id));
        if (!parcel) return;
        // Already a field? Tell the user rather than offering to adopt it again.
        const allocatedName = allocatedRef.current.get(parcelKey(parcel.sheetId, parcel.parcelId));
        if (allocatedName) {
          flash(`Already saved as “${allocatedName}”.`);
          return;
        }
        setSelectedParcel(parcel);
        setAdoptTarget("");
        setNewFieldName("");
      });

      // Draw: add a vertex on any click while drawing
      map.on("click", (e: MapMouseEvent) => {
        if (modeRef.current !== "draw" || drawFinishedRef.current) return;
        let pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        if (snapEnabledRef.current) {
          // Snap to known boundaries (parcels + mapped fields) and to the
          // user's own drawing so far, within tolerance.
          const ownRing = drawPointsRef.current.length
            ? [drawPointsRef.current as [number, number][]]
            : [];
          const res = snapPoint(pt, [...snapRingsRef.current, ...ownRing], 14);
          pt = res.point;
        }
        setDrawPoints((pts) => [...pts, pt]);
      });

      map.on("mouseenter", "fields-fill", () => {
        if (modeRef.current === "view") map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "fields-fill", () => {
        if (modeRef.current === "view") map.getCanvas().style.cursor = "";
      });

      map.on("moveend", () => {
        const c = map.getCenter();
        try {
          window.localStorage.setItem(
            VIEW_KEY,
            JSON.stringify({ center: [c.lng, c.lat], zoom: map.getZoom() })
          );
        } catch {
          /* ignore */
        }
      });
    })();

    return () => {
      cancelled = true;
      popupRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep a ref of "draw finished" so the click handler can early-out
  const drawFinishedRef = useRef<FieldGeometry | null>(null);
  drawFinishedRef.current = drawFinished;

  // --- update field source when data or colour changes ---------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("fields") as GeoJSONSource | undefined)?.setData(
      fieldsToFC(fields, colourMode) as any
    );
  }, [fields, colourMode, ready]);

  // --- parcels source ------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("parcels") as GeoJSONSource | undefined)?.setData(parcelsToFC(parcels, allocatedParcels) as any);
  }, [parcels, allocatedParcels, ready]);

  // --- draw source ---------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("draw") as GeoJSONSource | undefined)?.setData(drawToFC(drawPoints) as any);
  }, [drawPoints, ready]);

  // --- mode → layer visibility + cursor ------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const vis = (id: string, on: boolean) =>
      map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    vis("parcels-fill", mode === "adopt");
    vis("parcels-line", mode === "adopt");
    vis("draw-fill", mode === "draw");
    vis("draw-line", mode === "draw");
    vis("draw-points", mode === "draw");
    map.getCanvas().style.cursor = mode === "draw" ? "crosshair" : "";
    popupRef.current?.remove();
  }, [mode, ready]);

  // --- handlers ------------------------------------------------------------
  async function handleSaveSbiAndPull() {
    setBusy(true);
    const fd = new FormData();
    fd.set("sbi", sbi);
    fd.set("licence_accepted", licenceChecked ? "true" : "false");
    fd.set("acceptor", acceptor);
    const saved = await saveFarmMapSettings(fd);
    if (!saved.ok) {
      setBusy(false);
      flash(saved.error);
      return;
    }
    const res = await getAdoptableParcels();
    setBusy(false);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    const list = res.data ?? [];
    setParcels(list);
    if (list.length === 0) flash("No registered parcels found for that SBI.");
    else {
      const done = list.filter((p) => allocatedRef.current.has(parcelKey(p.sheetId, p.parcelId))).length;
      const available = list.length - done;
      flash(
        done > 0
          ? `${list.length} parcels — ${available} to adopt, ${done} already saved (orange).`
          : `Found ${list.length} parcels — tap one to adopt.`
      );
      fitToParcels(mapRef.current, list);
    }
  }

  async function handleAdoptConfirm() {
    if (!selectedParcel) return;
    setBusy(true);
    const res = await adoptParcel({
      parcel: selectedParcel,
      fieldId: adoptTarget || undefined,
      newFieldName: adoptTarget ? undefined : newFieldName,
    });
    setBusy(false);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    flash("Boundary linked.");
    setSelectedParcel(null);
    // Drop the adopted parcel from the overlay and refresh server data.
    setParcels((ps) => ps.filter((p) => p.rpaId !== selectedParcel.rpaId));
    softRefresh();
  }

  function finishDrawing() {
    if (drawPoints.length < 3) return;
    const geometry: FieldGeometry = {
      type: "Polygon",
      coordinates: [[...drawPoints, drawPoints[0]]],
    };
    setDrawFinished(geometry);
  }

  async function handleSaveDrawn() {
    if (!drawFinished) return;
    setBusy(true);
    const res = await saveDrawnBoundary({
      geometry: drawFinished,
      fieldId: drawTarget || undefined,
      newFieldName: drawTarget ? undefined : drawName,
    });
    setBusy(false);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    flash("Field saved.");
    resetDraw();
    setMode("view");
    softRefresh();
  }

  function resetDraw() {
    setDrawPoints([]);
    setDrawFinished(null);
    setDrawName("");
    setDrawTarget("");
  }

  function softRefresh() {
    // Re-run the server page so the newly saved boundary flows back as props,
    // WITHOUT a full page reload — that would wipe the in-memory parcel list
    // and force a re-pull before adopting the next field. router.refresh()
    // re-fetches the server component while preserving this client component's
    // state, so the remaining parcels stay on screen and you can loop straight
    // to the next one.
    router.refresh();
  }

  // --- render --------------------------------------------------------------
  return (
    <div className="swardly-map relative" style={{ height: "calc(100vh - 64px)" }}>
      <MapStyles />
      <div ref={containerRef} className="absolute inset-0" />

      {/* "Which field am I in" banner (top-left) — driven by the locate control */}
      <LocateBanner loc={currentLoc} fieldsById={fieldsById} />

      {/* Status colour switcher + legend */}
      <div className="absolute right-3 top-3 z-10 rounded-xl bg-white/95 px-3 py-2 shadow-md backdrop-blur">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-stone-500">
          Colour by
        </label>
        <select
          value={colourMode}
          onChange={(e) => setColourMode(e.target.value as ColourMode)}
          className="mt-1 w-36 rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm"
        >
          <option value="none">No status</option>
          <option value="ph">Lime status</option>
          <option value="p">P index</option>
          <option value="k">K index</option>
        </select>
        {colourMode !== "none" && (
          <div className="mt-2 space-y-1 text-[11px] text-stone-600">
            <LegendRow colour={COLOURS.good} label={colourMode === "ph" ? "At/above target" : "Index 2 (target)"} />
            <LegendRow colour={COLOURS.warn} label={colourMode === "ph" ? "Slightly low" : "Index 3+ (high)"} />
            <LegendRow colour={COLOURS.bad} label={colourMode === "ph" ? "Low — lime due" : "Index 0–1 (low)"} />
            <LegendRow colour={COLOURS.unknown} label="Not sampled" />
          </div>
        )}
      </div>

      {/* Message toast */}
      {message && (
        <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full bg-stone-900/90 px-4 py-2 text-sm text-white shadow-lg">
          {message}
        </div>
      )}

      {/* Bottom control panel */}
      <div className="absolute inset-x-0 bottom-0 z-10">
        <div className="mx-auto max-w-2xl rounded-t-2xl bg-white/97 p-4 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur">
          {/* Mode tabs */}
          <div className="flex gap-2">
            <ModeButton active={mode === "view"} onClick={() => setMode("view")}>
              View
            </ModeButton>
            <ModeButton
              active={mode === "adopt"}
              onClick={() => {
                resetDraw();
                setMode("adopt");
              }}
            >
              Adopt parcels
            </ModeButton>
            <ModeButton
              active={mode === "draw"}
              onClick={() => {
                setSelectedParcel(null);
                setMode("draw");
              }}
            >
              Draw a field
            </ModeButton>
          </div>

          {/* View mode helper */}
          {mode === "view" && (
            <p className="mt-3 text-sm text-stone-600">
              {fields.some((f) => f.boundary)
                ? "Tap a field for its details, or tap the ◎ (top-right) to find your location and the field you’re standing in. Use “Colour by” to shade fields by status."
                : "No fields mapped yet. Adopt your registered parcels, or draw a field by hand."}
            </p>
          )}

          {/* Adopt mode */}
          {mode === "adopt" && (
            <div className="mt-3">
              {!licenceAccepted && (
                <div className="rounded-lg bg-stone-50 p-3 text-sm text-stone-700">
                  <p className="mb-2">
                    Enter your <strong>SBI</strong> (9-digit Single Business Identifier) to pull your
                    registered field boundaries from the Rural Payments Agency. England only.
                  </p>
                  <input
                    inputMode="numeric"
                    value={sbi}
                    onChange={(e) => setSbi(e.target.value.replace(/[^\d]/g, "").slice(0, 9))}
                    placeholder="123456789"
                    className="w-full rounded-lg border border-stone-300 px-3 py-2 text-base"
                  />
                  <label className="mt-2 flex items-start gap-2 text-[13px] text-stone-600">
                    <input
                      type="checkbox"
                      checked={licenceChecked}
                      onChange={(e) => setLicenceChecked(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      I accept the{" "}
                      <a
                        href="https://environment.data.gov.uk/rpa/OS_EUL_V2.pdf"
                        target="_blank"
                        rel="noreferrer"
                        className="text-teal-700 underline"
                      >
                        Ordnance Survey End User Licence
                      </a>
                      . (If you manage this land on someone&apos;s behalf, add your business name below.)
                    </span>
                  </label>
                  <input
                    value={acceptor}
                    onChange={(e) => setAcceptor(e.target.value)}
                    placeholder="Agent / business name (only if acting for the farmer)"
                    className="mt-2 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
                  />
                </div>
              )}

              {!selectedParcel && (
                <button
                  disabled={busy || (!licenceAccepted && (!sbi || !licenceChecked))}
                  onClick={handleSaveSbiAndPull}
                  className="mt-3 w-full rounded-xl bg-teal-700 px-4 py-3 text-base font-medium text-white disabled:opacity-50"
                >
                  {busy ? "Loading…" : parcels.length ? "Refresh my parcels" : "Pull my fields"}
                </button>
              )}

              {selectedParcel && (
                <div className="mt-3 rounded-lg bg-stone-50 p-3">
                  <p className="text-sm font-medium text-stone-800">
                    Adopt parcel {selectedParcel.sheetId} {selectedParcel.parcelId} ·{" "}
                    {selectedParcel.areaHa.toFixed(2)} ha
                  </p>
                  <label className="mt-2 block text-[12px] text-stone-500">Link to</label>
                  <select
                    value={adoptTarget}
                    onChange={(e) => setAdoptTarget(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-2 text-sm"
                  >
                    <option value="">➕ New field</option>
                    {unmappedFields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.ha.toFixed(2)} ha)
                      </option>
                    ))}
                  </select>
                  {!adoptTarget && (
                    <input
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      placeholder="New field name"
                      className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                    />
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      disabled={busy}
                      onClick={handleAdoptConfirm}
                      className="flex-1 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {busy ? "Saving…" : "Adopt"}
                    </button>
                    <button
                      onClick={() => setSelectedParcel(null)}
                      className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Draw mode */}
          {mode === "draw" && (
            <div className="mt-3">
              {!drawFinished ? (
                <>
                  <p className="text-sm text-stone-600">
                    Tap the map to drop corners around the field. Add at least 3, then finish.
                  </p>
                  <label className="mt-2 flex items-center gap-2 text-[13px] text-stone-600">
                    <input
                      type="checkbox"
                      checked={snapEnabled}
                      onChange={(e) => setSnapEnabled(e.target.checked)}
                    />
                    <span>
                      Snap to boundaries
                      <span className="text-stone-400">
                        {" "}— locks corners onto nearby parcels &amp; mapped fields
                      </span>
                    </span>
                  </label>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-sm text-stone-500">{drawPoints.length} points</span>
                    <button
                      onClick={() => setDrawPoints((p) => p.slice(0, -1))}
                      disabled={!drawPoints.length}
                      className="rounded-lg border border-stone-300 px-3 py-2 text-sm disabled:opacity-40"
                    >
                      Undo
                    </button>
                    <button
                      onClick={finishDrawing}
                      disabled={drawPoints.length < 3}
                      className="flex-1 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                    >
                      Finish
                    </button>
                    <button
                      onClick={resetDraw}
                      className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
                    >
                      Clear
                    </button>
                  </div>
                </>
              ) : (
                <div className="rounded-lg bg-stone-50 p-3">
                  <p className="text-sm font-medium text-stone-800">
                    Field drawn · approx area will be calculated on save.
                  </p>
                  <label className="mt-2 block text-[12px] text-stone-500">Link to</label>
                  <select
                    value={drawTarget}
                    onChange={(e) => setDrawTarget(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-2 text-sm"
                  >
                    <option value="">➕ New field</option>
                    {unmappedFields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.ha.toFixed(2)} ha)
                      </option>
                    ))}
                  </select>
                  {!drawTarget && (
                    <input
                      value={drawName}
                      onChange={(e) => setDrawName(e.target.value)}
                      placeholder="New field name"
                      className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                    />
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      disabled={busy}
                      onClick={handleSaveDrawn}
                      className="flex-1 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {busy ? "Saving…" : "Save field"}
                    </button>
                    <button
                      onClick={() => setDrawFinished(null)}
                      className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------
function LocateBanner({
  loc,
  fieldsById,
}: {
  loc: {
    position: [number, number];
    accuracyMeters: number | null;
    insideId: string | null;
    nearestId: string | null;
    nearestMeters: number | null;
  } | null;
  fieldsById: Record<string, MapField>;
}) {
  if (!loc) return null;

  let label: string;
  let sub: string | null = null;
  let fieldId: string | null = null;

  const inside = loc.insideId ? fieldsById[loc.insideId] : null;
  const near = loc.nearestId ? fieldsById[loc.nearestId] : null;

  if (inside) {
    label = `In: ${inside.name}`;
    fieldId = inside.id;
    sub = loc.accuracyMeters != null ? `GPS ±${Math.round(loc.accuracyMeters)} m` : null;
  } else if (near && loc.nearestMeters != null && loc.nearestMeters < 80) {
    label = `Nearest: ${near.name}`;
    fieldId = near.id;
    sub = `~${Math.round(loc.nearestMeters)} m away`;
  } else {
    label = "Not in a mapped field";
  }

  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-sm font-medium text-stone-800">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-sky-500" />
        {label}
        {fieldId && <span className="text-stone-400">›</span>}
      </div>
      {sub && <div className="text-[11px] text-stone-500">{sub}</div>}
    </>
  );

  const classes =
    "absolute left-3 top-3 z-10 max-w-[60%] rounded-xl bg-white/95 px-3 py-2 shadow-md backdrop-blur";

  return fieldId ? (
    <a href={`/fields/${encodeURIComponent(fieldId)}`} className={classes}>
      {inner}
    </a>
  ) : (
    <div className={classes}>{inner}</div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${
        active ? "bg-teal-700 text-white" : "bg-stone-100 text-stone-700"
      }`}
    >
      {children}
    </button>
  );
}

function LegendRow({ colour, label }: { colour: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: colour }} />
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map fit helpers (kept here to avoid touching geo.ts's pure status)
// ---------------------------------------------------------------------------
function boundsOfGeometries(geoms: any[]): [[number, number], [number, number]] | null {
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  const visit = (coords: any) => {
    if (typeof coords[0] === "number") {
      const [lng, lat] = coords;
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    } else for (const c of coords) visit(c);
  };
  for (const g of geoms) if (g) visit(g.coordinates);
  if (minLng === Infinity) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

function fitToFields(map: MlMap, fields: MapField[]) {
  const b = boundsOfGeometries(fields.filter((f) => f.boundary).map((f) => f.boundary));
  if (b) map.fitBounds(b, { padding: 48, maxZoom: 16, duration: 0 });
}

function fitToParcels(map: MlMap | null, parcels: RpaParcel[]) {
  if (!map) return;
  const b = boundsOfGeometries(parcels.map((p) => p.geometry));
  if (b) map.fitBounds(b, { padding: 48, maxZoom: 16, duration: 600 });
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

// ---------------------------------------------------------------------------
// Scoped styles. The app doesn't use Tailwind, so rather than rewrite the
// markup we map the exact utility classes this component uses to CSS, scoped
// under `.swardly-map` so nothing leaks into the rest of the app. Colours use
// the app's tokens where there's a match; the rest are neutral stone/teal that
// echo the existing UI.
// ---------------------------------------------------------------------------
function MapStyles() {
  return (
    <style>{`
.swardly-map { position: relative; }
.swardly-map .relative { position: relative; }
.swardly-map .absolute { position: absolute; }
.swardly-map .inset-0 { inset: 0; }
.swardly-map .inset-x-0 { left: 0; right: 0; }
.swardly-map .bottom-0 { bottom: 0; }
.swardly-map .left-3 { left: 12px; }
.swardly-map .top-3 { top: 12px; }
.swardly-map .right-3 { right: 12px; }
.swardly-map .left-1\\/2 { left: 50%; }
.swardly-map .-translate-x-1\\/2 { transform: translateX(-50%); }
.swardly-map .z-10 { z-index: 10; }
.swardly-map .z-20 { z-index: 20; }
.swardly-map .mx-auto { margin-left: auto; margin-right: auto; }
.swardly-map .max-w-2xl { max-width: 42rem; }
.swardly-map .max-w-\\[60\\%\\] { max-width: 60%; }
.swardly-map .block { display: block; }
.swardly-map .inline-block { display: inline-block; }
.swardly-map .flex { display: flex; }
.swardly-map .flex-1 { flex: 1 1 0%; }
.swardly-map .items-start { align-items: flex-start; }
.swardly-map .items-center { align-items: center; }
.swardly-map .gap-1\\.5 { gap: 6px; }
.swardly-map .gap-2 { gap: 8px; }
.swardly-map .space-y-1 > * + * { margin-top: 4px; }
.swardly-map .w-full { width: 100%; }
.swardly-map .w-36 { width: 9rem; }
.swardly-map .h-2\\.5 { height: 10px; }
.swardly-map .w-2\\.5 { width: 10px; }
.swardly-map .h-3 { height: 12px; }
.swardly-map .w-3 { width: 12px; }
.swardly-map .p-3 { padding: 12px; }
.swardly-map .p-4 { padding: 16px; }
.swardly-map .px-2 { padding-left: 8px; padding-right: 8px; }
.swardly-map .px-3 { padding-left: 12px; padding-right: 12px; }
.swardly-map .px-4 { padding-left: 16px; padding-right: 16px; }
.swardly-map .py-1 { padding-top: 4px; padding-bottom: 4px; }
.swardly-map .py-2 { padding-top: 8px; padding-bottom: 8px; }
.swardly-map .py-2\\.5 { padding-top: 10px; padding-bottom: 10px; }
.swardly-map .py-3 { padding-top: 12px; padding-bottom: 12px; }
.swardly-map .mt-0\\.5 { margin-top: 2px; }
.swardly-map .mt-1 { margin-top: 4px; }
.swardly-map .mt-2 { margin-top: 8px; }
.swardly-map .mt-3 { margin-top: 12px; }
.swardly-map .mb-2 { margin-bottom: 8px; }
.swardly-map .rounded-full { border-radius: 9999px; }
.swardly-map .rounded-sm { border-radius: 4px; }
.swardly-map .rounded-lg { border-radius: 10px; }
.swardly-map .rounded-xl { border-radius: 12px; }
.swardly-map .rounded-t-2xl { border-top-left-radius: 16px; border-top-right-radius: 16px; }
.swardly-map .border { border-width: 1px; border-style: solid; }
.swardly-map .border-stone-200 { border-color: #e7e5e4; }
.swardly-map .border-stone-300 { border-color: #d6d3d1; }
.swardly-map .bg-white { background: #fff; }
.swardly-map .bg-white\\/95 { background: rgba(255,255,255,0.95); }
.swardly-map .bg-white\\/97 { background: rgba(255,255,255,0.97); }
.swardly-map .bg-stone-50 { background: #fafaf9; }
.swardly-map .bg-stone-100 { background: #f5f5f4; }
.swardly-map .bg-stone-900\\/90 { background: rgba(28,25,23,0.9); }
.swardly-map .bg-sky-500 { background: #0ea5e9; }
.swardly-map .bg-teal-700 { background: var(--forest, #15756a); }
.swardly-map .text-white { color: #fff; }
.swardly-map .text-stone-400 { color: #a8a29e; }
.swardly-map .text-stone-500 { color: #78716c; }
.swardly-map .text-stone-600 { color: #57534e; }
.swardly-map .text-stone-700 { color: #44403c; }
.swardly-map .text-stone-800 { color: #292524; }
.swardly-map .text-teal-700 { color: var(--forest, #15756a); }
.swardly-map .text-sm { font-size: 14px; line-height: 1.4; }
.swardly-map .text-base { font-size: 16px; line-height: 1.5; }
.swardly-map .text-\\[11px\\] { font-size: 11px; }
.swardly-map .text-\\[12px\\] { font-size: 12px; }
.swardly-map .text-\\[13px\\] { font-size: 13px; }
.swardly-map .font-medium { font-weight: 500; }
.swardly-map .uppercase { text-transform: uppercase; }
.swardly-map .tracking-wide { letter-spacing: 0.025em; }
.swardly-map .underline { text-decoration: underline; }
.swardly-map .transition { transition: all 0.15s ease; }
.swardly-map .shadow-md { box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1); }
.swardly-map .shadow-lg { box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1); }
.swardly-map .backdrop-blur { backdrop-filter: blur(8px); }
.swardly-map .disabled\\:opacity-40:disabled { opacity: 0.4; }
.swardly-map .disabled\\:opacity-50:disabled { opacity: 0.5; }
.swardly-map select, .swardly-map input[type="text"], .swardly-map input:not([type]) { background: #fff; color: #292524; }
.swardly-map a { color: inherit; text-decoration: none; }
.swardly-map a.text-teal-700 { text-decoration: underline; }
    `}</style>
  );
}
