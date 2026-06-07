import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { loadField, loadFieldSoilSamples } from '@/lib/data';
import { SoilSamplesShell } from '@/components/SoilSamplesShell';

export const dynamic = 'force-dynamic';

export default async function SoilSamplesPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { from?: string };
}) {
  const [field, samples] = await Promise.all([
    loadField(params.id),
    loadFieldSoilSamples(params.id),
  ]);
  if (!field) notFound();

  return (
    <div>
      <Header
        title="Soil samples"
        subtitle={field.name}
        backHref={searchParams.from || `/fields/${field.id}`}
      />
      <SoilSamplesShell fieldName={field.name} samples={samples} />
    </div>
  );
}
