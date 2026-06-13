import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { getFarmContext } from '@/lib/farm';
import { loadSettings, loadAssistantThreads, ASSISTANT_HISTORY_RETENTION_DAYS } from '@/lib/data';
import { MessageSquare } from 'lucide-react';

export const dynamic = 'force-dynamic';

// Relative "2h ago" / "Mon 14:32" style timestamp, computed server-side.
function ago(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export default async function AssistantHistoryPage() {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  const settings = await loadSettings();
  const threads = await loadAssistantThreads();

  return (
    <div>
      <Header title="Past chats" subtitle={settings.farmName ?? undefined} backHref="/assistant" />

      <div style={{ padding: '8px 16px 32px' }}>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 2px 16px' }}>
          Your conversations with the assistant from the last {ASSISTANT_HISTORY_RETENTION_DAYS} days.
          Older chats clear automatically.
        </p>

        {threads.length === 0 ? (
          <div className="card" style={{ padding: 28, textAlign: 'center' }}>
            <MessageSquare size={26} style={{ color: 'var(--muted)' }} />
            <div style={{ fontWeight: 700, margin: '10px 0 4px', color: 'var(--ink)' }}>No chats yet</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
              Questions you ask the assistant will show up here so you can look back at the answers.
            </div>
            <Link href="/assistant" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block', marginTop: 16 }}>
              Ask a question
            </Link>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {threads.map((t) => (
              <Link
                key={t.conversationId}
                href={`/assistant/history/${encodeURIComponent(t.conversationId)}`}
                className="card"
                style={{ display: 'block', padding: '14px 16px', textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                  <div style={{ fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.firstQuestion}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{ago(t.lastAt)}</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  {t.turnCount} {t.turnCount === 1 ? 'question' : 'questions'}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
