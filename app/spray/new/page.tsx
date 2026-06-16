import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { SprayRecordForm } from '@/components/SprayRecordForm';
import { loadFields, loadSettings, loadSprayProducts } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function NewSprayRecordPage({
  searchParams,
}: {
  searchParams: { field?: string; from?: string };
}) {
  const [fields, settings, sprayProducts] = await Promise.all([loadFields(), loadSettings(), loadSprayProducts()]);
  if (!settings.onboarded) redirect('/welcome');
  const backHref = searchParams.from && searchParams.from.startsWith('/') ? searchParams.from : '/spray';
  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="New spray record" backHref={backHref} />
      <SprayRecordForm
        fields={fields}
        sprayProducts={sprayProducts.map((p) => ({ id: p.id, name: p.name, default_l_per_ha: p.default_l_per_ha }))}
        unitSystem={settings.unitSystem}
        defaultFieldId={searchParams.field}
        returnTo="/spray"
      />
    </div>
  );
}
