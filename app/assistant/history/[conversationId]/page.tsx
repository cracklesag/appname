import { redirect, notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { getFarmContext } from '@/lib/farm';
import { loadSettings, loadAssistantThread } from '@/lib/data';

export const dynamic = 'force-dynamic';

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

export default async function AssistantThreadPage({ params }: { params: { conversationId: string } }) {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  const settings = await loadSettings();

  const conversationId = decodeURIComponent(params.conversationId);
  const thread = await loadAssistantThread(conversationId);
  if (!thread) notFound();

  return (
    <div>
      <Header title="Chat" subtitle={settings.farmName ?? undefined} backHref="/assistant/history" />

      <div style={{ padding: '8px 16px 40px' }}>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 2px 16px' }}>
          {when(thread.startedAt)}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {thread.turns.map((turn, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Question — right-aligned bubble */}
              <div style={{ alignSelf: 'flex-end', maxWidth: '85%' }}>
                <div
                  style={{
                    background: 'var(--forest)', color: 'var(--paper)',
                    padding: '10px 14px', borderRadius: '14px 14px 4px 14px',
                    fontSize: 15, lineHeight: 1.45, whiteSpace: 'pre-wrap',
                  }}
                >
                  {turn.question}
                </div>
              </div>

              {/* Answer — left-aligned card, or the error if the turn failed */}
              <div style={{ alignSelf: 'flex-start', maxWidth: '90%' }}>
                {turn.error ? (
                  <div
                    className="card"
                    style={{ padding: '10px 14px', fontSize: 14, color: 'var(--muted)', fontStyle: 'italic', borderRadius: '14px 14px 14px 4px' }}
                  >
                    This question didn&rsquo;t get answered.
                  </div>
                ) : (
                  <div
                    className="card"
                    style={{ padding: '10px 14px', fontSize: 15, lineHeight: 1.5, color: 'var(--ink)', whiteSpace: 'pre-wrap', borderRadius: '14px 14px 14px 4px' }}
                  >
                    {turn.answer}
                  </div>
                )}
                {turn.toolsUsed.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0 4px' }}>
                    Looked up: {turn.toolsUsed.join(', ')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
