'use client';

import { useState } from 'react';
import { Plus, Trash2, CalendarDays, User } from 'lucide-react';
import { createTodo, toggleTodoDone, deleteTodo, reassignTodo } from '@/lib/actions';
import { fmtDateShort } from '@/lib/rules';
import type { Todo } from '@/lib/types';

export type MemberOpt = { id: string; name: string };

/**
 * The to-do list — the one surface both roles share.
 * Admin: add (with optional assignee + due date), tick, reassign, delete.
 * Staff: sees only their assigned items (RLS already filtered), can tick only.
 */
export function TodoList({
  todos, members, isAdmin, meId,
}: {
  todos: Todo[];
  members: MemberOpt[];
  isAdmin: boolean;
  meId: string;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const open = todos.filter((t) => !t.done_at);
  const done = todos.filter((t) => t.done_at);
  const nameOf = (id: string | null) =>
    id == null ? null : id === meId ? 'you' : (members.find((m) => m.id === id)?.name ?? 'member');

  const overdue = (t: Todo) => !!t.due_date && !t.done_at && t.due_date < new Date().toISOString().slice(0, 10);

  return (
    <div>
      {isAdmin && (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          {!showAdd ? (
            <button type="button" className="btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={() => setShowAdd(true)}>
              <Plus size={16} /> Add a to-do
            </button>
          ) : (
            <form
              action={async (fd) => { await createTodo(fd); setShowAdd(false); }}
            >
              <input name="title" className="input" placeholder="What needs doing?" maxLength={300} required autoFocus style={{ width: '100%', marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select name="assigned_to" className="input" defaultValue="" style={{ flex: 1 }}>
                  <option value="">Just the list (no one)</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.id === meId ? `${m.name} (you)` : m.name}</option>
                  ))}
                </select>
                <input type="date" name="due_date" className="input" style={{ flex: 1 }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ flex: 2 }}>Add</button>
              </div>
            </form>
          )}
        </div>
      )}

      {open.length === 0 && (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', marginBottom: 14 }}>
          {isAdmin ? 'Nothing on the list. Enjoy it while it lasts.' : 'Nothing assigned to you right now.'}
        </div>
      )}

      {open.map((t) => (
        <div key={t.id} className="card" style={{ padding: '11px 12px', marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <form action={toggleTodoDone} style={{ display: 'flex', marginTop: 1 }}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="done" value="true" />
            <button
              type="submit"
              aria-label={`Mark "${t.title}" done`}
              style={{ width: 22, height: 22, borderRadius: 6, border: '2px solid var(--forest)', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
            />
          </form>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600, lineHeight: 1.35 }}>{t.title}</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 3, flexWrap: 'wrap' }}>
              {t.due_date && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: overdue(t) ? 'var(--amber)' : 'var(--muted)', fontWeight: overdue(t) ? 700 : 400 }}>
                  <CalendarDays size={12} /> {fmtDateShort(t.due_date)}{overdue(t) ? ' · overdue' : ''}
                </span>
              )}
              {t.assigned_to && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--muted)' }}>
                  <User size={12} /> {nameOf(t.assigned_to)}
                </span>
              )}
              {t.notes && <span style={{ fontSize: 11.5, color: 'var(--muted)', fontStyle: 'italic' }}>{t.notes}</span>}
            </div>
            {isAdmin && members.length > 0 && (
              <form action={reassignTodo} style={{ marginTop: 6 }}>
                <input type="hidden" name="id" value={t.id} />
                <select
                  name="assigned_to"
                  className="input"
                  defaultValue={t.assigned_to ?? ''}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  style={{ fontSize: 11.5, padding: '4px 8px', width: 'auto' }}
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.id === meId ? `${m.name} (you)` : m.name}</option>
                  ))}
                </select>
              </form>
            )}
          </div>
          {isAdmin && (
            <form action={deleteTodo}>
              <input type="hidden" name="id" value={t.id} />
              <button type="submit" aria-label="Delete to-do" style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', padding: 4 }}>
                <Trash2 size={15} />
              </button>
            </form>
          )}
        </div>
      ))}

      {done.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button type="button" onClick={() => setShowDone((s) => !s)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 4px', fontSize: 12.5, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Done ({done.length}) {showDone ? '▾' : '▸'}
          </button>
          {showDone && done.map((t) => (
            <div key={t.id} className="card" style={{ padding: '10px 12px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10, opacity: 0.65 }}>
              <form action={toggleTodoDone} style={{ display: 'flex' }}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="done" value="false" />
                <button type="submit" aria-label={`Reopen "${t.title}"`} style={{ width: 20, height: 20, borderRadius: 6, border: 'none', background: 'var(--forest)', color: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: 1, flexShrink: 0 }}>✓</button>
              </form>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--ink-soft)', textDecoration: 'line-through' }}>{t.title}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t.done_at ? fmtDateShort(t.done_at) : ''}{t.done_by ? ` · ${nameOf(t.done_by)}` : ''}</div>
              {isAdmin && (
                <form action={deleteTodo}>
                  <input type="hidden" name="id" value={t.id} />
                  <button type="submit" aria-label="Delete to-do" style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', padding: 2 }}>
                    <Trash2 size={14} />
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
