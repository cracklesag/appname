'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Basic validation
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSentTo(email);
    setLoading(false);
  }

  // Success state — confirmation email sent
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
              Confirmation sent
            </div>
            <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5 }}>
              We've emailed a confirmation link to <strong>{sentTo}</strong>.
              Tap the link to confirm your account, then come back here and sign in.
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12, lineHeight: 1.5 }}>
              No email? Check your spam folder. If it really hasn't arrived in a few minutes,
              the email may have bounced — you can try again with a different address.
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
      <Header title="Create account" subtitle="Swardly" />
      <form onSubmit={handleSignup} style={{ padding: 16 }}>
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
        <div style={{ marginBottom: 14 }}>
          <div className="label">Password</div>
          <input
            type="password"
            className="input"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            At least 8 characters
          </div>
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
          {loading ? 'Creating account…' : 'Create account'}
        </button>

        <div style={{ marginTop: 18, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: 'var(--forest-dark)', fontWeight: 700, textDecoration: 'underline' }}>
            Sign in
          </Link>
        </div>
      </form>
    </div>
  );
}
