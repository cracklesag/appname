'use client';

import { useState } from 'react';
import { ListChecks, StickyNote, CalendarDays } from 'lucide-react';
import { TodoList, type MemberOpt } from './TodoList';
import { NotesPanel } from './NotesPanel';
import { DiaryCalendar } from './DiaryCalendar';
import type { FarmNote, Todo } from '@/lib/types';
import type { DiaryEvent } from '@/lib/diary';

/**
 * The Diary. Admin: three tabs — To-dos, Notes, Calendar.
 * Staff: just their to-do list, no tabs, no admin surfaces.
 */
export function DiaryShell({
  isAdmin, meId, todos, notes, events, members,
}: {
  isAdmin: boolean;
  meId: string;
  todos: Todo[];
  notes: FarmNote[];
  events: DiaryEvent[];
  members: MemberOpt[];
}) {
  const [tab, setTab] = useState<'todos' | 'notes' | 'calendar'>('todos');

  if (!isAdmin) {
    // Staff view: the list, nothing else.
    return (
      <div style={{ padding: 16 }}>
        <TodoList todos={todos} members={members} isAdmin={false} meId={meId} />
      </div>
    );
  }

  const openCount = todos.filter((t) => !t.done_at).length;

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', background: 'var(--card)' }}>
        {([
          { key: 'todos' as const, label: openCount > 0 ? `To-dos (${openCount})` : 'To-dos', Icon: ListChecks },
          { key: 'notes' as const, label: 'Notes', Icon: StickyNote },
          { key: 'calendar' as const, label: 'Calendar', Icon: CalendarDays },
        ]).map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`tab ${tab === key ? 'active' : ''}`}
            style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: 'none', background: 'transparent', cursor: 'pointer' }}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <div style={{ padding: 16 }}>
        {tab === 'todos' && <TodoList todos={todos} members={members} isAdmin meId={meId} />}
        {tab === 'notes' && <NotesPanel notes={notes} />}
        {tab === 'calendar' && <DiaryCalendar events={events} />}
      </div>
    </div>
  );
}
