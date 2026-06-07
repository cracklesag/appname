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

  // Latest application date per (field, product) so the form can warn about a
  // likely duplicate — the SAME product re-logged on a field within a week.
  // Different products (e.g. CAN then MOP) are distinct applications, not dupes.
  const recentByField: Record<string, Record<string, string>> = {};
  for (const a of allApps) {
    const key = String(a.product_id);
    const byProduct = (recentByField[a.field_id] ??= {});
    if (!byProduct[key] || a.date_applied > byProduct[key]) byProduct[key] = a.date_applied;
  }

  return (
    <div>
      <Header title="Log application" subtitle={field.name} backHref={backHref} />
      <LogApplicationForm field={field} products={products} settings={settings} initialType={initialType} usage={usage} recentByField={recentByField} returnTo={searchParams.from} />
    </div>
  );
}
