'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords don\u2019t match');
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Sign out to force a fresh login with the new password — this confirms
    // it works and clears the temporary recovery session.
    await supabase.auth.signOut();
    router.replace('/login?reset=ok');
    router.refresh();
  }

  return (
    <div>
      <Header title="Set new password" subtitle="Swardly" />
      <form onSubmit={handleSubmit} style={{ padding: 16 }}>
        <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 18, lineHeight: 1.5 }}>
          Choose a new password for your account. You&apos;ll be asked to sign in
          again afterwards.
        </div>
        <div style={{ marginBottom: 14 }}>
          <div className="label">New password</div>
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
        <div style={{ marginBottom: 14 }}>
          <div className="label">Confirm new password</div>
          <input
            type="password"
            className="input"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
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
          {loading ? 'Saving\u2026' : 'Save new password'}
        </button>

        <div style={{ marginTop: 18, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          <Link href="/login" style={{ color: 'var(--forest-dark)', fontWeight: 700, textDecoration: 'underline' }}>
            Back to sign in
          </Link>
        </div>
      </form>
    </div>
  );
}
