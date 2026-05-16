import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { LogApplicationForm } from '@/components/LogApplicationForm';
import { loadField, loadAllProducts, loadSettings } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { Application } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function EditApplicationPage({
  params,
}: {
  params: { id: string; appId: string };
}) {
  const supabase = createClient();
  const [field, products, settings, appRes] = await Promise.all([
    loadField(params.id),
    loadAllProducts(),
    loadSettings(),
    supabase.from('applications').select('*').eq('id', params.appId).maybeSingle(),
  ]);
  if (!field) notFound();
  if (appRes.error || !appRes.data) notFound();

  const existing = appRes.data as Application;

  return (
    <div>
      <Header title="Edit application" subtitle={field.name} backHref={`/fields/${field.id}`} />
      <LogApplicationForm
        field={field}
        products={products}
        settings={settings}
        existing={existing}
      />
    </div>
  );
}
