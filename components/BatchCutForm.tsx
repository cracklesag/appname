'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Save } from 'lucide-react';
import { CutType, Field, Group, NextAction, Settings, YieldClass } from '@/lib/types';
import { CUT_TYPE_LABELS, displayFieldArea, fmt, YIELD_CLASS_LABELS } from '@/lib/rules';
import { saveBatchCuts } from '@/lib/actions';
import { ErrorBanner } from './InlineWarning';

/**
 * Batch cut entry — default-then-tweak pattern.
 *
 *   1. User picks a single date for the whole batch (defaults to today).
 *   2. User picks defaults for cut type, yield class, what's next.
 *   3. User ticks the fields they cut. Each tick gets the defaults applied.
 *   4. User can tap a row to expand it and override any single value.
 *   5. Changing the top-level default RESETS all rows to that value
 *      (overwriting per-row tweaks — confirmed design choice).
 *
 * Fields with all season cuts complete are pre-filtered out by the server
 * page; this component doesn't need to know about them.
 */

const NEXT_ACTION_LABELS: Record<NextAction, string> = {
  another_cut_silage:  'Next cut: silage',
  another_cut_bales:   'Next cut: bales',
  rotational_grazing:  'Rotational grazing',
  maintenance_grazing: 'Maintenance — one fert top-up then leave',
};

/** Pick a sensible smart default for "what's next" based on the field's
 *  cut history. If this cut would be the FINAL one in the profile,
 *  default to maintenance. Otherwise mirror the current cut type. */
function smartDefaultNextAction(
  cutType: CutType,
  cutNumber: number,
  cutProfile: number,
): NextAction {
  const isFinalCut = cutNumber >= cutProfile;
  if (isFinalCut) return 'maintenance_grazing';
  if (cutType === 'grazing') return 'rotational_grazing';
  if (cutType === 'bales')   return 'another_cut_bales';
  return 'another_cut_silage';
}

type Row = {
  field_id: string;
  /** Cut number this batch entry would record for this field (existing
   *  cuts + 1). Auto-computed; not editable by the user. */
  cut_number: number;
  cut_type: CutType;
  yield_class: YieldClass;
  next_action: NextAction;
};

