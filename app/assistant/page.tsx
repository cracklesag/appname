import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { AssistantChat } from '@/components/AssistantChat';
import { getFarmContext } from '@/lib/farm';
import { loadSettings } from '@/lib/data';
import { History } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AssistantPage() {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');

  const settings = await loadSettings();

  return (
    <div>
      <Header
        title="Ask Swardly"
        subtitle={settings.farmName ?? undefined}
        backHref="/"
        right={
          <Link href="/assistant/history" className="icon-btn" aria-label="Past chats">
            <History size={20} />
          </Link>
        }
      />
      <AssistantChat />
    </div>
  );
}
