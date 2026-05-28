'use client';

import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get('reset') === 'ok') {
      setNotice('Password updated. Sign in with your new password.');
    }
  }, [searchParams]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <form onSubmit={handleLogin} style={{ padding: 16 }}>
      {notice && (
        <div
          className="card"
          style={{
            padding: 12,
            marginBottom: 14,
            background: 'var(--forest-soft)',
            borderColor: 'var(--forest)',
            color: 'var(--forest-dark)',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {notice}
        </div>
      )}
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
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        {loading ? 'Signing in\u2026' : 'Sign in'}
      </button>
      <div style={{ marginTop: 14, textAlign: 'center' }}>
        <Link
          href="/forgot-password"
          style={{ fontSize: 13, color: 'var(--forest-dark)', fontWeight: 700, textDecoration: 'underline' }}
        >
          Forgot password?
        </Link>
      </div>
      <div style={{ marginTop: 18, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
        Don&apos;t have an account?{' '}
        <Link href="/signup" style={{ color: 'var(--forest-dark)', fontWeight: 700, textDecoration: 'underline' }}>
          Create one
        </Link>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div>
      <Header title="Sign in" subtitle="Swardly" />
      <Suspense fallback={<div style={{ padding: 16 }} />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
