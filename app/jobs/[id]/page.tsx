import { redirect } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Header } from '@/components/Header';
import { JobWorkflow } from '@/components/JobWorkflow';
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
  const { job, fields } = data;

  const isAdmin = !!ctx?.isAdmin && job.user_id === ctx?.ownerId;
  const isAssignee = !!ctx && job.assignee_user_id === ctx.userId;
  const role: 'admin' | 'assignee' | 'viewer' = isAdmin ? 'admin' : isAssignee ? 'assignee' : 'viewer';
  const autoLog = !!ctx && job.user_id === ctx.ownerId; // farm staff/admin log immediately
  const def = jobTypeDef(job.job_type);
  const hasRate = def?.commitsTo === 'applications' || def?.id === 'spray';
  const product = job.product_id != null ? products.find((p) => p.id === job.product_id) : null;
  const areaUnit = settings.unitSystem === 'acres' ? 'ac' : 'ha';

  const instructionLine = (() => {
    if (def?.commitsTo === 'applications') return `${product?.name ?? 'Product'}${job.rate_value != null ? ` @ ${job.rate_value} ${def.rateNoun}` : ''}`;
    if (def?.id === 'spray') {
      const mix = (job.spray_spec ?? []).map((s) => `${s.name}${s.l_per_ha != null ? ` @ ${s.l_per_ha} L/ha` : ''}`).join(' + ');
      return `${mix || 'Spray'}${job.water_l_per_ha != null ? ` · ${job.water_l_per_ha} L/ha water` : ''}`;
    }
    return job.instruction ?? '';
  })();

  const wFields = fields.map((f) => ({
    id: f.id,
    name: f.field_name,
    area: f.area_ha,
    plannedRate: f.planned_rate_value,
    plannedUnit: f.planned_rate_unit,
    status: f.status,
    actualRate: f.actual_rate_value,
  }));

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
        <JobWorkflow
          jobId={job.id}
          status={job.status}
          role={role}
          autoLog={autoLog}
          rateNoun={def?.rateNoun ?? null}
          hasRate={hasRate}
          fields={wFields}
          unitSystem={settings.unitSystem}
          fmtDateStr={job.approved_at ? fmtDate(job.approved_at.slice(0, 10)) : null}
          approvedAt={job.approved_at}
        />

        {isAdmin && job.status !== 'approved' && (
          <form action={deleteJob} style={{ marginTop: 20 }}>
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
