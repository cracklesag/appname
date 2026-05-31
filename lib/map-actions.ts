// lib/map-actions.ts
"use server";

// INTEGRATION: these two imports must resolve to the app's real modules.
//   - createClient: the Supabase server client used elsewhere in the app
//   - requireAdmin: lib/farm.ts role/ownership gate (returns a FarmContext)
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/farm";

import { revalidatePath } from "next/cache";
import { fetchRpaParcels, isValidSbi, type RpaParcel } from "@/lib/rpa";
import {
  polygonAreaHectares,
  bboxOfGeometry,
  centroidOfBbox,
  type FieldGeometry,
} from "@/lib/geo";

const HA_TO_ACRES = 2.4711;

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

// requireAdmin() returns the farm context: { userId, ownerId, role, isAdmin }.
// Shared data (fields) is owned by ownerId, so field reads/writes scope to it
// (matches the rest of the app + the fields RLS, which allows owner & staff).
// map_settings, by contrast, is keyed per signed-in user to match its RLS
// (auth.uid() = user_id), so those operations use userId.
async function adminContext(): Promise<{ userId: string; ownerId: string }> {
  const ctx = await requireAdmin();
  return { userId: ctx.userId, ownerId: ctx.ownerId };
}

/** PRG grass-system id — the default for a freshly created field, mirroring
 *  createField() so a map-created field behaves like a hand-added one. */
