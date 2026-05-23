'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ChevronUp, ChevronDown, ChevronRight, Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import { Group } from '@/lib/types';
import {
  createGroup,
  renameGroup,
  deleteGroup,
  moveGroup,
} from '@/lib/actions';

/**
 * Settings → Groups management screen.
 *
 * - Create groups via the top form
 * - Rename inline (click pencil, type, ✓ confirms)
 * - Delete with confirm step (click trash, confirm by clicking again)
 * - Reorder via up/down chevrons (mobile-friendly alternative to drag-and-drop)
 *
 * All actions go through server actions; the page refetches via revalidate.
 * useTransition keeps the UI responsive (and shows a subtle "saving…" hint
 * during in-flight requests).
 */
export function GroupsManager({
  groups,
  fieldCountByGroup,
  ungroupedCount,
}: {
  groups: Group[];
  fieldCountByGroup: Record<string, number>;
  ungroupedCount: number;
}) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const trimmed = newName.trim();
    if (!trimmed) return;
    const fd = new FormData();
    fd.set('name', trimmed);
    startTransition(async () => {
      try {
        await createGroup(fd);
        setNewName('');
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      }
    });
  }

  function startRename(group: Group) {
    setEditingId(group.id);
    setEditingName(group.name);
    setError(null);
    setConfirmDeleteId(null);
  }

  function cancelRename() {
    setEditingId(null);
    setEditingName('');
  }

  function commitRename(group: Group) {
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === group.name) {
      cancelRename();
      return;
    }
    const fd = new FormData();
    fd.set('id', group.id);
    fd.set('name', trimmed);
    startTransition(async () => {
      try {
        await renameGroup(fd);
        setEditingId(null);
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      }
    });
  }

  function handleDelete(group: Group) {
    if (confirmDeleteId !== group.id) {
      // First click: arm the confirm
      setConfirmDeleteId(group.id);
      setError(null);
      return;
    }
    // Second click: actually delete
    const fd = new FormData();
    fd.set('id', group.id);
    startTransition(async () => {
      try {
        await deleteGroup(fd);
        setConfirmDeleteId(null);
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      }
    });
  }

  function handleMove(group: Group, direction: 'up' | 'down') {
    const fd = new FormData();
    fd.set('id', group.id);
    fd.set('direction', direction);
    startTransition(async () => {
      try {
        await moveGroup(fd);
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      }
    });
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        Group fields into named blocks of land — useful for filtering the home dashboard,
        reports and activity. Tap a group to add or remove fields. Deleting a group leaves
        its fields ungrouped, not deleted.
      </div>

      {/* Create */}
      <form onSubmit={handleCreate} className="card" style={{ padding: 12, marginBottom: 14 }}>
        <div className="label" style={{ marginBottom: 6 }}>Add a group</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Top Farm"
            maxLength={80}
            style={{ flex: 1 }}
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={isPending || !newName.trim()}
            style={{ padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </form>

      {error && (
        <div style={{
          padding: 10, marginBottom: 12, borderRadius: 4,
          background: 'var(--red-soft, #f5dcd2)', color: 'var(--red, #b85b3a)',
          fontSize: 12,
        }}>
          {error}
        </div>
      )}

      {/* List */}
      {groups.length === 0 ? (
        <div className="card" style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          No groups yet. Add your first above.
        </div>
      ) : (
        groups.map((g, idx) => {
          const count = fieldCountByGroup[g.id] ?? 0;
          const isFirst = idx === 0;
          const isLast = idx === groups.length - 1;
          const isEditing = editingId === g.id;
          const isConfirmingDelete = confirmDeleteId === g.id;
          return (
            <div
              key={g.id}
              className="card"
              style={{ padding: 10, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}
            >
              {/* Up / Down buttons — hidden on the boundary rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button
                  type="button"
                  onClick={() => handleMove(g, 'up')}
                  disabled={isFirst || isPending}
                  aria-label="Move up"
                  style={{
                    border: 'none', background: 'transparent',
                    color: isFirst ? 'var(--line)' : 'var(--ink-soft)',
                    cursor: isFirst ? 'default' : 'pointer',
                    padding: 2, lineHeight: 0,
                  }}
                >
                  <ChevronUp size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => handleMove(g, 'down')}
                  disabled={isLast || isPending}
                  aria-label="Move down"
                  style={{
                    border: 'none', background: 'transparent',
                    color: isLast ? 'var(--line)' : 'var(--ink-soft)',
                    cursor: isLast ? 'default' : 'pointer',
                    padding: 2, lineHeight: 0,
                  }}
                >
                  <ChevronDown size={16} />
                </button>
              </div>

              {/* Name + count — clickable to open the membership editor */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {isEditing ? (
                  <input
                    type="text"
                    autoFocus
                    className="input"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(g); }
                      if (e.key === 'Escape') cancelRename();
                    }}
                    maxLength={80}
                    style={{ fontSize: 14, fontWeight: 700 }}
                  />
                ) : (
                  <Link
                    href={`/settings/groups/${g.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      textDecoration: 'none',
                      color: 'inherit',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                        {g.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {count} field{count === 1 ? '' : 's'} · tap to manage
                      </div>
                    </div>
                    <ChevronRight size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                  </Link>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 4 }}>
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => commitRename(g)}
                      disabled={isPending}
                      aria-label="Save"
                      className="btn-ghost"
                      style={{ padding: '6px 8px', display: 'inline-flex' }}
                    >
                      <Check size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={cancelRename}
                      aria-label="Cancel"
                      className="btn-ghost"
                      style={{ padding: '6px 8px', display: 'inline-flex' }}
                    >
                      <X size={16} />
                    </button>
                  </>
                ) : isConfirmingDelete ? (
                  <>
                    <span style={{ fontSize: 11, color: 'var(--red, #b85b3a)', alignSelf: 'center', marginRight: 4 }}>
                      Sure?
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(g)}
                      disabled={isPending}
                      aria-label="Confirm delete"
                      className="btn-ghost"
                      style={{
                        padding: '6px 8px',
                        display: 'inline-flex',
                        color: 'var(--red, #b85b3a)',
                      }}
                    >
                      <Check size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      aria-label="Cancel delete"
                      className="btn-ghost"
                      style={{ padding: '6px 8px', display: 'inline-flex' }}
                    >
                      <X size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => startRename(g)}
                      aria-label="Rename"
                      className="btn-ghost"
                      style={{ padding: '6px 8px', display: 'inline-flex' }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(g)}
                      aria-label="Delete"
                      className="btn-ghost"
                      style={{
                        padding: '6px 8px',
                        display: 'inline-flex',
                        color: 'var(--red, #b85b3a)',
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* Ungrouped fields hint at the bottom */}
      {ungroupedCount > 0 && (
        <div style={{
          marginTop: 12, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic',
        }}>
          {ungroupedCount} field{ungroupedCount === 1 ? '' : 's'} not assigned to any group.
        </div>
      )}
    </div>
  );
}
