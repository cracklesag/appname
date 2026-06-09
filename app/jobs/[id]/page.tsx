import { redirect } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { loadJob, loadSettings, loadAllProducts } from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import { deleteJob } from '@/lib/actions';
import { jobTypeDef } from '@/lib/jobTypes';
import { fmtDate } from '@/lib/rules';

export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: { id: string } }) {
  const [data, settings, products] = await Promise.all([loadJob(params.id), loadSettings(), loadAllProducts()]);
  if (!settings.onboarded) redirect('/welcome');
  if (!data) redirect('/jobs');
  const ctx = await getFarmContext();
  const isAdmin = !!ctx?.isAdmin;
  const { job, fields } = data;
  const def = jobTypeDef(job.job_type);
  const product = job.product_id != null ? products.find((p) => p.id === job.product_id) : null;
  const areaUnit = settings.unitSystem === 'acres' ? 'ac' : 'ha';
  const toUnit = (ha: number) => (settings.unitSystem === 'acres' ? ha * 2.47105 : ha);

  const instructionLine = (() => {
    if (def?.commitsTo === 'applications') return `${product?.name ?? 'Product'}${job.rate_value != null ? ` @ ${job.rate_value} ${def.rateNoun}` : ''}`;
    if (def?.id === 'spray') {
      const mix = (job.spray_spec ?? []).map((s) => `${s.name}${s.l_per_ha != null ? ` @ ${s.l_per_ha} L/ha` : ''}`).join(' + ');
      return `${mix || 'Spray'}${job.water_l_per_ha != null ? ` · ${job.water_l_per_ha} L/ha water` : ''}`;
    }
    return job.instruction ?? '';
  })();

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title={job.title} subtitle={def?.label ?? job.job_type} backHref="/jobs" />
      <div style={{ padding: 16 }}>
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Instruction</div>
          <div style={{ fontSize: 15, color: 'var(--ink)', lineHeight: 1.45 }}>{instructionLine || '—'}</div>
          {job.notes && <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 8 }}>{job.notes}</div>}
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>
            {job.due_date ? `Due ${fmtDate(job.due_date)}` : 'No due date'}{job.contractor_label ? ` · for ${job.contractor_label}` : ''}
          </div>
        </div>

        <div className="label" style={{ marginBottom: 8 }}>Fields <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--muted)' }}>· {fields.length}</span></div>
        {fields.map((f) => (
          <div key={f.id} className="card" style={{ padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{f.field_name}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              {f.area_ha != null ? `${toUnit(f.area_ha).toFixed(2)} ${areaUnit}` : ''}
              {f.planned_rate_value != null ? ` · ${f.planned_rate_value} ${f.planned_rate_unit ?? ''}` : ''}
            </div>
          </div>
        ))}

        <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 14, padding: '0 2px' }}>
          Sending this out (share-link or to someone&apos;s app), the operator ticking off each field, and it logging back as applications — all coming in the next builds.
        </div>

        {isAdmin && (
          <form action={deleteJob} style={{ marginTop: 16 }}>
            <input type="hidden" name="id" value={job.id} />
            <button type="submit" className="btn-ghost" style={{ width: '100%', color: 'var(--clay, #b06a37)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Trash2 size={16} /> Delete job sheet
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
