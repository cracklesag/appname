import { cache } from 'react';
import { cookies } from 'next/headers';
import { createClient } from './supabase/server';

export type FarmRole = 'admin' | 'staff' | 'agronomist';
export type AccountType = 'farm' | 'contractor' | 'agronomist';

/** Cookie holding the client farm an agronomist is currently reviewing. */
export const AGRONOMIST_FARM_COOKIE = 'agronomist_farm';

export interface FarmContext {
  /** The signed-in user's id. */
  userId: string;
  /** The farm owner's user_id whose data this context resolves to. For admins
   *  this is themselves; for staff it's the admin they work for; for an
   *  agronomist it's the client farm they're currently reviewing. */
  ownerId: string;
  /** The signed-in user's role on the resolved farm. */
  role: FarmRole;
  /** Convenience flag — admin of the resolved farm. */
  isAdmin: boolean;
  /** The signed-in user's OWN account type (from their own settings) — NOT the
   *  resolved farm's. An agronomist reviewing a client farm has accountType
   *  'agronomist' even though the farm's own settings say 'farm'. */
  accountType: AccountType;
  /** Agronomist only: true when a client farm is currently selected (they've
   *  accepted at least one farm and a valid one is chosen). */
  hasSelectedFarm?: boolean;
}

/**
 * Resolve the current user's farm context: which farm owner their data belongs
 * to, and what role they hold.
 *
 * Most users belong to one farm. An agronomist is the exception: they are
 * linked to MANY farms (farm_members rows with role='agronomist') and review
 * them one at a time. For an agronomist we resolve the client farm from the
 * `agronomist_farm` cookie (set by the farm switcher), falling back to their
 * first linked farm, or to their own (empty) id if they've accepted none yet.
 *
 * Returns null if not signed in.
 *
 * Wrapped in React cache(): within a single request, repeated calls share one
 * result.
 */
export const getFarmContext = cache(async function getFarmContextUncached(): Promise<FarmContext | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships, error } = await supabase
    .from('farm_members')
    .select('owner_id, role')
    .eq('member_id', user.id);

  // Degrade gracefully to single-user (admin of own farm) if the membership
  // query fails — most commonly because the farm_roles migration hasn't run.
  if (error || !memberships || memberships.length === 0) {
    return { userId: user.id, ownerId: user.id, role: 'admin', isAdmin: true, accountType: 'farm' };
  }

  // The user's OWN account type lives on their own settings row (user_id =
  // themselves). This is what decides agronomist vs farm/contractor — the
  // resolved farm's settings are a different thing.
  const { data: ownSettings } = await supabase
    .from('settings').select('data').eq('user_id', user.id).maybeSingle();
  const ownData = (ownSettings?.data as { onboarded?: boolean; accountType?: AccountType } | null) ?? null;
  const accountType: AccountType = ownData?.accountType ?? 'farm';

  // ----- Agronomist: resolve the client farm currently under review. -----
  if (accountType === 'agronomist') {
    const agroFarms = memberships.filter((m) => m.role === 'agronomist');
    let selectedId: string | undefined;
    try { selectedId = cookies().get(AGRONOMIST_FARM_COOKIE)?.value || undefined; } catch { /* no request scope */ }
    const chosen = agroFarms.find((m) => m.owner_id === selectedId) ?? agroFarms[0] ?? null;
    return {
      userId: user.id,
      ownerId: chosen ? (chosen.owner_id as string) : user.id,
      role: 'agronomist',
      isAdmin: false,
      accountType: 'agronomist',
      hasSelectedFarm: !!chosen,
    };
  }

  // ----- Farm / contractor: prefer their own admin farm, else a staff one. -----
  // Someone who signed up only to join a farm has an empty, never-onboarded
  // own-farm — prefer the farm they're staff on so they land on real data.
  const adminMembership = memberships.find((m) => m.role === 'admin');
  const staffMembership = memberships.find((m) => m.role === 'staff');

  let chosen = adminMembership ?? memberships[0];
  if (adminMembership && staffMembership) {
    chosen = ownData?.onboarded ? adminMembership : staffMembership;
  }

  return {
    userId: user.id,
    ownerId: chosen.owner_id as string,
    role: chosen.role as FarmRole,
    isAdmin: chosen.role === 'admin',
    accountType,
  };
});

/**
 * Throw if the current user is not an admin of their resolved farm. Guards
 * admin-only server actions. RLS is the real enforcement; this gives a clean
 * message. Note: an agronomist is never admin, so this correctly blocks them
 * from admin actions — their permitted edits go through dedicated agronomist
 * actions instead.
 */
export async function requireAdmin(): Promise<FarmContext> {
  const ctx = await getFarmContext();
  if (!ctx) throw new Error('Not signed in');
  if (!ctx.isAdmin) {
    throw new Error('Only the farm admin can change this. Ask your admin if you need access.');
  }
  return ctx;
}

/** Any signed-in farm member. */
export async function requireMember(): Promise<FarmContext> {
  const ctx = await getFarmContext();
  if (!ctx) throw new Error('Not signed in');
  return ctx;
}

/**
 * Verify the current user is an agronomist linked to the given farm owner, and
 * return their context. Used to guard agronomist-only edit actions (Phase B).
 */
export async function requireAgronomistFor(ownerId: string): Promise<FarmContext> {
  const ctx = await getFarmContext();
  if (!ctx) throw new Error('Not signed in');
  if (ctx.accountType !== 'agronomist') throw new Error('Not an agronomist account');
  const supabase = createClient();
  const { data } = await supabase
    .from('farm_members')
    .select('owner_id')
    .eq('member_id', ctx.userId)
    .eq('owner_id', ownerId)
    .eq('role', 'agronomist')
    .maybeSingle();
  if (!data) throw new Error('You are not linked to that farm');
  return ctx;
}
