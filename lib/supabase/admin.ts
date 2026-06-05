import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. Bypasses RLS and can call the auth admin API
 * (e.g. deleting an auth user). SERVER-ONLY — never import this into a client
 * component or expose the service-role key to the browser. It is used solely
 * inside 'use server' actions.
 *
 * The only current caller is deleteMyAccount() in lib/actions.ts, which needs
 * auth.admin.deleteUser(). Deleting the auth.users row cascades to every table
 * that references it (see schema.sql — all user_id / owner_id FKs are
 * ON DELETE CASCADE), so the user's owned data is removed atomically by
 * Postgres.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Server is missing Supabase service credentials.');
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
