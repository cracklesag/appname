import { redirect } from 'next/navigation';
import { Trash2, HardHat } from 'lucide-react';
import { Header } from '@/components/Header';
import { CopyText } from '@/components/CopyText';
import { loadMyContractorProfile, loadFarmContractors, loadSettings } from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import { becomeContractor, connectContractor, removeContractor } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function ContractorsPage() {
  const [profile, connected, settings] = await Promise.all([loadMyContractorProfile(), loadFarmContractors(), loadSettings()]);
  if (!settings.onboarded) redirect('/welcome');
  const ctx = await getFarmContext();
  const isAdmin = !!ctx?.isAdmin;

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Contractors" subtitle="Send & receive job sheets" backHref="/settings" />
      <div style={{ padding: 16 }}>

        {/* Receiving: your contractor code */}
        <div className="card" style={{ padding: 14, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <HardHat size={17} style={{ color: 'var(--forest)' }} />
            <div className="label" style={{ margin: 0 }}>Receiving jobs</div>
          </div>
          {profile ? (
            <>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 8 }}>Give this code to a farm so they can send job sheets to your app:</div>
              <div style={{ marginBottom: 12 }}><CopyText value={profile.code} mono /></div>
              <form action={becomeContractor}>
                <div className="label" style={{ marginBottom: 6 }}>Business name</div>
                <input type="text" name="business_name" className="input" defaultValue={profile.business_name ?? ''} placeholder="e.g. AN Other Contracting" maxLength={120} style={{ marginBottom: 10 }} />
                <button type="submit" className="btn-ghost" style={{ width: '100%' }}>Save name</button>
              </form>
            </>
          ) : (
            <form action={becomeContractor}>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 10 }}>Set up a contractor profile to receive job sheets from farms. You&apos;ll get a code to share.</div>
              <input type="text" name="business_name" className="input" placeholder="Business name (optional)" maxLength={120} style={{ marginBottom: 10 }} />
              <button type="submit" className="btn-primary" style={{ width: '100%' }}>Set up contractor profile</button>
            </form>
          )}
        </div>

        {/* Sending: contractors you connect to */}
        <div className="label" style={{ marginBottom: 8 }}>Contractors you send work to</div>
        {connected.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>None yet. Enter a contractor&apos;s code below to connect them, then you can pick them when building a job.</div>
        ) : (
          connected.map((c) => (
            <div key={c.id} className="card" style={{ padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{c.label ?? 'Contractor'}</div>
              {isAdmin && (
                <form action={removeContractor}>
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" aria-label="Remove" style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 4 }}><Trash2 size={15} /></button>
                </form>
              )}
            </div>
          ))
        )}
        {isAdmin && (
          <form action={connectContractor} className="card" style={{ padding: 14, marginTop: 6 }}>
            <div className="label" style={{ marginBottom: 8 }}>Connect a contractor</div>
            <input type="text" name="code" className="input" placeholder="Their contractor code" maxLength={20} required style={{ marginBottom: 10, textTransform: 'uppercase' }} />
            <input type="text" name="label" className="input" placeholder="Label (optional, e.g. their name)" maxLength={120} style={{ marginBottom: 10 }} />
            <button type="submit" className="btn-primary" style={{ width: '100%' }}>Connect</button>
          </form>
        )}
      </div>
    </div>
  );
}
