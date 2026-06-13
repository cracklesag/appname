import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { getFarmContext } from '@/lib/farm';
import { loadAgronomistFarms } from '@/lib/data';
import { setAgronomistFarm } from '@/lib/actions';
import { Building2, Check, KeyRound, Sliders } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AgronomistHomePage() {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  // Only agronomist accounts have this screen.
  if (ctx.accountType !== 'agronomist') redirect('/');

  const farms = await loadAgronomistFarms();
  const selectedId = ctx.hasSelectedFarm ? ctx.ownerId : null;
  const currentFarm = selectedId ? farms.find((f) => f.ownerId === selectedId) ?? null : null;

  return (
    <div style={{ paddingBottom: 90 }}>
      <Header tone="forest" title="Your farms" subtitle="Farms you advise" />

      <div style={{ padding: '14px 16px' }}>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginTop: 0, marginBottom: 18 }}>
          Pick a farm to review it. You can read everything and adjust soil, grass and advanced
          agronomy settings on the farm&apos;s behalf — but you can&apos;t log applications, cuts or other work.
        </p>

        {currentFarm && (
          <div className="card" style={{ padding: 16, marginBottom: 18, background: 'var(--forest-soft)', border: '1px solid var(--forest)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--forest-dark)', marginBottom: 4 }}>Currently reviewing</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', marginBottom: 12 }}>{currentFarm.farmName}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link href="/fields" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <Building2 size={15} /> Review fields &amp; soil
              </Link>
              <Link href="/settings/agronomy" className="btn-ghost" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <Sliders size={15} /> Advanced agronomy
              </Link>
            </div>
          </div>
        )}

        {farms.length === 0 ? (
          <div className="card" style={{ padding: 24, textAlign: 'center' }}>
            <Building2 size={26} style={{ color: 'var(--muted)' }} />
            <div style={{ fontWeight: 700, margin: '10px 0 4px', color: 'var(--ink)' }}>No farms linked yet</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 16 }}>
              Ask a farm to send you an agronomist invite code, then enter it to get access.
            </div>
            <Link href="/join" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <KeyRound size={16} /> Enter an invite code
            </Link>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {farms.map((f) => {
                const isCurrent = f.ownerId === selectedId;
                return (
                  <form key={f.ownerId} action={setAgronomistFarm}>
                    <input type="hidden" name="owner_id" value={f.ownerId} />
                    <button
                      type="submit"
                      className="card"
                      style={{
                        width: '100%', textAlign: 'left', padding: '15px 16px',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                        border: isCurrent ? '2px solid var(--forest)' : '1px solid var(--line)',
                        background: isCurrent ? 'var(--forest-soft)' : 'var(--card)',
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                        <Building2 size={18} style={{ color: 'var(--forest-dark)', flexShrink: 0 }} />
                        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {f.farmName}
                        </span>
                      </span>
                      {isCurrent
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--forest-dark)', flexShrink: 0 }}><Check size={14} /> Reviewing</span>
                        : <span style={{ fontSize: 12.5, color: 'var(--muted)', flexShrink: 0 }}>Review →</span>}
                    </button>
                  </form>
                );
              })}
            </div>

            <Link href="/join" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 18, fontSize: 13, color: 'var(--forest-dark)', fontWeight: 600, textDecoration: 'none' }}>
              <KeyRound size={15} /> Add another farm with an invite code
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
