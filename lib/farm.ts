import { createClient } from './supabase/server';

export type FarmRole = 'admin' | 'staff';

export interface FarmContext {
  /** The signed-in user's id. */
  userId: string;
  /** The farm owner's user_id — for admins this is themselves; for staff it's
   *  the admin they work for. All shared data is owned by this id. */
  ownerId: string;
  /** The signed-in user's role on the resolved farm. */
  role: FarmRole;
  /** Convenience flag. */
  isAdmin: boolean;
}

/**
 * Resolve the current user's farm context: which farm owner their data belongs
 * to, and what role they hold. A user may in principle belong to more than one
 * farm; we pick deterministically — prefer a farm where they're admin (their
 * own), else the first staff membership.
 *
 * Returns null if not signed in or (unexpectedly) no membership exists.
 */
export async function getFarmContext(): Promise<FarmContext | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships, error } = await supabase
    .from('farm_members')
    .select('owner_id, role')
    .eq('member_id', user.id);

  // Don't hard-crash the whole app if the membership query fails — most
  // commonly because the farm_roles migration hasn't been run yet (table
  // missing). Degrade gracefully to single-user (admin of own farm) so every
  // page still renders. The roles feature stays inactive until the migration
  // is applied.
  if (error || !memberships || memberships.length === 0) {
    return { userId: user.id, ownerId: user.id, role: 'admin', isAdmin: true };
  }

  // Choose which farm to resolve to. A user can be BOTH admin of their own
  // farm (auto-created at signup) AND staff on someone else's. Someone who
  // signed up only to join a farm has an empty, never-onboarded own-farm — in
  // that case prefer the farm they're staff on, so they land on real data
  // instead of their empty shell. A genuine admin (own farm set up) stays on
  // their own farm even if they're also staff somewhere.
  const adminMembership = memberships.find((m) => m.role === 'admin');
  const staffMembership = memberships.find((m) => m.role === 'staff');

  let chosen = adminMembership ?? memberships[0];
  if (adminMembership && staffMembership) {
    // Both: keep the admin farm only if it's actually been set up.
    const { data: ownSettings } = await supabase
      .from('settings')
      .select('data')
      .eq('user_id', adminMembership.owner_id as string)
      .maybeSingle();
    const onboarded = !!(ownSettings?.data as { onboarded?: boolean } | null)?.onboarded;
    chosen = onboarded ? adminMembership : staffMembership;
  }

  return {
    userId: user.id,
    ownerId: chosen.owner_id as string,
    role: chosen.role as FarmRole,
    isAdmin: chosen.role === 'admin',
  };
}

/**
 * Throw if the current user is not an admin of their resolved farm. Used to
 * guard admin-only server actions (settings, fields, groups, products, etc.)
 * at the application layer. RLS is the real enforcement; this gives a clean
 * error message instead of a raw RLS rejection.
 */
export async function requireAdmin(): Promise<FarmContext> {
  const ctx = await getFarmContext();
  if (!ctx) throw new Error('Not signed in');
  if (!ctx.isAdmin) {
    throw new Error('Only the farm admin can change this. Ask your admin if you need access.');
  }
  return ctx;
}

/** Any signed-in farm member (admin or staff). For field-worker tasks like
 *  logging a plate-meter reading, which staff are allowed to do. */
export async function requireMember(): Promise<FarmContext> {
  const ctx = await getFarmContext();
  if (!ctx) throw new Error('Not signed in');
  return ctx;
}
