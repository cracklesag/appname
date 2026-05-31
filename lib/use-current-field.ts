"use client";
// lib/use-current-field.ts
// Reusable hook: watch the phone's GPS and report which mapped field the user is standing in.
// Used by the map, and intended for OTHER screens (e.g. soil sampling) to pre-select the
// current field. Foreground only — a web app can't track location with the screen off.
//
// Requires HTTPS (Vercel is fine) and triggers the browser's location-permission prompt.

import { useCallback, useEffect, useRef, useState } from "react";
import { locateFieldAtPoint, type LocatableField, type FieldLocation } from "@/lib/geo";

export type LocateStatus =
  | "idle"
  | "locating"
  | "active"
  | "denied"
  | "unavailable"
  | "error";

export type CurrentField = FieldLocation & {
  status: LocateStatus;
  position: [number, number] | null; // [lng,lat]
  accuracyMeters: number | null;
  error: string | null;
};

const INITIAL: CurrentField = {
  status: "idle",
  position: null,
  accuracyMeters: null,
  insideId: null,
  nearestId: null,
  nearestMeters: null,
  error: null,
};

/**
 * @param fields  mapped fields with geometry + centroid (filter to those with a boundary)
 * @param options.auto  start watching on mount (prompts for permission immediately)
 */
export function useCurrentField(
  fields: LocatableField[],
  options: { auto?: boolean } = {}
): CurrentField & { start: () => void; stop: () => void } {
  const [state, setState] = useState<CurrentField>(INITIAL);
  const watchIdRef = useRef<number | null>(null);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  const stop = useCallback(() => {
    if (watchIdRef.current != null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setState((s) =>
      s.status === "active" || s.status === "locating" ? { ...s, status: "idle" } : s
    );
  }, []);

  const start = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setState((s) => ({ ...s, status: "unavailable" }));
      return;
    }
    setState((s) => ({ ...s, status: "locating", error: null }));
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const point: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        const loc = locateFieldAtPoint(point, fieldsRef.current);
        setState({
          status: "active",
          position: point,
          accuracyMeters: pos.coords.accuracy ?? null,
          error: null,
          ...loc,
        });
      },
      (err) => {
        setState((s) => ({
          ...s,
          status: err.code === err.PERMISSION_DENIED ? "denied" : "error",
          error: err.message,
        }));
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
  }, []);

  useEffect(() => {
    if (options.auto) start();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, start, stop };
}
