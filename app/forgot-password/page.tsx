'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });

    if (error) {
      // Show error but still treat as success in UX to prevent email enumeration —
      // Supabase itself returns success for non-existent emails, this catches
      // rate-limit / network errors only.
      setError(error.message);
      setLoading(false);
      return;
    }

    setSentTo(email);
    setLoading(false);
  }

  if (sentTo) {
    return (
      <div>
        <Header title="Check your email" subtitle="Swardly" />
        <div style={{ padding: 16 }}>
          <div
            className="card"
            style={{
              padding: 18,
              background: 'var(--forest-soft)',
              borderColor: 'var(--forest)',
            }}
          >
            <div style={{ fontSize: 14, color: 'var(--forest-dark)', fontWeight: 700, marginBottom: 8 }}>
              Reset link sent
            </div>
            <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5 }}>
              If an account exists for <strong>{sentTo}</strong>, we&apos;ve emailed
              a link to reset your password. Tap the link, set a new password, then
              come back here and sign in.
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12, lineHeight: 1.5 }}>
              No email? Check your spam folder. The link expires after an hour — if
              it&apos;s been longer than that, request a new one.
            </div>
          </div>
          <div style={{ marginTop: 18, textAlign: 'center' }}>
            <Link
              href="/login"
              style={{ fontSize: 14, color: 'var(--forest-dark)', fontWeight: 700, textDecoration: 'underline' }}
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header title="Reset password" subtitle="Swardly" />
      <form onSubmit={handleSubmit} style={{ padding: 16 }}>
        <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 18, lineHeight: 1.5 }}>
          Enter the email address you signed up with and we&apos;ll send you a link
          to set a new password.
        </div>
        <div style={{ marginBottom: 14 }}>
          <div className="label">Email</div>
          <input
            type="email"
            className="input"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {error && (
          <div
            className="card"
            style={{
              padding: 12,
              marginBottom: 14,
              background: 'var(--red-soft)',
              borderColor: 'var(--red)',
              color: 'var(--red)',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn-primary"
          style={{ width: '100%' }}
          disabled={loading}
        >
          {loading ? 'Sending link…' : 'Send reset link'}
        </button>

        <div style={{ marginTop: 18, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          Remembered it?{' '}
          <Link href="/login" style={{ color: 'var(--forest-dark)', fontWeight: 700, textDecoration: 'underline' }}>
            Sign in
          </Link>
        </div>
      </form>
    </div>
  );
}
