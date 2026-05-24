import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/Header';
import { GrassSystemsManager } from '@/components/GrassSystemsManager';
import { loadGrassSystems, loadSettings } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function GrassSystemsSettingsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [grassSystems, settings] = await Promise.all([
    loadGrassSystems(),
    loadSettings(),
  ]);

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Grass systems" subtitle="Catalogue & visibility" backHref="/settings" />
      <GrassSystemsManager
        grassSystems={grassSystems}
        hiddenIds={settings.hiddenGrassSystemIds ?? []}
      />
    </div>
  );
}
