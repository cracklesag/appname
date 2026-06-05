import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { FieldEventForm } from '@/components/FieldEventForm';
import { loadField, loadGrassSystems, loadSettings } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function FieldEventPage({ params, searchParams }: { params: { id: string }; searchParams: { from?: string } }) {
  const [field, grassSystems, settings] = await Promise.all([
    loadField(params.id),
    loadGrassSystems(),
    loadSettings(),
  ]);
  if (!field) notFound();

  return (
    <div>
      <Header title="Log field event" subtitle={field.name} backHref={searchParams.from || `/fields/${field.id}`} />
      <FieldEventForm
        field={field}
        grassSystems={grassSystems}
        hiddenGrassSystemIds={settings.hiddenGrassSystemIds ?? []}
        returnTo={searchParams.from}
      />
    </div>
  );
}
