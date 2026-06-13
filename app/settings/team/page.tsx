import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { getFarmContext } from '@/lib/farm';
import { loadFarmMembers, loadFarmInvites, loadSettings } from '@/lib/data';
import { createFarmInvite, deleteFarmInvite, removeFarmMember, renameFarmMember } from '@/lib/actions';
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
  const agronomists = members.filter((m) => m.role === 'agronomist');
  const me = members.find((m) => m.member_id === ctx.userId);
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
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '13px 15px', borderBottom: staff.length ? '1px solid var(--line-soft)' : 'none' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{me?.member_name ? `${me.member_name} (you)` : 'You'}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Admin · full access</div>
              <form action={renameFarmMember} style={{ display: 'flex', gap: 6 }}>
                <input type="hidden" name="member_id" value={ctx.userId} />
                <input type="text" name="name" defaultValue={me?.member_name ?? ''} placeholder="Your name" maxLength={60} className="input" style={{ flex: 1, maxWidth: 220, fontSize: 13, padding: '6px 9px' }} />
                <button type="submit" className="btn-ghost" style={{ fontSize: 12.5, padding: '6px 10px' }}>Save</button>
              </form>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Your name shows on entries you log, so the team can see who did what.</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--forest-dark)', background: 'var(--forest-soft)', padding: '3px 9px', borderRadius: 6, flexShrink: 0 }}>Admin</span>
          </div>

          {staff.map((m, i) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 15px', borderBottom: i < staff.length - 1 ? '1px solid var(--line-soft)' : 'none' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{m.member_name ?? (isContractor ? 'Operator' : 'Staff member')}</div>
                <form action={renameFarmMember} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input type="hidden" name="member_id" value={m.member_id} />
                  <input type="text" name="name" defaultValue={m.member_name ?? ''} placeholder="Set name" maxLength={60} className="input" style={{ flex: 1, fontSize: 13, padding: '6px 9px' }} />
                  <button type="submit" className="btn-ghost" style={{ fontSize: 12.5, padding: '6px 10px' }}>Save</button>
                </form>
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

        {/* Agronomists (advisers) — farm accounts only */}
        {!isContractor && agronomists.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 8, paddingLeft: 2 }}>
              Agronomists
            </div>
            <div className="card" style={{ padding: 0, marginBottom: 22, overflow: 'hidden' }}>
              {agronomists.map((m, i) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 15px', borderBottom: i < agronomists.length - 1 ? '1px solid var(--line-soft)' : 'none' }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{m.member_name ?? 'Agronomist'}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Can review &amp; set soil, grass and agronomy · can&apos;t log work</div>
                  </div>
                  <form action={removeFarmMember}>
                    <input type="hidden" name="member_id" value={m.member_id} />
                    <button type="submit" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px solid var(--line)', borderRadius: 7, padding: '6px 10px', fontSize: 12, color: 'var(--red, #b85b3a)', fontFamily: 'inherit', cursor: 'pointer' }}>
                      <UserMinus size={13} /> Remove
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Invite codes */}
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 8, paddingLeft: 2 }}>
          Invite codes
        </div>

        {pendingInvites.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {pendingInvites.map((inv) => (
              <InviteCodeCard key={inv.id} code={inv.code} id={inv.id} label={inv.label ? `${inv.label}${inv.role === 'agronomist' ? ' (agronomist)' : ''}` : (inv.role === 'agronomist' ? 'Agronomist' : null)} deleteAction={deleteFarmInvite} />
            ))}
          </div>
        )}

        <form action={createFarmInvite}>
          <input type="hidden" name="role" value="staff" />
          <input
            type="text"
            name="label"
            placeholder="Name or note (optional, e.g. Tom)"
            maxLength={60}
            className="input"
            style={{ width: '100%', marginBottom: 10 }}
          />
          <button type="submit" className="btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Plus size={18} /> Generate staff invite code
          </button>
        </form>

        {!isContractor && (
          <form action={createFarmInvite} style={{ marginTop: 10 }}>
            <input type="hidden" name="role" value="agronomist" />
            <input type="hidden" name="label" value="Agronomist" />
            <button type="submit" className="btn-ghost" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Plus size={18} /> Generate agronomist invite code
            </button>
          </form>
        )}

        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginTop: 14 }}>
          Give a <strong>staff</strong> code to someone who logs work (cuts, fertiliser, slurry). Give an{' '}
          <strong>agronomist</strong> code to an adviser who should review your farm and set soil, grass and
          advanced agronomy on your behalf — they can&apos;t log work. They sign up, then enter the code on the
          &ldquo;Join a farm&rdquo; screen.
        </p>
      </div>
    </div>
  );
}
