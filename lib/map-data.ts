// lib/map-data.ts
// Server-side loader for per-farm map settings. Mirrors the loaders in lib/data.ts and is
// self-contained so this chunk doesn't have to edit lib/data.ts.
//
// INTEGRATION: point `createClient` at the app's actual Supabase server client.
import { createClient } from "@/lib/supabase/server";

export type MapSettings = {
  sbi: string | null;
  os_licence_accepted_at: string | null;
  os_licence_acceptor: string | null;
};

export async function loadMapSettings(): Promise<MapSettings | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("map_settings")
    .select("sbi, os_licence_accepted_at, os_licence_acceptor")
    .eq("user_id", user.id)
    .maybeSingle();

  return (data as MapSettings | null) ?? null;
}
