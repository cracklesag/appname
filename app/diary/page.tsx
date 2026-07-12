import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { DiaryShell } from '@/components/DiaryShell';
import { getFarmContext } from '@/lib/farm';
import {
  loadTodos, loadNotes, loadFields, loadAllProducts, loadAllApplications,
  loadAllCuts, loadJobs, loadFarmMembers, loadSprayRecords,
} from '@/lib/data';
import { buildDiaryEvents } from '@/lib/diary';

export const dynamic = 'force-dynamic';

/**
 * The Diary — to-dos, notes, and a farm calendar.
 * Admin: all three tabs. Staff: their to-do list only (no calendar, no notes).
 * The calendar derives events live from applications, cuts, jobs and dated
 * to-dos — nothing stored, so it can't drift from reality.
 */
export default async function DiaryPage() {
  const ctx = await getFarmContext();
  if (!ctx) redirect('/login');

  const isAdmin = ctx.isAdmin;

  // Staff need only their todos (RLS filters) + member names for pills.
  // Admins additionally get notes + everything the calendar derives from.
  const [todos, members] = await Promise.all([loadTodos(), loadFarmMembers()]);

  const memberOpts = members.map((m, i) => ({
    id: m.member_id,
    name: m.member_name ?? (m.role === 'admin' ? 'Admin' : `Staff member ${i + 1}`),
  }));

  if (!isAdmin) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--paper)', paddingBottom: 90 }}>
        <Header title="To-dos" subtitle="Jobs pushed to you — tick them off as you go" />
        <DiaryShell isAdmin={false} meId={ctx.userId} todos={todos} notes={[]} events={[]} members={memberOpts} />
      </div>
    );
  }

  const [notes, fields, products, applications, cuts, jobs, sprayRecords] = await Promise.all([
    loadNotes(), loadFields(), loadAllProducts(), loadAllApplications(), loadAllCuts(), loadJobs(), loadSprayRecords(),
  ]);

  const fieldNameById = new Map(fields.map((f) => [f.id, f.name]));
  const events = buildDiaryEvents({
    applications, cuts, jobs, todos, products,
    fieldName: (id) => fieldNameById.get(id) ?? 'Field',
    sprayDates: sprayRecords.map((s) => ({ id: s.id, date: s.date_applied, fieldId: s.field_id })),
  });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', paddingBottom: 90 }}>
      <Header title="Diary" subtitle="To-dos, notes and the farm calendar" />
      <DiaryShell isAdmin meId={ctx.userId} todos={todos} notes={notes} events={events} members={memberOpts} />
    </div>
  );
}
