import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { AssistantChat } from '@/components/AssistantChat';
import { getFarmContext } from '@/lib/farm';
import { loadSettings } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function AssistantPage() {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');

  const settings = await loadSettings();

  return (
    <div>
      <Header title="Ask Swardly" subtitle={settings.farmName ?? undefined} backHref="/" />
      <AssistantChat />
    </div>
  );
}
