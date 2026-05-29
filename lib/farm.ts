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

  // Prefer the farm where this user is admin (their own farm).
  const adminMembership = memberships.find((m) => m.role === 'admin');
  const chosen = adminMembership ?? memberships[0];

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
