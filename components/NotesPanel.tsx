'use client';

import { useState } from 'react';
import { Plus, Pin, PinOff, Trash2, Pencil } from 'lucide-react';
import { saveNote, deleteNote, toggleNotePin } from '@/lib/actions';
import { fmtDate } from '@/lib/rules';
import type { FarmNote } from '@/lib/types';

/** Freeform farm notes — admin only. Pinned notes float to the top. */
export function NotesPanel({ notes }: { notes: FarmNote[] }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        {!adding ? (
          <button type="button" className="btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={() => setAdding(true)}>
            <Plus size={16} /> New note
          </button>
        ) : (
          <form action={async (fd) => { await saveNote(fd); setAdding(false); }}>
            <textarea name="body" className="input" rows={4} maxLength={8000} placeholder="Write it down before it's gone…" required autoFocus style={{ width: '100%', marginBottom: 8, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={() => setAdding(false)}>Cancel</button>
              <button type="submit" className="btn-primary" style={{ flex: 2 }}>Save note</button>
            </div>
          </form>
        )}
      </div>

      {notes.length === 0 && (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
          No notes yet.
        </div>
      )}

      {notes.map((n) => (
        <div key={n.id} className="card" style={{ padding: 12, marginBottom: 8, ...(n.pinned ? { borderColor: 'var(--forest)' } : {}) }}>
          {editingId === n.id ? (
            <form action={async (fd) => { await saveNote(fd); setEditingId(null); }}>
              <input type="hidden" name="id" value={n.id} />
              <input type="hidden" name="pinned" value={String(n.pinned)} />
              <textarea name="body" className="input" rows={4} maxLength={8000} defaultValue={n.body} required autoFocus style={{ width: '100%', marginBottom: 8, resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={() => setEditingId(null)}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ flex: 2 }}>Save</button>
              </div>
            </form>
          ) : (
            <>
              <div style={{ fontSize: 13.5, color: 'var(--ink)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{n.body}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line-soft)' }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>
                  {n.pinned ? 'Pinned · ' : ''}{fmtDate(n.updated_at.slice(0, 10))}
                </span>
                <form action={toggleNotePin} style={{ display: 'flex' }}>
                  <input type="hidden" name="id" value={n.id} />
                  <input type="hidden" name="pinned" value={String(!n.pinned)} />
                  <button type="submit" aria-label={n.pinned ? 'Unpin note' : 'Pin note'} style={{ border: 'none', background: 'transparent', color: n.pinned ? 'var(--forest)' : 'var(--muted)', cursor: 'pointer', padding: 4 }}>
                    {n.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                  </button>
                </form>
                <button type="button" aria-label="Edit note" onClick={() => setEditingId(n.id)} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', padding: 4 }}>
                  <Pencil size={14} />
                </button>
                <form action={deleteNote} style={{ display: 'flex' }}>
                  <input type="hidden" name="id" value={n.id} />
                  <button type="submit" aria-label="Delete note" style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', padding: 4 }}>
                    <Trash2 size={14} />
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
