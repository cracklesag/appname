import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { loadSettings } from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import { resolveAgronomy, DEFAULT_AGRONOMY } from '@/lib/agronomy';
import { AgronomyEditor } from '@/components/AgronomyEditor';

export const dynamic = 'force-dynamic';

export default async function AgronomySettingsPage() {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');
  // RB209 reference values drive every recommendation — admin only.
  if (!ctx.isAdmin && ctx.accountType !== 'agronomist') redirect('/settings');

  const settings = await loadSettings();
  const initial = resolveAgronomy(settings);

  return (
    <div style={{ paddingBottom: 24 }}>
      <Header title="Agronomy" subtitle="Nutrient reference values · advanced" backHref="/settings" />
      <div style={{ padding: 16 }}>
        <AgronomyEditor initial={initial} defaults={DEFAULT_AGRONOMY} />
      </div>
    </div>
  );
}
