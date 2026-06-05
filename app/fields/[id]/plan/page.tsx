import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { EditPlanForm } from '@/components/EditPlanForm';
import { loadField } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function PlanPage({ params, searchParams }: { params: { id: string }; searchParams: { from?: string } }) {
  const field = await loadField(params.id);
  if (!field) notFound();
  return (
    <div>
      <Header title="Edit cut plan" subtitle={field.name} backHref={searchParams.from || `/fields/${field.id}`} />
      <EditPlanForm field={field} />
    </div>
  );
}
