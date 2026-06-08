import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { SprayRecordForm } from '@/components/SprayRecordForm';
import { loadFields, loadSettings } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function NewSprayRecordPage({
  searchParams,
}: {
  searchParams: { field?: string; from?: string };
}) {
  const [fields, settings] = await Promise.all([loadFields(), loadSettings()]);
  if (!settings.onboarded) redirect('/welcome');
  const backHref = searchParams.from && searchParams.from.startsWith('/') ? searchParams.from : '/spray';
  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="New spray record" backHref={backHref} />
      <SprayRecordForm
        fields={fields}
        unitSystem={settings.unitSystem}
        defaultFieldId={searchParams.field}
        returnTo="/spray"
      />
    </div>
  );
}
