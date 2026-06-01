import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { LogApplicationForm } from '@/components/LogApplicationForm';
import { loadField, loadAllProducts, loadSettings, loadProductUsage, loadAllApplications } from '@/lib/data';
import type { ProductType } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID_TYPES = ['bag_fert', 'slurry', 'solid_manure', 'lime'];

export default async function LogApplicationPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { type?: string; from?: string };
}) {
  const [field, products, settings, usage, allApps] = await Promise.all([
    loadField(params.id), loadAllProducts(), loadSettings(), loadProductUsage(), loadAllApplications(),
  ]);
  if (!field) notFound();

  const initialType = VALID_TYPES.includes(searchParams.type ?? '')
    ? (searchParams.type as ProductType)
    : undefined;
  const backHref = searchParams.from || `/fields/${field.id}`;

  // Latest application date per (field, product type) so the form can warn about
  // a likely duplicate (same field + same type within a week).
  const productTypeById = new Map(products.map((p) => [p.id, p.type]));
  const recentByField: Record<string, Record<string, string>> = {};
  for (const a of allApps) {
    const t = productTypeById.get(a.product_id);
    if (!t) continue;
    const byType = (recentByField[a.field_id] ??= {});
    if (!byType[t] || a.date_applied > byType[t]) byType[t] = a.date_applied;
  }

  return (
    <div>
      <Header title="Log application" subtitle={field.name} backHref={backHref} />
      <LogApplicationForm field={field} products={products} settings={settings} initialType={initialType} usage={usage} recentByField={recentByField} />
    </div>
  );
}