async function defaultGrassSystemId(
  supabase: ReturnType<typeof createClient>,
): Promise<string | null> {
  const { data } = await supabase
    .from("grass_systems")
    .select("id")
    .eq("seed_key", "perennial_ryegrass")
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

// ---------------------------------------------------------------------------
// SBI + OS licence acceptance
// ---------------------------------------------------------------------------
export async function saveFarmMapSettings(formData: FormData): Promise<ActionResult> {
  try {
    const { userId } = await adminContext();
    const supabase = createClient();

    const sbi = String(formData.get("sbi") ?? "").trim();
    const licenceAccepted =
      formData.get("licence_accepted") === "on" || formData.get("licence_accepted") === "true";
    const acceptor = String(formData.get("acceptor") ?? "").trim() || null;

    if (sbi && !isValidSbi(sbi)) return { ok: false, error: "SBI must be 9 digits." };
    if (sbi && !licenceAccepted)
      return {
        ok: false,
        error: "Please accept the Ordnance Survey licence to pull your boundary data.",
      };

    const { error } = await supabase.from("map_settings").upsert(
      {
        user_id: userId,
        sbi: sbi || null,
        os_licence_accepted_at: licenceAccepted ? new Date().toISOString() : null,
        os_licence_acceptor: acceptor,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    if (error) return { ok: false, error: error.message };

    revalidatePath("/map");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

// ---------------------------------------------------------------------------
// Pull registered parcels for adoption (gated on SBI + licence)
// ---------------------------------------------------------------------------
export async function getAdoptableParcels(): Promise<ActionResult<RpaParcel[]>> {
  try {
    const { userId } = await adminContext();
    const supabase = createClient();

    const { data: settings } = await supabase
      .from("map_settings")
      .select("sbi, os_licence_accepted_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (!settings?.sbi) return { ok: false, error: "Add your SBI first." };
    if (!settings?.os_licence_accepted_at)
      return { ok: false, error: "Accept the Ordnance Survey licence first." };

    const parcels = await fetchRpaParcels(settings.sbi as string);
    return { ok: true, data: parcels };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not load parcels." };
  }
}

// ---------------------------------------------------------------------------
// Adopt an RPA parcel onto a field (existing or new)
// ---------------------------------------------------------------------------
type AdoptInput = {
  fieldId?: string; // link to an existing field…
  newFieldName?: string; // …or create a new one
  parcel: RpaParcel;
};

export async function adoptParcel(
  input: AdoptInput
): Promise<ActionResult<{ fieldId: string }>> {
  try {
    const { ownerId } = await adminContext();
    const supabase = createClient();

    const { parcel } = input;
    const patch = {
      boundary: parcel.geometry as unknown as object,
      centroid_lng: parcel.centroid.lng,
      centroid_lat: parcel.centroid.lat,
      area_ha_mapped: parcel.areaHa,
      boundary_source: "rpa",
      rpa_sheet_id: parcel.sheetId,
      rpa_parcel_id: parcel.parcelId,
      boundary_updated_at: new Date().toISOString(),
    };

    if (input.fieldId) {
      const { error } = await supabase
        .from("fields")
        .update(patch)
        .eq("id", input.fieldId)
        .eq("user_id", ownerId); // explicit scope on top of RLS
      if (error) return { ok: false, error: error.message };
      revalidatePath("/map");
      revalidatePath(`/fields/${input.fieldId}`);
      return { ok: true, data: { fieldId: input.fieldId } };
    }

    // New field from a parcel — adopt the official area as ha (subsidy-grade).
    // INTEGRATION: align cut_profile / planned_cuts / needs_setup defaults with the
    // app's createField() so a parcel-created field behaves like a hand-added one.
    const ha = parcel.areaHa;
    const { data, error } = await supabase
      .from("fields")
      .insert({
        user_id: ownerId,
        name: input.newFieldName?.trim() || `Parcel ${parcel.sheetId} ${parcel.parcelId}`,
        ha,
        acres: ha * HA_TO_ACRES,
        cut_profile: 1,
        planned_cuts: ["grazing"],
        soil_type: "medium_loam",
        grass_system_id: await defaultGrassSystemId(supabase),
        sampled: false,
        needs_setup: true,
        ...patch,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    revalidatePath("/map");
    return { ok: true, data: { fieldId: (data as { id: string }).id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not adopt parcel." };
  }
}

// ---------------------------------------------------------------------------
// Save a hand-drawn boundary (fallback for non-England / unregistered land)
// ---------------------------------------------------------------------------
type DrawInput = {
  fieldId?: string;
  newFieldName?: string;
  geometry: FieldGeometry; // drawn polygon in [lng,lat]
};

export async function saveDrawnBoundary(
  input: DrawInput
): Promise<ActionResult<{ fieldId: string }>> {
  try {
    const { ownerId } = await adminContext();
    const supabase = createClient();

    const areaHa = polygonAreaHectares(input.geometry);
    const centroid = centroidOfBbox(bboxOfGeometry(input.geometry));
    const patch = {
      boundary: input.geometry as unknown as object,
      centroid_lng: centroid.lng,
      centroid_lat: centroid.lat,
      area_ha_mapped: areaHa,
      boundary_source: "drawn",
      rpa_sheet_id: null,
      rpa_parcel_id: null,
      boundary_updated_at: new Date().toISOString(),
    };

    if (input.fieldId) {
      // Existing field: store the boundary + computed area, but DON'T overwrite ha
      // (the area stays a suggestion the farmer accepts via acceptMappedArea).
      const { error } = await supabase
        .from("fields")
        .update(patch)
        .eq("id", input.fieldId)
        .eq("user_id", ownerId);
      if (error) return { ok: false, error: error.message };
      revalidatePath("/map");
      revalidatePath(`/fields/${input.fieldId}`);
      return { ok: true, data: { fieldId: input.fieldId } };
    }

    // Brand-new drawn field: seed ha from the drawing.
    const { data, error } = await supabase
      .from("fields")
      .insert({
        user_id: ownerId,
        name: input.newFieldName?.trim() || "New field",
        ha: areaHa,
        acres: areaHa * HA_TO_ACRES,
        cut_profile: 1,
        planned_cuts: ["grazing"],
        soil_type: "medium_loam",
        grass_system_id: await defaultGrassSystemId(supabase),
        sampled: false,
        needs_setup: true,
        ...patch,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    revalidatePath("/map");
    return { ok: true, data: { fieldId: (data as { id: string }).id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save boundary." };
  }
}

// ---------------------------------------------------------------------------
// Reconcile: accept the mapped area as the field's area of record
// ---------------------------------------------------------------------------
export async function acceptMappedArea(fieldId: string): Promise<ActionResult> {
  try {
    const { ownerId } = await adminContext();
    const supabase = createClient();

    const { data: field, error: readErr } = await supabase
      .from("fields")
      .select("area_ha_mapped")
      .eq("id", fieldId)
      .eq("user_id", ownerId)
      .single();
    if (readErr) return { ok: false, error: readErr.message };

    const mapped = (field as { area_ha_mapped: number | null })?.area_ha_mapped;
    if (typeof mapped !== "number") return { ok: false, error: "No mapped area to accept." };

    const { error } = await supabase
      .from("fields")
      .update({ ha: mapped, acres: mapped * HA_TO_ACRES })
      .eq("id", fieldId)
      .eq("user_id", ownerId);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/map");
    revalidatePath(`/fields/${fieldId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update area." };
  }
}
