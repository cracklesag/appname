import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { JobBuilder } from '@/components/JobBuilder';
import { loadFields, loadSettings, loadAllProducts, loadSprayProducts } from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import { JOB_TYPES } from '@/lib/jobTypes';

export const dynamic = 'force-dynamic';

export default async function NewJobPage() {
  const [fields, settings, products, sprayProducts] = await Promise.all([
    loadFields(), loadSettings(), loadAllProducts(), loadSprayProducts(),
  ]);
  if (!settings.onboarded) redirect('/welcome');
  const ctx = await getFarmContext();
  if (!ctx?.isAdmin) redirect('/jobs');

  const bFields = fields.filter((f) => !f.needs_setup).map((f) => ({ id: f.id, name: f.name, ha: f.ha, boundary: f.boundary ?? null }));
  const bProducts = products.map((p) => ({ id: p.id, name: p.name, type: p.type }));
  const bSpray = sprayProducts.map((p) => ({ id: p.id, name: p.name, default_l_per_ha: p.default_l_per_ha }));

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="New job sheet" subtitle="Build a job to send out" backHref="/jobs" />
      <JobBuilder jobTypes={JOB_TYPES} fields={bFields} products={bProducts} sprayProducts={bSpray} unitSystem={settings.unitSystem} />
    </div>
  );
}
