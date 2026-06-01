import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { LogCutForm } from '@/components/LogCutForm';
import { loadField, loadSettings } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { Cut } from '@/lib/types';
import { getPlannedCuts } from '@/lib/rules';

export const dynamic = 'force-dynamic';

export default async function EditCutPage({
  params,
  searchParams,
}: {
  params: { id: string; cutId: string };
  searchParams: { from?: string };
}) {
  const supabase = createClient();
  const [field, settings, cutRes] = await Promise.all([
    loadField(params.id),
    loadSettings(),
    supabase.from('cuts').select('*').eq('id', params.cutId).maybeSingle(),
  ]);
  if (!field) notFound();
  if (cutRes.error || !cutRes.data) notFound();

  const existing = cutRes.data as Cut;
  const plannedCuts = getPlannedCuts(field);
  const plannedType = plannedCuts[existing.cut_number - 1] || 'silage';
  const backHref = searchParams.from || `/fields/${field.id}`;

  return (
    <div>
      <Header title="Edit cut" subtitle={field.name} backHref={backHref} />
      <LogCutForm
        field={field}
        settings={settings}
        nextCutNumber={existing.cut_number}
        plannedType={plannedType}
        existing={existing}
        returnTo={searchParams.from}
      />
    </div>
  );
}
