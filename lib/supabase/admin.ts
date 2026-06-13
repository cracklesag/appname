import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. Bypasses RLS and can call the auth admin API
 * (e.g. deleting an auth user). SERVER-ONLY — never import this into a client
 * component or expose the service-role key to the browser. It is used solely
 * inside 'use server' actions.
 *
 * CURRENT CALLERS (keep this list honest — it's the audit surface for the
 * one credential that bypasses RLS):
 *   lib/actions.ts  → deleteMyAccount()    auth.admin.deleteUser + cascade
 *   lib/actions.ts  → loadSharedJob()      anonymous share-link read (token-gated)
 *   lib/actions.ts  → submitSharedJob()    anonymous share-link submit (token-gated)
 *   lib/actions.ts  → connectContractor()  contractor-code lookup (code-gated)
 *   lib/push.ts     → sendPushToUser()     cross-user push delivery
 * Deleting the auth.users row cascades to every table that references it
 * (all user_id / owner_id FKs are ON DELETE CASCADE), so the user's owned
 * data is removed atomically by Postgres.
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
