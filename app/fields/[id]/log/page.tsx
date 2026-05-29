import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { LogApplicationForm } from '@/components/LogApplicationForm';
import { loadField, loadAllProducts, loadSettings } from '@/lib/data';
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
  const [field, products, settings] = await Promise.all([
    loadField(params.id), loadAllProducts(), loadSettings(),
  ]);
  if (!field) notFound();

  const initialType = VALID_TYPES.includes(searchParams.type ?? '')
    ? (searchParams.type as ProductType)
    : undefined;
  const backHref = searchParams.from || `/fields/${field.id}`;

  return (
    <div>
      <Header title="Log application" subtitle={field.name} backHref={backHref} />
      <LogApplicationForm field={field} products={products} settings={settings} initialType={initialType} />
    </div>
  );
}
