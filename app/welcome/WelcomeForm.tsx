'use client';

import { useState } from 'react';
import { ArrowRight, ArrowLeft, AlertCircle, Tractor, HardHat } from 'lucide-react';
import { completeOnboarding, completeContractorOnboarding } from '@/lib/actions';

type AccountType = 'farm' | 'contractor' | null;

export function WelcomeForm() {
  const [accountType, setAccountType] = useState<AccountType>(null);
  const [unit, setUnit] = useState<'acres' | 'ha' | null>(null);
  const [farmName, setFarmName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFarm() {
    if (!unit) return;
    setSubmitting(true); setError(null);
    try { await completeOnboarding(unit, farmName); }
    catch (err) { if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) setError(err.message); setSubmitting(false); }
  }
  async function handleContractor() {
    setSubmitting(true); setError(null);
    try { await completeContractorOnboarding(businessName); }
    catch (err) { if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) setError(err.message); setSubmitting(false); }
  }

  const shell: React.CSSProperties = { maxWidth: 480, margin: '0 auto', padding: 24, paddingTop: 48, minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 24 };

  const Brand = (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/swardly-mark.png" alt="" width={54} height={40} style={{ display: 'block', objectFit: 'contain' }} />
        <span style={{ fontFamily: '"Fraunces", serif', fontSize: 26, fontWeight: 600, color: 'var(--forest-dark)', letterSpacing: '-0.5px' }}>swardly</span>
      </div>
      <h1 style={{ margin: 0, fontSize: 28, color: 'var(--ink)', fontFamily: '"Fraunces", serif' }}>Welcome</h1>
    </div>
  );

  const ErrorBox = error ? (
    <div className="card" style={{ padding: 12, background: 'var(--red-soft)', borderColor: 'var(--red)', color: 'var(--red)', fontSize: 13, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{error}</span>
    </div>
  ) : null;

  // ---- Step 1: choose account type ----
  if (accountType === null) {
    return (
      <div style={shell}>
        {Brand}
        <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.6 }}>What are you setting up?</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <ChoiceCard icon={<Tractor size={22} />} title="A farm" subtitle="Map fields, plan nutrients, log work and send jobs out" onClick={() => setAccountType('farm')} />
          <ChoiceCard icon={<HardHat size={22} />} title="A contractor" subtitle="Receive job sheets from farms and tick them off — no farm setup" onClick={() => setAccountType('contractor')} />
        </div>
        <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          Joining someone else&apos;s farm as staff?{' '}
          <a href="/join" style={{ color: 'var(--forest-dark)', fontWeight: 700, textDecoration: 'underline' }}>Enter your invite code</a>
        </div>
      </div>
    );
  }

  // ---- Step 2 (contractor): business name ----
  if (accountType === 'contractor') {
    return (
      <div style={shell}>
        {Brand}
        <button type="button" onClick={() => { setAccountType(null); setError(null); }} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, padding: 0 }}><ArrowLeft size={15} /> Back</button>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Your contractor account</div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 14 }}>
            What&apos;s your business called? You&apos;ll get a code to give to farms so they can send you job sheets. You can add your own operators later from Settings.
          </div>
          <input type="text" className="input" placeholder="e.g. AN Other Contracting" value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={120} autoComplete="off" />
        </div>
        {ErrorBox}
        <button type="button" onClick={handleContractor} disabled={submitting} className="btn-primary" style={{ padding: 14, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {submitting ? 'Setting up…' : <>Get started <ArrowRight size={16} /></>}
        </button>
      </div>
    );
  }

  // ---- Step 2 (farm): name + units ----
  return (
    <div style={shell}>
      {Brand}
      <button type="button" onClick={() => { setAccountType(null); setError(null); }} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, padding: 0 }}><ArrowLeft size={15} /> Back</button>

      <div className="card" style={{ padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>What&apos;s your farm called?</div>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 14 }}>Shown at the top of the app. You can change it later in Settings.</div>
        <input type="text" className="input" placeholder="e.g. Mill Farm" value={farmName} onChange={(e) => setFarmName(e.target.value)} maxLength={60} autoComplete="off" />
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>How do you measure your fields?</div>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 16 }}>We&apos;ll use this as the default for field sizes, fertiliser rates, and slurry rates. You can change it any time from Settings.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <UnitChoice active={unit === 'acres'} onClick={() => setUnit('acres')} title="Acres" subtitle="kg/ac · gal/ac · t/ac" />
          <UnitChoice active={unit === 'ha'} onClick={() => setUnit('ha')} title="Hectares" subtitle="kg/ha · m³/ha · t/ha" />
        </div>
      </div>

      {ErrorBox}

      <button type="button" onClick={handleFarm} disabled={!unit || submitting} className="btn-primary" style={{ padding: 14, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: !unit ? 0.5 : 1 }}>
        {submitting ? 'Saving…' : <>Continue <ArrowRight size={16} /></>}
      </button>
    </div>
  );
}

function ChoiceCard({ icon, title, subtitle, onClick }: { icon: React.ReactNode; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ textAlign: 'left', padding: '16px 18px', background: 'var(--card)', border: '2px solid var(--line)', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ color: 'var(--forest)', flexShrink: 0 }}>{icon}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{title}</span>
        <span style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.4 }}>{subtitle}</span>
      </span>
    </button>
  );
}

function UnitChoice({ active, onClick, title, subtitle }: { active: boolean; onClick: () => void; title: string; subtitle: string }) {
  return (
    <button type="button" onClick={onClick} style={{ textAlign: 'left', padding: '14px 16px', background: active ? 'var(--forest-soft)' : 'var(--card)', border: `2px solid ${active ? 'var(--forest)' : 'var(--line)'}`, borderRadius: 6, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{title}</span>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{subtitle}</span>
    </button>
  );
}
