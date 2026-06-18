import { notFound, redirect } from 'next/navigation';
import EditPartApplicationArea from '@/components/EditPartApplicationArea';
import {
  loadField,
  loadApplicationsForField,
  loadApplicationAreasForField,
  loadAllProducts,
  loadSettings,
} from '@/lib/data';
import { patchK2oPerHa } from '@/lib/partials';
import type { FieldGeometry } from '@/lib/geo';

export const dynamic = 'force-dynamic';

export default async function EditPartApplicationAreaPage({
  params,
}: {
  params: { id: string; appId: string };
}) {
  const settings = await loadSettings();
  if (!settings.onboarded) redirect('/welcome');

  const [field, applications, areas, products] = await Promise.all([
    loadField(params.id),
    loadApplicationsForField(params.id),
    loadApplicationAreasForField(params.id),
    loadAllProducts(),
  ]);
  if (!field) notFound();

  const boundary = (field.boundary ?? null) as FieldGeometry | null;
  const app = applications.find((a) => a.id === params.appId);
  if (!app || app.coverage !== 'partial' || !boundary) {
    redirect(`/fields/${params.id}/part-applications`);
  }

  const product = products.find((p) => p.id === app.product_id);
  const existing = areas.find((ar) => ar.application_id === params.appId);

  return (
    <EditPartApplicationArea
      fieldId={params.id}
      applicationId={params.appId}
      boundary={boundary}
      productName={product?.name ?? 'Application'}
      k2oPerHa={patchK2oPerHa(app, products)}
      unitSystem={settings.unitSystem}
      guideArea={(existing?.polygon as FieldGeometry) ?? undefined}
    />
  );
}
