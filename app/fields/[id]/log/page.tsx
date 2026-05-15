import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { LogApplicationForm } from '@/components/LogApplicationForm';
import { loadField, loadAllProducts, loadSettings } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function LogApplicationPage({ params }: { params: { id: string } }) {
  const [field, products, settings] = await Promise.all([
    loadField(params.id), loadAllProducts(), loadSettings(),
  ]);
  if (!field) notFound();

  return (
    <div>
      <Header title="Log application" subtitle={field.name} backHref={`/fields/${field.id}`} />
      <LogApplicationForm field={field} products={products} settings={settings} />
    </div>
  );
}