export function BatchCutForm({
  eligibleFields,
  groups,
  settings,
}: {
  eligibleFields: Array<{ field: Field; cutsDoneThisSeason: number }>;
  groups: Group[];
  settings: Settings;
}) {
  const today = new Date().toISOString().slice(0, 10);

  // ---- Top-level defaults ------------------------------------------
  const [cutDate, setCutDate] = useState(today);
  const [defaultCutType, setDefaultCutType] = useState<CutType>('silage');
  const [defaultYieldClass, setDefaultYieldClass] = useState<YieldClass>('average');
  // Default "what's next" — at the top level we pick what to APPLY to
  // newly-ticked rows. The actual per-row value is also smart-defaulted
  // (e.g. final-cut fields override to maintenance), so this top default
  // is a starting point not an absolute.
  const [defaultNextAction, setDefaultNextAction] = useState<NextAction>('another_cut_silage');

  // ---- Group filter (chip row above the picker) --------------------
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const visibleFields = useMemo(() => {
    if (groupFilter === 'all') return eligibleFields;
    if (groupFilter === 'unassigned') {
      return eligibleFields.filter((e) => !e.field.group_id);
    }
    return eligibleFields.filter((e) => e.field.group_id === groupFilter);
  }, [eligibleFields, groupFilter]);

  // ---- Selected rows -----------------------------------------------
  // Keyed by field id so order matches the picker list.
  const [rows, setRows] = useState<Record<string, Row>>({});
  // Expanded row state — only one row open at a time, like an accordion.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Apply a default to all selected rows. Used when the user changes any
  // of the three top-level defaults. Per the design call, we OVERWRITE
  // existing per-row tweaks here (resetting is more predictable than
  // preserving — saves the user from "I changed the default but half my
  // rows didn't update").
  function applyDefaultToAll(updater: (row: Row) => Row) {
    setRows((prev) => {
      const next: Record<string, Row> = {};
      for (const [id, r] of Object.entries(prev)) next[id] = updater(r);
      return next;
    });
  }

  function handleDefaultCutTypeChange(newType: CutType) {
    setDefaultCutType(newType);
    applyDefaultToAll((r) => {
      // Re-derive a sensible next_action for this row using the new cut type.
      const fieldInfo = eligibleFields.find((e) => e.field.id === r.field_id);
      const nextAction = fieldInfo
        ? smartDefaultNextAction(newType, r.cut_number, fieldInfo.field.cut_profile)
        : r.next_action;
      return { ...r, cut_type: newType, next_action: nextAction };
    });
  }

  function handleDefaultYieldChange(newYield: YieldClass) {
    setDefaultYieldClass(newYield);
    applyDefaultToAll((r) => ({ ...r, yield_class: newYield }));
  }

  function handleDefaultNextActionChange(newAction: NextAction) {
    setDefaultNextAction(newAction);
    applyDefaultToAll((r) => ({ ...r, next_action: newAction }));
  }

  function toggleField(fieldId: string, cutsDone: number, cutProfile: number) {
    setRows((prev) => {
      const next = { ...prev };
      if (next[fieldId]) {
        delete next[fieldId];
      } else {
        const cutNumber = cutsDone + 1;
        // Smart per-field default: if this would be the final cut, prefer
        // maintenance over the top-level default. Otherwise use the top
        // default.
        const isFinalCut = cutNumber >= cutProfile;
        const initialNextAction: NextAction = isFinalCut
          ? 'maintenance_grazing'
          : defaultNextAction;
        next[fieldId] = {
          field_id: fieldId,
          cut_number: cutNumber,
          cut_type: defaultCutType,
          yield_class: defaultYieldClass,
          next_action: initialNextAction,
        };
      }
      return next;
    });
  }

  function updateRow(fieldId: string, patch: Partial<Row>) {
    setRows((prev) => {
      if (!prev[fieldId]) return prev;
      return { ...prev, [fieldId]: { ...prev[fieldId], ...patch } };
    });
  }

  // Select / clear all currently-visible (filtered) fields. "All shown"
  // respects the active group filter so you can build a selection one block
  // at a time. Clear only removes the visible ones, leaving picks in other
  // groups intact.
  function selectAllVisible() {
    setRows((prev) => {
      const next = { ...prev };
      for (const e of visibleFields) {
        const f = e.field;
        if (next[f.id]) continue;
        const cutNumber = e.cutsDoneThisSeason + 1;
        const isFinalCut = cutNumber >= f.cut_profile;
        next[f.id] = {
          field_id: f.id,
          cut_number: cutNumber,
          cut_type: defaultCutType,
          yield_class: defaultYieldClass,
          next_action: isFinalCut ? 'maintenance_grazing' : defaultNextAction,
        };
      }
      return next;
    });
  }
  function clearAllVisible() {
    setRows((prev) => {
      const next = { ...prev };
      for (const e of visibleFields) delete next[e.field.id];
      return next;
    });
  }

  // ---- Save flow ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedCount = Object.keys(rows).length;
  const canSave = selectedCount > 0 && !!cutDate && !isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set('cut_date', cutDate);
    fd.set('rows', JSON.stringify(Object.values(rows)));
    startTransition(async () => {
      try {
        await saveBatchCuts(fd);
      } catch (err) {
        if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) {
          setError(err.message);
        }
      }
    });
  }

  // ---- Group filter options ----------------------------------------
  const groupFilterOptions: { value: string; label: string }[] = (() => {
    const anyUngrouped = eligibleFields.some((e) => !e.field.group_id);
    return [
      { value: 'all', label: 'All groups' },
      ...groups.map((g) => ({ value: g.id, label: g.name })),
      ...(anyUngrouped ? [{ value: 'unassigned', label: 'Ungrouped' }] : []),
    ];
  })();

  // ---- Render ------------------------------------------------------

  return (
    <form onSubmit={handleSubmit} style={{ paddingBottom: 100 }}>
      <div style={{ padding: 16 }}>
        {/* Header card with summary count */}
        <div className="card" style={{
          padding: 12, marginBottom: 14, background: 'var(--amber-soft)',
          borderColor: 'var(--amber)',
        }}>
          <div style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Batch cut
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 4 }}>
            Pick the date, set defaults, tick the fields you cut. Tap a row to override any value.
          </div>
        </div>

        {/* Date — one for the whole batch */}
        <div style={{ marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Cut date</div>
          <input
            type="date"
            className="input"
            value={cutDate}
            onChange={(e) => setCutDate(e.target.value)}
            max={today}
            required
          />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>
            Same date applies to every row. Use a separate batch for a different day.
          </div>
        </div>

        {/* Defaults card */}
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 10 }}>
            Defaults
          </div>

          {/* Default cut type */}
          <div style={{ marginBottom: 12 }}>
            <div className="label" style={{ marginBottom: 6, fontSize: 12 }}>Cut type</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['silage', 'bales', 'grazing'] as CutType[]).map((key) => {
                const isActive = key === defaultCutType;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleDefaultCutTypeChange(key)}
                    style={{
                      flex: 1,
                      padding: '10px 8px',
                      border: `1px solid ${isActive ? 'var(--forest)' : 'var(--line)'}`,
                      borderRadius: 4,
                      background: isActive ? 'var(--forest-soft)' : 'var(--card)',
                      color: isActive ? 'var(--forest-dark)' : 'var(--ink-soft)',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {CUT_TYPE_LABELS[key]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Default yield class */}
          <div style={{ marginBottom: 12 }}>
            <div className="label" style={{ marginBottom: 6, fontSize: 12 }}>Yield class</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['light', 'average', 'heavy'] as YieldClass[]).map((key) => {
                const isActive = key === defaultYieldClass;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleDefaultYieldChange(key)}
                    style={{
                      flex: 1,
                      padding: '10px 8px',
                      border: `1px solid ${isActive ? 'var(--forest)' : 'var(--line)'}`,
                      borderRadius: 4,
                      background: isActive ? 'var(--forest-soft)' : 'var(--card)',
                      color: isActive ? 'var(--forest-dark)' : 'var(--ink-soft)',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {YIELD_CLASS_LABELS[key]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Default what's next */}
          <div>
            <div className="label" style={{ marginBottom: 6, fontSize: 12 }}>What&apos;s next (default)</div>
            <select
              className="select"
              value={defaultNextAction}
              onChange={(e) => handleDefaultNextActionChange(e.target.value as NextAction)}
              style={{ width: '100%' }}
            >
              {(['another_cut_silage', 'another_cut_bales', 'rotational_grazing', 'maintenance_grazing'] as NextAction[]).map((k) => (
                <option key={k} value={k}>{NEXT_ACTION_LABELS[k]}</option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>
              Applied to newly-ticked rows. Final cuts (last in the field&apos;s profile) auto-switch to maintenance.
            </div>
          </div>
        </div>

        {/* Group filter chip row */}
        {groups.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div className="label" style={{ marginBottom: 6 }}>Group</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {groupFilterOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`toggle-btn ${groupFilter === o.value ? 'active' : ''}`}
                  onClick={() => setGroupFilter(o.value)}
                  style={{ fontSize: 13, padding: '6px 12px' }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Field picker — selectable rows. Tap row body to expand the
            override editor. Tap checkbox to toggle selection. */}
        <div className="card" style={{ padding: 0, marginBottom: 14, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 14px', borderBottom: '1px solid var(--line)',
          }}>
            <div className="label" style={{ margin: 0 }}>Fields</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {visibleFields.length > 0 && (
                <div style={{ display: 'inline-flex', gap: 10 }}>
                  <button type="button" onClick={selectAllVisible} style={{ background: 'none', border: 'none', color: 'var(--forest-dark)', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                    All{groupFilter !== 'all' ? ' shown' : ''}
                  </button>
                  <button type="button" onClick={clearAllVisible} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                    None
                  </button>
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {visibleFields.length === 0
                  ? 'No fields available'
                  : `${selectedCount} of ${visibleFields.length} selected`}
              </div>
            </div>
          </div>
          {visibleFields.length === 0 ? (
            <div style={{ padding: 14, fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
              {eligibleFields.length === 0
                ? 'Every field has already had its full cut profile this season. Use the single-field cut log if you genuinely need to record another cut.'
                : 'No fields in this group with cuts remaining.'}
            </div>
          ) : (
            visibleFields.map((e) => {
              const f = e.field;
              const row = rows[f.id];
              const isSelected = !!row;
              const isExpanded = expandedId === f.id;
              const area = displayFieldArea(f, settings.unitSystem);
              const cutNumberPreview = e.cutsDoneThisSeason + 1;
              return (
                <div
                  key={f.id}
                  style={{
                    borderBottom: '1px solid var(--line)',
                    background: isSelected ? 'var(--forest-soft, #f0f4ea)' : 'transparent',
                  }}
                >
                  {/* Row header — checkbox + name + summary */}
                  <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleField(f.id, e.cutsDoneThisSeason, f.cut_profile)}
                      style={{ width: 18, height: 18, flexShrink: 0, cursor: 'pointer' }}
                    />
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : (isSelected ? f.id : null))}
                      disabled={!isSelected}
                      style={{
                        flex: 1, minWidth: 0, textAlign: 'left',
                        background: 'transparent', border: 'none', padding: 0,
                        cursor: isSelected ? 'pointer' : 'default',
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{f.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {fmt(area.value, 1)} {area.unit}
                        {' · cut '}{cutNumberPreview}{' of '}{f.cut_profile}
                        {row && (
                          <>
                            {' · '}{CUT_TYPE_LABELS[row.cut_type]}
                            {' · '}{YIELD_CLASS_LABELS[row.yield_class]}
                            {' · '}{NEXT_ACTION_LABELS[row.next_action]}
                          </>
                        )}
                      </div>
                    </button>
                    {isSelected && (
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : f.id)}
                        className="btn-ghost"
                        style={{ padding: '4px 6px', display: 'inline-flex', flexShrink: 0 }}
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    )}
                  </div>

                  {/* Expanded per-row override editor */}
                  {isSelected && isExpanded && row && (
                    <div style={{ padding: '0 14px 12px 42px', borderTop: '1px dashed var(--line)' }}>
                      {/* Cut type */}
                      <div style={{ marginTop: 10 }}>
                        <div className="label" style={{ marginBottom: 4, fontSize: 11 }}>Cut type</div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {(['silage', 'bales', 'grazing'] as CutType[]).map((key) => {
                            const isActive = key === row.cut_type;
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => updateRow(f.id, { cut_type: key })}
                                style={{
                                  flex: 1,
                                  padding: '6px 4px',
                                  border: `1px solid ${isActive ? 'var(--forest)' : 'var(--line)'}`,
                                  borderRadius: 4,
                                  background: isActive ? 'var(--forest-soft)' : 'var(--card)',
                                  color: isActive ? 'var(--forest-dark)' : 'var(--ink-soft)',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                {CUT_TYPE_LABELS[key]}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Yield class */}
                      <div style={{ marginTop: 10 }}>
                        <div className="label" style={{ marginBottom: 4, fontSize: 11 }}>Yield class</div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {(['light', 'average', 'heavy'] as YieldClass[]).map((key) => {
                            const isActive = key === row.yield_class;
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => updateRow(f.id, { yield_class: key })}
                                style={{
                                  flex: 1,
                                  padding: '6px 4px',
                                  border: `1px solid ${isActive ? 'var(--forest)' : 'var(--line)'}`,
                                  borderRadius: 4,
                                  background: isActive ? 'var(--forest-soft)' : 'var(--card)',
                                  color: isActive ? 'var(--forest-dark)' : 'var(--ink-soft)',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                              >
                                {YIELD_CLASS_LABELS[key]}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* What's next */}
                      <div style={{ marginTop: 10 }}>
                        <div className="label" style={{ marginBottom: 4, fontSize: 11 }}>What&apos;s next</div>
                        <select
                          className="select"
                          value={row.next_action}
                          onChange={(e) => updateRow(f.id, { next_action: e.target.value as NextAction })}
                          style={{ width: '100%', fontSize: 12 }}
                        >
                          {(['another_cut_silage', 'another_cut_bales', 'rotational_grazing', 'maintenance_grazing'] as NextAction[]).map((k) => (
                            <option key={k} value={k}>{NEXT_ACTION_LABELS[k]}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: '0 16px 16px', background: 'linear-gradient(to top, var(--paper) 70%, transparent)' }}>
        <ErrorBanner error={error} />
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/activity" className="btn-ghost" style={{ flex: 1, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', padding: 12 }}>
            Cancel
          </Link>
          <button
            type="submit"
            className="btn-primary"
            disabled={!canSave}
            style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12 }}
          >
            <Save size={18} />
            {isPending
              ? 'Saving…'
              : selectedCount === 0
                ? 'Pick fields to save'
                : `Save ${selectedCount} cut${selectedCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </form>
  );
}
