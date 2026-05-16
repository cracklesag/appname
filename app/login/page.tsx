'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
    <div>
      <Header title="Sign in" subtitle="APP_NAME" />
      <form onSubmit={handleLogin} style={{ padding: 16 }}>
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
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        <div style={{ marginTop: 18, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          Don't have an account?{' '}
          <Link href="/signup" style={{ color: 'var(--forest-dark)', fontWeight: 700, textDecoration: 'underline' }}>
            Create one
          </Link>
        </div>
      </form>
    </div>
  );
}
