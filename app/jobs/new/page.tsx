import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { JobBuilder } from '@/components/JobBuilder';
import { loadFields, loadSettings, loadAllProducts, loadSprayProducts, loadFarmMembers, loadFarmContractors } from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import { JOB_TYPES } from '@/lib/jobTypes';

export const dynamic = 'force-dynamic';

export default async function NewJobPage() {
  const [fields, settings, products, sprayProducts, members] = await Promise.all([
    loadFields(), loadSettings(), loadAllProducts(), loadSprayProducts(), loadFarmMembers(),
  ]);
  const farmContractors = await loadFarmContractors();
  if (!settings.onboarded) redirect('/welcome');
  const ctx = await getFarmContext();
  if (!ctx?.isAdmin) redirect('/jobs');

  const bFields = fields.filter((f) => !f.needs_setup).map((f) => ({ id: f.id, name: f.name, ha: f.ha, boundary: f.boundary ?? null }));
  const bProducts = products.map((p) => ({ id: p.id, name: p.name, type: p.type }));
  const bSpray = sprayProducts.map((p) => ({ id: p.id, name: p.name, default_l_per_ha: p.default_l_per_ha }));
  const staff = members.filter((m) => m.role === 'staff').map((m, i) => ({ id: m.member_id, label: `Staff member ${i + 1}` }));
  const contractors = farmContractors.map((c) => ({ id: c.contractor_user_id, label: c.label ?? 'Contractor' }));

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="New job sheet" subtitle="Build a job to send out" backHref="/jobs" />
      <JobBuilder jobTypes={JOB_TYPES} fields={bFields} products={bProducts} sprayProducts={bSpray} staff={staff} contractors={contractors} unitSystem={settings.unitSystem} />
    </div>
  );
}
