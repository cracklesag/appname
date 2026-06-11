import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { TimesheetView } from '@/components/TimesheetView';
import { loadTimesheetJobs, loadSettings } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function TimesheetsPage() {
  const [jobs, settings] = await Promise.all([loadTimesheetJobs(), loadSettings()]);
  if (!settings.onboarded) redirect('/welcome');
  return (
    <div style={{ paddingBottom: 90 }}>
      <Header tone="forest" title="Timesheets" subtitle="Hours and work done — by farm and period" backHref={settings.accountType === 'contractor' ? '/jobs' : '/'} />
      <div style={{ padding: 16 }}>
        <TimesheetView jobs={jobs} unitSystem={settings.unitSystem === 'acres' ? 'acres' : 'hectares'} />
      </div>
    </div>
  );
}
