import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { SoilForm } from '@/components/SoilForm';
import { DeleteFieldSection } from '@/components/DeleteFieldSection';
import { loadField } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function SoilPage({ params }: { params: { id: string } }) {
  const field = await loadField(params.id);
  if (!field) notFound();

  return (
    <div>
      <Header title="Update field" subtitle={field.name} backHref={`/fields/${field.id}`} />
      <SoilForm field={field} />
      <div style={{ padding: '0 16px 100px' }}>
        <DeleteFieldSection fieldId={field.id} fieldName={field.name} />
      </div>
    </div>
  );
}
