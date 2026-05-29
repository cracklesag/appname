import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { getFarmContext } from '@/lib/farm';
import { redeemInvite } from '@/lib/actions';
import { loadFarmMembers } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function JoinPage({ searchParams }: { searchParams: { error?: string } }) {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');

  // If they already belong to someone else's farm as staff, show that.
  const members = await loadFarmMembers().catch(() => []);
  const alreadyStaff = members.some((m) => m.role === 'staff' && m.member_id === ctx.userId);

  return (
    <div style={{ paddingBottom: 90 }}>
      <Header title="Join a farm" subtitle="Enter the code your admin gave you" backHref="/settings" />

      <div style={{ padding: '16px' }}>
        {alreadyStaff ? (
          <div className="card" style={{ padding: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>You&apos;re on a farm</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
              You already have access to a farm as staff. If you need to switch farms, ask the admin
              to remove you first.
            </div>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginTop: 0, marginBottom: 16 }}>
              Your farm admin can generate an invite code from their Team screen. Enter it below to
              get access to their farm — you&apos;ll be able to log spreading and cuts, and see all the
              fields.
            </p>

            {searchParams.error && (
              <div style={{ background: '#FBEAE6', border: '1px solid #E8B5A8', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#8A3B27', marginBottom: 14 }}>
                {searchParams.error}
              </div>
            )}

            <form action={redeemInvite}>
              <input
                type="text"
                name="code"
                placeholder="XXXX-XXXX"
                autoCapitalize="characters"
                autoComplete="off"
                className="input"
                style={{ width: '100%', marginBottom: 12, fontFamily: 'ui-monospace, monospace', fontSize: 18, letterSpacing: '0.08em', textAlign: 'center' }}
                required
              />
              <button type="submit" className="btn-primary" style={{ width: '100%' }}>
                Join farm
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
