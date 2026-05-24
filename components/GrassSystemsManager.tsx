'use client';

import { useState, useTransition } from 'react';
import { Pencil, Trash2, Plus, Check, X, Eye, EyeOff, Copy } from 'lucide-react';
import { GrassSystem } from '@/lib/types';
import {
  createGrassSystem,
  updateGrassSystem,
  deleteGrassSystem,
  forkGrassSystem,
  setGrassSystemHidden,
} from '@/lib/actions';

/**
 * Settings → Grass systems manager.
 *
 * Visual hierarchy:
 *   1. Library (shared seeds, user_id = null) — read-only, with a "Customise"
 *      button that forks the system into a user-owned copy.
 *   2. Custom (user-owned) — editable inline + deletable.
 *
 * Each row has a visibility eye toggle that adds/removes the id from the
 * user's settings.hiddenGrassSystemIds list. Hidden systems don't appear in
 * the field-form dropdown but stay visible here so the user can re-show them.
 *
 * Editing knobs (custom rows only):
 *   - name, short_label, description
 *   - n_cap_kg_per_ha (0-1000)
 *   - n_target_multiplier (0.01-2)
 *   - k_multiplier (0.01-2)
 *   - is_legume_rich (boolean — drives clover-suppression flag)
 */
export function GrassSystemsManager({
  grassSystems,
  hiddenIds,
}: {
  grassSystems: GrassSystem[];
  hiddenIds: string[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const hiddenSet = new Set(hiddenIds);
  const sharedRows = grassSystems.filter((s) => s.user_id === null);
  const userRows = grassSystems.filter((s) => s.user_id !== null);

  function toggleVisibility(id: string, currentlyHidden: boolean) {
    setError(null);
    const fd = new FormData();
    fd.set('system_id', id);
    fd.set('hidden', currentlyHidden ? 'false' : 'true');
    startTransition(async () => {
      try {
        await setGrassSystemHidden(fd);
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      }
    });
  }

  function handleFork(id: string) {
    setError(null);
    const fd = new FormData();
    fd.set('source_id', id);
    startTransition(async () => {
      try {
        const result = await forkGrassSystem(fd);
        // Open the new row for editing straight away.
        setEditingId(result.id);
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      }
    });
  }

  function handleDelete(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setError(null);
      return;
    }
    const fd = new FormData();
    fd.set('id', id);
    startTransition(async () => {
      try {
        await deleteGrassSystem(fd);
        setConfirmDeleteId(null);
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      }
    });
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        Grass systems drive nitrogen caps, target multipliers and potash
        multipliers per field. Tap the eye to hide systems you don&apos;t use
        from the field-form dropdown. Tap the pencil on a custom system to
        edit its values; use &ldquo;Customise&rdquo; on a shared system to make
        an editable copy.
      </div>

      {error && (
        <div style={{
          padding: 10, marginBottom: 12, borderRadius: 4,
          background: 'var(--red-soft, #f5dcd2)', color: 'var(--red, #b85b3a)',
          fontSize: 12,
        }}>
          {error}
        </div>
      )}

      {/* Add custom */}
      {!showCreate ? (
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setShowCreate(true)}
          style={{ width: '100%', padding: '12px 14px', fontSize: 13, marginBottom: 14,
                   display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <Plus size={16} /> Add a custom grass system
        </button>
      ) : (
        <CreateForm
          onCancel={() => setShowCreate(false)}
          onError={setError}
          isPending={isPending}
          startTransition={startTransition}
        />
      )}

      {/* Library section */}
      <SectionHeading label="Library (shared)" />
      {sharedRows.length === 0 ? (
        <div className="card" style={{ padding: 14, fontSize: 13, color: 'var(--muted)' }}>
          No shared systems available.
        </div>
      ) : (
        sharedRows.map((s) => (
          <SystemRow
            key={s.id}
            system={s}
            hidden={hiddenSet.has(s.id)}
            editable={false}
            editing={editingId === s.id}
            confirmingDelete={confirmDeleteId === s.id}
            isPending={isPending}
            onVisibilityToggle={() => toggleVisibility(s.id, hiddenSet.has(s.id))}
            onFork={() => handleFork(s.id)}
            onEditStart={() => { /* shared rows aren't editable */ }}
            onEditCancel={() => setEditingId(null)}
            onEditError={setError}
            onDelete={() => { /* shared rows can't be deleted */ }}
            startTransition={startTransition}
          />
        ))
      )}

      {/* User-owned section */}
      <SectionHeading label="Your custom systems" />
      {userRows.length === 0 ? (
        <div className="card" style={{ padding: 14, fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
          No custom systems yet. Use &ldquo;Customise&rdquo; on a shared row to fork one, or add a new one above.
        </div>
      ) : (
        userRows.map((s) => (
          <SystemRow
            key={s.id}
            system={s}
            hidden={hiddenSet.has(s.id)}
            editable={true}
            editing={editingId === s.id}
            confirmingDelete={confirmDeleteId === s.id}
            isPending={isPending}
            onVisibilityToggle={() => toggleVisibility(s.id, hiddenSet.has(s.id))}
            onFork={() => { /* user-owned doesn't fork */ }}
            onEditStart={() => { setEditingId(s.id); setConfirmDeleteId(null); }}
            onEditCancel={() => setEditingId(null)}
            onEditError={setError}
            onDelete={() => handleDelete(s.id)}
            onDeleteCancel={() => setConfirmDeleteId(null)}
            startTransition={startTransition}
          />
        ))
      )}
    </div>
  );
}

function SectionHeading({ label }: { label: string }) {
  return (
    <div style={{
      marginTop: 14, marginBottom: 8, paddingLeft: 2,
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.06em', color: 'var(--muted)',
    }}>
      {label}
    </div>
  );
}

function SystemRow({
  system, hidden, editable, editing, confirmingDelete, isPending,
  onVisibilityToggle, onFork, onEditStart, onEditCancel, onEditError,
  onDelete, onDeleteCancel, startTransition,
}: {
  system: GrassSystem;
  hidden: boolean;
  editable: boolean;
  editing: boolean;
  confirmingDelete: boolean;
  isPending: boolean;
  onVisibilityToggle: () => void;
  onFork: () => void;
  onEditStart: () => void;
  onEditCancel: () => void;
  onEditError: (e: string | null) => void;
  onDelete: () => void;
  onDeleteCancel?: () => void;
  startTransition: (cb: () => void) => void;
}) {
  if (editing && editable) {
    return (
      <EditForm
        system={system}
        onCancel={onEditCancel}
        onError={onEditError}
        isPending={isPending}
        startTransition={startTransition}
      />
    );
  }

  return (
    <div
      className="card"
      style={{
        padding: 12, marginBottom: 8,
        opacity: hidden ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{system.name}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            N cap {system.n_cap_kg_per_ha} · N×{Number(system.n_target_multiplier).toFixed(2)} · K×{Number(system.k_multiplier).toFixed(2)}
            {system.is_legume_rich && <> · legume-rich</>}
          </div>
          {system.description && (
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4, lineHeight: 1.4 }}>
              {system.description}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
          {/* Visibility toggle */}
          <button
            type="button"
            onClick={onVisibilityToggle}
            disabled={isPending}
            aria-label={hidden ? 'Show in dropdown' : 'Hide from dropdown'}
            className="btn-ghost"
            style={{ padding: '6px 8px', display: 'inline-flex' }}
          >
            {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>

          {/* Edit or Fork */}
          {editable ? (
            confirmingDelete ? (
              <>
                <span style={{ fontSize: 10, color: 'var(--red, #b85b3a)', textAlign: 'center' }}>
                  Sure?
                </span>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={isPending}
                  aria-label="Confirm delete"
                  className="btn-ghost"
                  style={{ padding: '6px 8px', display: 'inline-flex', color: 'var(--red, #b85b3a)' }}
                >
                  <Check size={14} />
                </button>
                <button
                  type="button"
                  onClick={onDeleteCancel}
                  aria-label="Cancel delete"
                  className="btn-ghost"
                  style={{ padding: '6px 8px', display: 'inline-flex' }}
                >
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onEditStart}
                  disabled={isPending}
                  aria-label="Edit"
                  className="btn-ghost"
                  style={{ padding: '6px 8px', display: 'inline-flex' }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={isPending}
                  aria-label="Delete"
                  className="btn-ghost"
                  style={{ padding: '6px 8px', display: 'inline-flex', color: 'var(--red, #b85b3a)' }}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )
          ) : (
            <button
              type="button"
              onClick={onFork}
              disabled={isPending}
              aria-label="Customise as new"
              title="Customise as new"
              className="btn-ghost"
              style={{ padding: '6px 8px', display: 'inline-flex' }}
            >
              <Copy size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Edit form (for user-owned rows) -----------------------------

function EditForm({
  system, onCancel, onError, isPending, startTransition,
}: {
  system: GrassSystem;
  onCancel: () => void;
  onError: (e: string | null) => void;
  isPending: boolean;
  startTransition: (cb: () => void) => void;
}) {
  const [name, setName] = useState(system.name);
  const [shortLabel, setShortLabel] = useState(system.short_label);
  const [description, setDescription] = useState(system.description ?? '');
  const [nCap, setNCap] = useState(String(system.n_cap_kg_per_ha));
  const [nMult, setNMult] = useState(String(system.n_target_multiplier));
  const [kMult, setKMult] = useState(String(system.k_multiplier));
  const [isLegume, setIsLegume] = useState(system.is_legume_rich);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    const fd = new FormData();
    fd.set('id', system.id);
    fd.set('name', name);
    fd.set('short_label', shortLabel);
    fd.set('description', description);
    fd.set('n_cap_kg_per_ha', nCap);
    fd.set('n_target_multiplier', nMult);
    fd.set('k_multiplier', kMult);
    if (isLegume) fd.set('is_legume_rich', 'on');
    startTransition(async () => {
      try {
        await updateGrassSystem(fd);
        onCancel();
      } catch (err) {
        if (err instanceof Error) onError(err.message);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ padding: 14, marginBottom: 8 }}>
      <FormBody
        name={name} setName={setName}
        shortLabel={shortLabel} setShortLabel={setShortLabel}
        description={description} setDescription={setDescription}
        nCap={nCap} setNCap={setNCap}
        nMult={nMult} setNMult={setNMult}
        kMult={kMult} setKMult={setKMult}
        isLegume={isLegume} setIsLegume={setIsLegume}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={isPending} style={{ flex: 1, padding: 10 }}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={isPending} style={{ flex: 1, padding: 10 }}>
          {isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

// ---- Create form (new custom) ------------------------------------

function CreateForm({
  onCancel, onError, isPending, startTransition,
}: {
  onCancel: () => void;
  onError: (e: string | null) => void;
  isPending: boolean;
  startTransition: (cb: () => void) => void;
}) {
  const [name, setName] = useState('');
  const [shortLabel, setShortLabel] = useState('');
  const [description, setDescription] = useState('');
  const [nCap, setNCap] = useState('250');
  const [nMult, setNMult] = useState('1.00');
  const [kMult, setKMult] = useState('1.00');
  const [isLegume, setIsLegume] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    const fd = new FormData();
    fd.set('name', name);
    fd.set('short_label', shortLabel || name);
    fd.set('description', description);
    fd.set('n_cap_kg_per_ha', nCap);
    fd.set('n_target_multiplier', nMult);
    fd.set('k_multiplier', kMult);
    if (isLegume) fd.set('is_legume_rich', 'on');
    startTransition(async () => {
      try {
        await createGrassSystem(fd);
        onCancel();
      } catch (err) {
        if (err instanceof Error) onError(err.message);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ padding: 14, marginBottom: 14 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 8,
      }}>
        New custom grass system
      </div>
      <FormBody
        name={name} setName={setName}
        shortLabel={shortLabel} setShortLabel={setShortLabel}
        description={description} setDescription={setDescription}
        nCap={nCap} setNCap={setNCap}
        nMult={nMult} setNMult={setNMult}
        kMult={kMult} setKMult={setKMult}
        isLegume={isLegume} setIsLegume={setIsLegume}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={isPending} style={{ flex: 1, padding: 10 }}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn-primary"
          disabled={isPending || !name.trim()}
          style={{ flex: 1, padding: 10 }}
        >
          {isPending ? 'Adding…' : 'Add'}
        </button>
      </div>
    </form>
  );
}

// ---- Shared form body --------------------------------------------

function FormBody({
  name, setName,
  shortLabel, setShortLabel,
  description, setDescription,
  nCap, setNCap,
  nMult, setNMult,
  kMult, setKMult,
  isLegume, setIsLegume,
}: {
  name: string; setName: (s: string) => void;
  shortLabel: string; setShortLabel: (s: string) => void;
  description: string; setDescription: (s: string) => void;
  nCap: string; setNCap: (s: string) => void;
  nMult: string; setNMult: (s: string) => void;
  kMult: string; setKMult: (s: string) => void;
  isLegume: boolean; setIsLegume: (b: boolean) => void;
}) {
  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <div className="label" style={{ marginBottom: 4, fontSize: 11 }}>Name</div>
        <input
          type="text"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="e.g. Lucerne ley"
        />
      </div>
      <div style={{ marginBottom: 10 }}>
        <div className="label" style={{ marginBottom: 4, fontSize: 11 }}>Short label (for cards/chips)</div>
        <input
          type="text"
          className="input"
          value={shortLabel}
          onChange={(e) => setShortLabel(e.target.value)}
          maxLength={40}
          placeholder="e.g. Lucerne"
        />
      </div>
      <div style={{ marginBottom: 10 }}>
        <div className="label" style={{ marginBottom: 4, fontSize: 11 }}>Description (optional)</div>
        <textarea
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          style={{ width: '100%', resize: 'vertical' }}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div>
          <div className="label" style={{ marginBottom: 4, fontSize: 11 }}>N cap (kg/ha)</div>
          <input
            type="number" inputMode="numeric" min="0" max="1000" step="1"
            className="input"
            value={nCap}
            onChange={(e) => setNCap(e.target.value)}
          />
        </div>
        <div>
          <div className="label" style={{ marginBottom: 4, fontSize: 11 }}>N target ×</div>
          <input
            type="number" inputMode="decimal" min="0.01" max="2" step="0.05"
            className="input"
            value={nMult}
            onChange={(e) => setNMult(e.target.value)}
          />
        </div>
        <div>
          <div className="label" style={{ marginBottom: 4, fontSize: 11 }}>K ×</div>
          <input
            type="number" inputMode="decimal" min="0.01" max="2" step="0.05"
            className="input"
            value={kMult}
            onChange={(e) => setKMult(e.target.value)}
          />
        </div>
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={isLegume}
          onChange={(e) => setIsLegume(e.target.checked)}
          style={{ width: 16, height: 16 }}
        />
        <span style={{ color: 'var(--ink)' }}>Legume-rich (clover-suppression advisory)</span>
      </label>
    </>
  );
}
