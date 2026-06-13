import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { SoilForm } from '@/components/SoilForm';
import { DeleteFieldSection } from '@/components/DeleteFieldSection';
import { loadField, loadGrassSystems, loadSettings } from '@/lib/data';
import { getFarmContext } from '@/lib/farm';

export const dynamic = 'force-dynamic';

export default async function SoilPage({ params, searchParams }: { params: { id: string }; searchParams: { from?: string } }) {
  const [field, grassSystems, settings, ctx] = await Promise.all([
    loadField(params.id),
    loadGrassSystems(),
    loadSettings(),
    getFarmContext(),
  ]);
  if (!field) notFound();
  // An agronomist may set soil/grass on the farm's behalf, but must never be
  // able to delete a field — only the farm admin sees that.
  const isAdmin = ctx?.isAdmin ?? true;

  return (
    <div>
      <Header title="Update field" subtitle={field.name} backHref={searchParams.from || `/fields/${field.id}`} />
      <SoilForm
        field={field}
        grassSystems={grassSystems}
        hiddenGrassSystemIds={settings.hiddenGrassSystemIds ?? []}
        returnTo={searchParams.from}
      />
      {isAdmin && (
        <div style={{ padding: '0 16px 100px' }}>
          <DeleteFieldSection fieldId={field.id} fieldName={field.name} />
        </div>
      )}
    </div>
  );
}
