'use client';

import { useState } from 'react';
import { ArrowRight, AlertCircle } from 'lucide-react';
import { completeOnboarding } from '@/lib/actions';

export function WelcomeForm() {
  const [unit, setUnit] = useState<'acres' | 'ha' | null>(null);
  const [farmName, setFarmName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    if (!unit) return;
    setSubmitting(true);
    setError(null);
    try {
      await completeOnboarding(unit, farmName);
    } catch (err) {
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) {
        setError(err.message);
      }
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        maxWidth: 480,
        margin: '0 auto',
        padding: 24,
        paddingTop: 48,
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/swardly-mark.png" alt="" width={54} height={40} style={{ display: 'block', objectFit: 'contain' }} />
          <span style={{
            fontFamily: '"Fraunces", serif',
            fontSize: 26,
            fontWeight: 600,
            color: 'var(--forest-dark)',
            letterSpacing: '-0.5px',
          }}>swardly</span>
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 8,
          }}
        >
          Know your fields. Plan your future.
        </div>
        <h1 style={{ margin: 0, fontSize: 28, color: 'var(--ink)', fontFamily: '"Fraunces", serif' }}>
          Welcome
        </h1>
        <p
          style={{
            margin: '12px 0 0',
            fontSize: 14,
            color: 'var(--ink-soft)',
            lineHeight: 1.6,
          }}
        >
          One quick question before we get started.
        </p>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>
          What&apos;s your farm called?
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 14 }}>
          Shown at the top of the app. You can change it later in Settings.
        </div>
        <input
          type="text"
          className="input"
          placeholder="e.g. Mill Farm"
          value={farmName}
          onChange={(e) => setFarmName(e.target.value)}
          maxLength={60}
          autoComplete="off"
        />
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: 'var(--ink)',
            marginBottom: 8,
          }}
        >
          How do you measure your fields?
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--ink-soft)',
            lineHeight: 1.5,
            marginBottom: 16,
          }}
        >
          We'll use this as the default for field sizes, fertiliser rates, and slurry
          rates throughout the app. You can change it any time from Settings, or pick
          different units for different things if you'd rather mix.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <UnitChoice
            active={unit === 'acres'}
            onClick={() => setUnit('acres')}
            title="Acres"
            subtitle="kg/ac · gal/ac · t/ac"
          />
          <UnitChoice
            active={unit === 'ha'}
            onClick={() => setUnit('ha')}
            title="Hectares"
            subtitle="kg/ha · m³/ha · t/ha"
          />
        </div>
      </div>

      {error && (
        <div
          className="card"
          style={{
            padding: 12,
            background: 'var(--red-soft)',
            borderColor: 'var(--red)',
            color: 'var(--red)',
            fontSize: 13,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
          }}
        >
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        onClick={handleContinue}
        disabled={!unit || submitting}
        className="btn-primary"
        style={{
          padding: '14px',
          fontSize: 15,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: !unit ? 0.5 : 1,
        }}
      >
        {submitting ? 'Saving…' : (
          <>
            Continue <ArrowRight size={16} />
          </>
        )}
      </button>

      <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
        Joining someone else&apos;s farm?{' '}
        <a href="/join" style={{ color: 'var(--forest-dark)', fontWeight: 700, textDecoration: 'underline' }}>
          Enter your invite code
        </a>
      </div>
    </div>
  );
}

function UnitChoice({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '14px 16px',
        background: active ? 'var(--forest-soft)' : 'var(--card)',
        border: `2px solid ${active ? 'var(--forest)' : 'var(--line)'}`,
        borderRadius: 6,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>
        {title}
      </span>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{subtitle}</span>
    </button>
  );
}
