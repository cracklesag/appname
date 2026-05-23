'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { Field, Group } from '@/lib/types';
import { setGroupMembership } from '@/lib/actions';
import { fmt } from '@/lib/rules';

/**
 * Bulk-edit which fields belong to a group.
 *
 * Initial state: every field currently in this group is pre-ticked.
 * The user toggles checkboxes freely. Save commits the whole new set in
 * one round-trip via setGroupMembership.
 *
 * For fields that are currently in a *different* group, we show a small
 * badge so the user knows ticking will move them. Visible safety net, no
 * confirm dialog.
 *
 * Save is disabled when no changes have been made — a small "X added, Y
 * removed" hint appears once changes exist so the user can see the diff
 * before committing.
 */
export function GroupMembershipEditor({
  group,
  fields,
  groups,
}: {
  group: Group;
  fields: Field[];
  groups: Group[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Initial membership — fields whose group_id matches this group.
  const initialMemberIds = useMemo(
    () => new Set(fields.filter((f) => f.group_id === group.id).map((f) => f.id)),
    [fields, group.id],
  );

  // Local selection state — Set for O(1) toggles.
  const [selected, setSelected] = useState<Set<string>>(initialMemberIds);

  // Sorted field list: members of this group first (alphabetical), then
  // everything else (alphabetical). Keeps the "what's currently in here"
  // grouped together visually while still showing the full list.
  const sortedFields = useMemo(() => {
    const sorted = [...fields].sort((a, b) => a.name.localeCompare(b.name));
    const inGroup = sorted.filter((f) => initialMemberIds.has(f.id));
    const notInGroup = sorted.filter((f) => !initialMemberIds.has(f.id));
    return [...inGroup, ...notInGroup];
  }, [fields, initialMemberIds]);

  // Diff for the hint + Save enable.
  const { added, removed, hasChanges } = useMemo(() => {
    let added = 0, removed = 0;
    for (const id of selected) if (!initialMemberIds.has(id)) added++;
    for (const id of initialMemberIds) if (!selected.has(id)) removed++;
    return { added, removed, hasChanges: added > 0 || removed > 0 };
  }, [selected, initialMemberIds]);

  // Group name lookup for the "currently in X" badges.
  const groupNameById = useMemo(
    () => new Map(groups.map((g) => [g.id, g.name])),
    [groups],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSave() {
    setError(null);
    const fd = new FormData();
    fd.set('group_id', group.id);
    fd.set('field_ids', Array.from(selected).join(','));
    startTransition(async () => {
      try {
        await setGroupMembership(fd);
        // Navigate back to the group list — done.
        router.push('/settings/groups');
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      }
    });
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        Tick the fields that belong to <strong style={{ color: 'var(--ink)' }}>{group.name}</strong>.
        Unticking removes them from this group (they don&apos;t get deleted).
        Ticking a field that&apos;s in another group will move it here.
      </div>

      {/* Counter + change hint */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--muted)',
          marginBottom: 12,
          padding: 10,
          background: 'var(--paper-deep, #f4ede1)',
          borderRadius: 4,
        }}
      >
        <div>
          <strong style={{ color: 'var(--ink)' }}>{selected.size}</strong> of {fields.length} fields ticked
        </div>
        {hasChanges && (
          <div style={{ marginTop: 4 }}>
            Changes pending:
            {added > 0 && <> <strong style={{ color: 'var(--ink)' }}>+{added}</strong> to add</>}
            {added > 0 && removed > 0 && ','}
            {removed > 0 && <> <strong style={{ color: 'var(--ink)' }}>−{removed}</strong> to remove</>}
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: 10, marginBottom: 12, borderRadius: 4,
            background: 'var(--red-soft, #f5dcd2)', color: 'var(--red, #b85b3a)',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Field list */}
      {fields.length === 0 ? (
        <div className="card" style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          You don&apos;t have any fields yet.
        </div>
      ) : (
        sortedFields.map((f) => {
          const isSelected = selected.has(f.id);
          const otherGroupName = f.group_id && f.group_id !== group.id
            ? groupNameById.get(f.group_id)
            : null;
          return (
            <label
              key={f.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 10px',
                marginBottom: 6,
                background: 'var(--card)',
                border: '1px solid var(--line)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggle(f.id)}
                disabled={isPending}
                style={{ width: 18, height: 18, flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                  {f.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {(() => {
                    // Mirror the rest of the app — show area in either ac or
                    // ha depending on the field's stored values. We don't
                    // have settings here, so default to ha (smaller number,
                    // less likely to confuse).
                    return `${fmt(f.ha, 1)} ha`;
                  })()}
                  {otherGroupName && (
                    <span style={{ color: 'var(--amber, #b88a3a)', marginLeft: 8 }}>
                      currently in {otherGroupName}
                    </span>
                  )}
                </div>
              </div>
            </label>
          );
        })
      )}

      {/* Save / Cancel sticky footer */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          padding: '14px 0 0',
          background: 'linear-gradient(to top, var(--paper) 60%, transparent)',
        }}
      >
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => router.push('/settings/groups')}
            disabled={isPending}
            style={{ flex: 1, padding: '12px 14px', fontSize: 14 }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={!hasChanges || isPending}
            style={{
              flex: 2,
              padding: '12px 14px',
              fontSize: 14,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              opacity: !hasChanges ? 0.5 : 1,
            }}
          >
            <Save size={16} />
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
