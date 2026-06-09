import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { getFarmContext } from '@/lib/farm';
import { loadFarmMembers, loadFarmInvites, loadSettings } from '@/lib/data';
import { createFarmInvite, deleteFarmInvite, removeFarmMember } from '@/lib/actions';
import { InviteCodeCard } from '@/components/InviteCodeCard';
import { Plus, UserMinus } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  // Staff can't manage the team — bounce them to settings.
  if (!ctx.isAdmin) redirect('/settings');

  const [members, invites, settings] = await Promise.all([loadFarmMembers(), loadFarmInvites(), loadSettings()]);
  const isContractor = settings.accountType === 'contractor';

  const staff = members.filter((m) => m.role === 'staff');
  const pendingInvites = invites.filter((i) => !i.used_at);

  return (
    <div style={{ paddingBottom: 90 }}>
      <Header title="Team" subtitle={isContractor ? 'Your operators' : 'People who can use this farm'} backHref="/settings" />

      <div style={{ padding: '14px 16px' }}>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginTop: 0, marginBottom: 18 }}>
          {isContractor
            ? 'Operators can open jobs sent to your business, tick off fields and log their time. They only see jobs forwarded to them — not your full job list or settings.'
            : 'Staff can log cuts, fertiliser, slurry, manure and lime, and edit their own entries. They can see everything but can\u2019t change fields, soil, groups, products or settings \u2014 those stay with you.'}
        </p>

        {/* Members */}
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 8, paddingLeft: 2 }}>
          Members
        </div>
        <div className="card" style={{ padding: 0, marginBottom: 22, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 15px', borderBottom: staff.length ? '1px solid var(--line-soft)' : 'none' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>You</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Admin · full access</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--forest-dark)', background: 'var(--forest-soft)', padding: '3px 9px', borderRadius: 6 }}>Admin</span>
          </div>

          {staff.map((m, i) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 15px', borderBottom: i < staff.length - 1 ? '1px solid var(--line-soft)' : 'none' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{isContractor ? 'Operator' : 'Staff member'}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Joined {new Date(m.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
              </div>
              <form action={removeFarmMember}>
                <input type="hidden" name="member_id" value={m.member_id} />
                <button type="submit" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px solid var(--line)', borderRadius: 7, padding: '6px 10px', fontSize: 12, color: 'var(--red, #b85b3a)', fontFamily: 'inherit', cursor: 'pointer' }}>
                  <UserMinus size={13} /> Remove
                </button>
              </form>
            </div>
          ))}

          {staff.length === 0 && (
            <div style={{ padding: '13px 15px', fontSize: 13, color: 'var(--muted)' }}>
              {isContractor ? 'No operators yet. Generate an invite code below to add one.' : 'No staff yet. Generate an invite code below to add someone.'}
            </div>
          )}
        </div>

        {/* Invite codes */}
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 8, paddingLeft: 2 }}>
          Invite codes
        </div>

        {pendingInvites.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {pendingInvites.map((inv) => (
              <InviteCodeCard key={inv.id} code={inv.code} id={inv.id} label={inv.label} deleteAction={deleteFarmInvite} />
            ))}
          </div>
        )}

        <form action={createFarmInvite}>
          <input
            type="text"
            name="label"
            placeholder="Name or note (optional, e.g. Tom)"
            maxLength={60}
            className="input"
            style={{ width: '100%', marginBottom: 10 }}
          />
          <button type="submit" className="btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Plus size={18} /> Generate invite code
          </button>
        </form>

        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginTop: 14 }}>
          Give the code to your staff member. They sign up for their own Swardly account, then enter
          the code on the &ldquo;Join a farm&rdquo; screen to get access to this farm.
        </p>
      </div>
    </div>
  );
}
