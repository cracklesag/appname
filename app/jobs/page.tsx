import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, ClipboardList, ChevronRight } from 'lucide-react';
import { Header } from '@/components/Header';
import { loadJobs, loadSettings } from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import { jobTypeDef } from '@/lib/jobTypes';
import { fmtDate } from '@/lib/rules';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', sent: 'Sent', submitted: 'Submitted', approved: 'Logged', archived: 'Archived' };
const STATUS_COLOUR: Record<string, string> = { sent: 'var(--muted)', submitted: '#b06a37', approved: 'var(--forest-dark)', draft: 'var(--muted)', archived: 'var(--muted)' };

export default async function JobsPage({ searchParams }: { searchParams: { from?: string; status?: string } }) {
  const [jobs, settings] = await Promise.all([loadJobs(), loadSettings()]);
  if (!settings.onboarded) redirect('/welcome');
  const ctx = await getFarmContext();
  const isAdmin = !!ctx?.isAdmin;
  const isContractor = settings.accountType === 'contractor';
  const backHref = searchParams.from && searchParams.from.startsWith('/') ? searchParams.from : '/';

  // Status filter chips. "needs" = submitted (waiting for approval), the one
  // an admin most needs to find once the list grows.
  const filter = ['needs', 'out', 'done'].includes(searchParams.status ?? '') ? searchParams.status! : 'all';
  const visible = jobs.filter((j) => {
    if (filter === 'needs') return j.status === 'submitted';
    if (filter === 'out') return j.status === 'sent' || j.status === 'draft';
    if (filter === 'done') return j.status === 'approved' || j.status === 'archived';
    return true;
  });
  const needsCount = jobs.filter((j) => j.status === 'submitted').length;
  const chip = (key: string, label: string) => {
    const active = filter === key;
    const qs = new URLSearchParams();
    if (searchParams.from) qs.set('from', searchParams.from);
    if (key !== 'all') qs.set('status', key);
    return (
      <Link key={key} href={`/jobs${qs.toString() ? `?${qs.toString()}` : ''}`} style={{ flex: '0 0 auto', padding: '7px 14px', borderRadius: 99, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: active ? 'var(--forest)' : 'var(--card)', color: active ? '#fff' : 'var(--ink)', border: `1px solid ${active ? 'var(--forest)' : 'var(--line)'}` }}>
        {label}
      </Link>
    );
  };

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header
        title="Job sheets"
        subtitle={isContractor ? 'Jobs sent to you' : 'Send work out'}
        backHref={backHref}
        right={isAdmin && !isContractor ? <Link href="/jobs/new" className="icon-btn" aria-label="New job"><Plus size={22} /></Link> : undefined}
      />
      <div style={{ padding: 16 }}>
        {jobs.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {chip('all', 'All')}
            {chip('needs', needsCount > 0 ? `Needs approval (${needsCount})` : 'Needs approval')}
            {chip('out', 'Out')}
            {chip('done', 'Done')}
          </div>
        )}
        {visible.length === 0 ? (
          <div className="card" style={{ padding: 24, textAlign: 'center' }}>
            <ClipboardList size={26} style={{ color: 'var(--muted)' }} />
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 10 }}>{jobs.length > 0 ? 'Nothing in this filter' : isContractor ? 'No jobs sent to you yet' : 'No job sheets yet'}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>{isContractor ? 'When a farm sends you a job sheet, it shows up here to tick off.' : 'Build a job to send to staff or a contractor — what to spread or spray, on which fields.'}</div>
            {isAdmin && !isContractor && <Link href="/jobs/new" className="btn-primary" style={{ display: 'inline-block', marginTop: 14, textDecoration: 'none' }}>New job sheet</Link>}
          </div>
        ) : (
          visible.map((j) => {
            const def = jobTypeDef(j.job_type);
            return (
              <Link key={j.id} href={`/jobs/${j.id}`} className="card" style={{ padding: 14, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, textDecoration: 'none' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{j.title}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>
                    {isContractor && j.farm_name ? `${j.farm_name} · ` : ''}{def?.label ?? j.job_type}{j.due_date ? ` · due ${fmtDate(j.due_date)}` : ''}{!isContractor && j.contractor_label ? ` · ${j.contractor_label}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: STATUS_COLOUR[j.status] ?? 'var(--muted)' }}>{STATUS_LABEL[j.status] ?? j.status}</span>
                  <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
