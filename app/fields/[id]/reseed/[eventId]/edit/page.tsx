import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { FieldEventForm } from '@/components/FieldEventForm';
import { loadField, loadGrassSystems, loadSettings } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import { FieldEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function EditFieldEventPage({
  params,
  searchParams,
}: {
  params: { id: string; eventId: string };
  searchParams: { from?: string };
}) {
  const supabase = createClient();
  const [field, grassSystems, settings, evRes] = await Promise.all([
    loadField(params.id),
    loadGrassSystems(),
    loadSettings(),
    supabase.from('field_events').select('*').eq('id', params.eventId).maybeSingle(),
  ]);
  if (!field) notFound();
  if (evRes.error || !evRes.data) notFound();

  const existing = evRes.data as FieldEvent;
  const backHref = searchParams.from || `/fields/${field.id}`;

  return (
    <div>
      <Header title="Edit field event" subtitle={field.name} backHref={backHref} />
      <FieldEventForm
        field={field}
        grassSystems={grassSystems}
        hiddenGrassSystemIds={settings.hiddenGrassSystemIds ?? []}
        existing={existing}
        returnTo={searchParams.from}
      />
    </div>
  );
}
