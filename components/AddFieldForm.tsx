'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Save, Plus, X } from 'lucide-react';
import { CutType, GrassSystem, Group, SoilType } from '@/lib/types';
import { CUT_TYPE_LABELS, SOIL_TYPE_LABELS } from '@/lib/rules';
import { createField, createGroup } from '@/lib/actions';
import { validateAcres, validateHa } from '@/lib/validation';
import { InlineWarning, ErrorBanner } from './InlineWarning';

// Conversion: 1 ha = 2.4711 acres
const ACRES_PER_HA = 2.4711;

export function AddFieldForm({
  unitSystem,
  groups: initialGroups,
  grassSystems,
  hiddenGrassSystemIds,
}: {
  unitSystem: 'acres' | 'hectares';
  groups: Group[];
  grassSystems: GrassSystem[];
  /** IDs the user has hidden from their dropdown (settings). */
  hiddenGrassSystemIds: string[];
}) {
  const [name, setName] = useState('');
  // Size input is in the user's preferred system; the other side is derived
  const [size, setSize] = useState('');
  const [cutProfile, setCutProfile] = useState<number>(2);
  const [plannedCuts, setPlannedCuts] = useState<CutType[]>(['silage', 'silage']);
  const [soilType, setSoilType] = useState<SoilType>('medium_loam');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Grass system state — default to the perennial_ryegrass seed if present,
  // else the first visible system, else empty (server action will fill in
  // the PRG default if it can).
  const visibleGrassSystems = useMemo(() => {
    const hidden = new Set(hiddenGrassSystemIds);
    return grassSystems.filter((s) => !hidden.has(s.id));
  }, [grassSystems, hiddenGrassSystemIds]);
  const initialGrassSystemId = useMemo(() => {
    const prg = grassSystems.find((s) => s.seed_key === 'perennial_ryegrass');
    if (prg) return prg.id;
    return visibleGrassSystems[0]?.id ?? '';
  }, [grassSystems, visibleGrassSystems]);
  const [grassSystemId, setGrassSystemId] = useState<string>(initialGrassSystemId);

  // Group state — keep groups list local so a newly-created one appears
  // immediately without a page reload.
  const [groups, setGroups] = useState<Group[]>(initialGroups);
  const [groupId, setGroupId] = useState<string>('');  // '' = ungrouped
  // Inline "+ New group" mini-form, hidden until user opens it.
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  // Compute the missing side so the database always has both
  const sizeNum = parseFloat(size);
  const acres = useMemo(() => {
    if (isNaN(sizeNum)) return '';
    return unitSystem === 'acres' ? sizeNum.toFixed(2) : (sizeNum * ACRES_PER_HA).toFixed(2);
  }, [sizeNum, unitSystem]);
  const ha = useMemo(() => {
    if (isNaN(sizeNum)) return '';
    return unitSystem === 'hectares' ? sizeNum.toFixed(2) : (sizeNum / ACRES_PER_HA).toFixed(2);
  }, [sizeNum, unitSystem]);

  // Resize plannedCuts when cut profile changes, preserving existing entries
  useEffect(() => {
    setPlannedCuts((prev) => {
      const arr: CutType[] = Array(cutProfile).fill('silage');
      prev.slice(0, cutProfile).forEach((t, i) => { arr[i] = t; });
      return arr;
    });
  }, [cutProfile]);

  const setCutAt = (index: number, type: CutType) =>
    setPlannedCuts((prev) => prev.map((t, i) => (i === index ? type : t)));

  const acresNum = parseFloat(acres);
  const haNum = parseFloat(ha);
  const acresWarning = useMemo(() => isNaN(acresNum) ? null : validateAcres(acresNum), [acresNum]);
  const haWarning = useMemo(() => isNaN(haNum) ? null : validateHa(haNum), [haNum]);
  const activeWarning = unitSystem === 'acres' ? acresWarning : haWarning;
  const hasHardError = activeWarning?.kind === 'error';

  const canSubmit = name.trim().length > 0 && acresNum > 0 && haNum > 0 && !hasHardError && cutProfile >= 1 && cutProfile <= 4 && !submitting;

  async function handleCreateGroup() {
    setGroupError(null);
    const trimmed = newGroupName.trim();
    if (!trimmed) return;
    setCreatingGroup(true);
    try {
      const fd = new FormData();
      fd.set('name', trimmed);
      const newGroup = await createGroup(fd);
      // Optimistically append to local list and auto-select the new group
      // so the user doesn't have to scroll through the dropdown for it.
      setGroups((prev) => [...prev, {
        id: newGroup.id,
        user_id: '',  // not used in the picker
        name: newGroup.name,
        sort_order: prev.length,
        created_at: new Date().toISOString(),
        management_type: null,
        earliest_fert_md: null,
        low_input: false,
        max_n_kg_per_ha: null,
        nvz: false,
        profile_note: null,
      }]);
      setGroupId(newGroup.id);
      setNewGroupName('');
      setShowNewGroup(false);
    } catch (err) {
      if (err instanceof Error) setGroupError(err.message);
    } finally {
      setCreatingGroup(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      await createField(fd);
      // Server action will redirect on success; if we're still here it's because nothing threw
    } catch (err) {
      // Next.js redirect throws a special object — only show real errors
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) {
        setError(err.message);
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ paddingBottom: 100 }}>
      <input type="hidden" name="acres" value={acres} />
      <input type="hidden" name="ha" value={ha} />
      <input type="hidden" name="cut_profile" value={cutProfile} />
      <input type="hidden" name="group_id" value={groupId} />
      <input type="hidden" name="soil_type" value={soilType} />
      <input type="hidden" name="grass_system_id" value={grassSystemId} />
      {plannedCuts.map((t, i) => (
        <input key={i} type="hidden" name={`cut_${i}`} value={t} />
      ))}

      <div style={{ padding: 16 }}>
        <ErrorBanner error={error} />

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 10 }}>Field details</div>

          <div style={{ marginBottom: 12 }}>
            <div className="label" style={{ fontSize: 11 }}>Field name</div>
            <input
              type="text"
              name="name"
              className="input"
              required
              autoFocus
              maxLength={100}
              placeholder="e.g. Top Meadow"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <div className="label" style={{ fontSize: 11 }}>
              {unitSystem === 'acres' ? 'Acres' : 'Hectares'}
            </div>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              className="input"
              placeholder={unitSystem === 'acres' ? 'e.g. 12.5' : 'e.g. 5.06'}
              value={size}
              onChange={(e) => setSize(e.target.value)}
            />
            <InlineWarning warning={activeWarning} />
            {sizeNum > 0 && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
                {unitSystem === 'acres'
                  ? `≈ ${ha} ha`
                  : `≈ ${acres} ac`}
              </div>
            )}
          </div>

          {/* Group picker */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div className="label" style={{ fontSize: 11 }}>Group (optional)</div>
              {!showNewGroup && (
                <button
                  type="button"
                  onClick={() => { setShowNewGroup(true); setGroupError(null); }}
                  style={{
                    border: 'none', background: 'transparent', padding: 0,
                    color: 'var(--forest-dark, #3d5b29)', fontSize: 12, fontWeight: 700,
                    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3,
                  }}
                >
                  <Plus size={12} /> New
                </button>
              )}
            </div>
            {!showNewGroup ? (
              <select
                className="select"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                style={{ marginTop: 4 }}
              >
                <option value="">— Ungrouped —</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            ) : (
              <div style={{ marginTop: 4 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    className="input"
                    autoFocus
                    placeholder="New group name"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleCreateGroup(); }
                      if (e.key === 'Escape') {
                        setShowNewGroup(false);
                        setNewGroupName('');
                        setGroupError(null);
                      }
                    }}
                    maxLength={80}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={handleCreateGroup}
                    disabled={creatingGroup || !newGroupName.trim()}
                    className="btn-primary"
                    style={{ padding: '0 12px', fontSize: 13 }}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewGroup(false);
                      setNewGroupName('');
                      setGroupError(null);
                    }}
                    className="btn-ghost"
                    style={{ padding: '0 10px' }}
                    aria-label="Cancel"
                  >
                    <X size={16} />
                  </button>
                </div>
                {groupError && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--red, #b85b3a)' }}>
                    {groupError}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Soil type</div>
          <select
            className="select"
            value={soilType}
            onChange={(e) => setSoilType(e.target.value as SoilType)}
          >
            {(Object.entries(SOIL_TYPE_LABELS) as [SoilType, string][]).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
            {soilType === 'light_sand' && 'K target bumped by ~13 kg K₂O/ha per cut. Sulphur risk flag in reports.'}
            {soilType === 'medium_loam' && 'Default — no special adjustments.'}
            {soilType === 'heavy_clay' && 'Cold-clay N timing nudge in early-spring reports.'}
            {soilType === 'deep_silt' && 'Treated as loam — no special adjustments.'}
          </div>
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Grass system</div>
          <select
            className="select"
            value={grassSystemId}
            onChange={(e) => setGrassSystemId(e.target.value)}
          >
            {visibleGrassSystems.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {(() => {
            const selected = grassSystems.find((s) => s.id === grassSystemId);
            if (!selected?.description) return null;
            return (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
                {selected.description}
              </div>
            );
          })()}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            <Link href="/settings/grass-systems" style={{ color: 'var(--forest-dark, #3d5b29)' }}>
              Manage available systems
            </Link>
          </div>
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 10 }}>Number of cuts this season</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[1, 2, 3, 4].map((n) => {
              const isActive = n === cutProfile;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCutProfile(n)}
                  style={{
                    flex: 1,
                    padding: '14px 8px',
                    border: `1px solid ${isActive ? 'var(--forest)' : 'var(--line)'}`,
                    borderRadius: 4,
                    background: isActive ? 'var(--forest-soft)' : 'var(--card)',
                    color: isActive ? 'var(--forest-dark)' : 'var(--ink-soft)',
                    fontSize: 16,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 10 }}>Plan for each cut</div>
          {plannedCuts.map((type, i) => (
            <div key={i} style={{ marginBottom: 14, paddingBottom: i < plannedCuts.length - 1 ? 14 : 0, borderBottom: i < plannedCuts.length - 1 ? '1px solid var(--line-soft)' : 'none' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Cut {i + 1}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['silage', 'bales', 'grazing'] as CutType[]).map((key) => {
                  const isActive = key === type;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setCutAt(i, key)}
                      style={{
                        flex: 1,
                        padding: '10px 6px',
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
          ))}
        </div>

        <div className="card" style={{ padding: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Notes (optional)</div>
          <textarea
            name="notes"
            className="textarea"
            rows={2}
            placeholder="e.g. wet, limited winter access, recently reseeded"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: 16, background: 'linear-gradient(to top, var(--paper) 70%, transparent)', display: 'flex', gap: 10 }}>
        <Link
          href="/"
          className="btn-ghost"
          style={{ flex: 1, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
        >
          Cancel
        </Link>
        <button
          type="submit"
          className="btn-primary"
          style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          disabled={!canSubmit}
        >
          <Save size={18} /> {submitting ? 'Saving…' : 'Add field'}
        </button>
      </div>
    </form>
  );
}
