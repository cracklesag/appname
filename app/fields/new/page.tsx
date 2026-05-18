import { Header } from '@/components/Header';
import { AddFieldForm } from '@/components/AddFieldForm';
import { loadSettings } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function NewFieldPage() {
  const settings = await loadSettings();
  return (
    <div>
      <Header title="Add field" subtitle="APP_NAME" backHref="/" />
      <AddFieldForm unitSystem={settings.unitSystem} />
    </div>
  );
}
