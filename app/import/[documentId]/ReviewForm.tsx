'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  X,
  Pencil,
  Plus,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Info,
  CheckSquare,
} from 'lucide-react';
import {
  ExtractedSample,
  Field,
  ImportDocument,
  Settings,
  UserDecision,
} from '@/lib/types';
import {
  rankFieldMatches,
  splitComposite,
  isCompositeRef,
  MATCH_THRESHOLD,
  FieldMatchCandidate,
} from '@/lib/fieldMatch';
import { validatePH, validateSoilIndex } from '@/lib/validation';
import { commitDocumentDecisions } from '@/lib/actions';

// =============================================================================
// Types local to this form
// =============================================================================

/**
 * A field-link choice attached to a sample row. Either points to an existing
 * field by id, or describes a new field to create at commit time.
 */
type FieldLink =
  | { kind: 'existing'; field_id: string; field_name: string; suggested_ref?: string; replace_existing?: boolean }
  | { kind: 'new'; temp_id: string; name: string; size: string; skip_size: boolean; suggested_ref?: string };

/**
 * Composite resolution state for a sample's label.
 *
 *   null  — label looks composite ("DOCTORS AND BACK FIELD") but the user
 *           has not yet answered whether it's actually one field or two.
 *           UI shows a single field-link row plus a Yes/No prompt.
 *   false — user said no, or the label was never composite. Treat as one field.
 *           Prompt is hidden, single field-link row.
 *   true  — user said yes (or there were 3+ parts after a manual "+ Add"). Treat
 *           as multi-field with all the chip-mode affordances.
 */
type CompositeState = null | false | true;

/**
 * Per-row state we accumulate during the review session.
 */
interface RowState {
  decision: UserDecision;            // pending / accepted / edited / rejected
  overrides: Record<string, string>; // column → user-typed value (string, parsed on commit)
  links: FieldLink[];                // confirmed field matches for this sample
  composite: CompositeState;         // tri-state, see above
}

interface Props {
  document: ImportDocument;
  samples: ExtractedSample[];
  fields: Field[];
  settings: Settings;
}

// =============================================================================
// Helpers
// =============================================================================

const ACRES_PER_HA = 2.4711;

/**
 * Initial state for a sample: one field-link using the full label, and a
 * composite state that tells the UI whether to show the "is this two fields?"
 * prompt.
 *
 * We never auto-split composite refs — the user has to confirm. This is
 * deliberate: a label containing "AND" or "&" may or may not actually mean two
 * fields, and only the farmer knows which.
 */
function initialLinksFor(sample: ExtractedSample, fields: Field[]): FieldLink[] {
  const ref = sample.lab_sample_label ?? '';
  if (!ref) return [];
  return [bestLinkFor(ref, fields)];
}

/** Initial composite state: null if the label looks splittable, false otherwise. */
function initialCompositeFor(sample: ExtractedSample): CompositeState {
  return isCompositeRef(sample.lab_sample_label) ? null : false;
}

/**
 * Build the field-link array for a sample whose composite question was just
 * answered "yes". Splits the label, matches each part against existing fields.
 */
function linksAfterSplit(sample: ExtractedSample, fields: Field[]): FieldLink[] {
  const ref = sample.lab_sample_label ?? '';
  const parts = splitComposite(ref);
  if (parts.length < 2) return [bestLinkFor(ref, fields)];
  return parts.map((part) => bestLinkFor(part, fields));
}

function bestLinkFor(ref: string, fields: Field[]): FieldLink {
  const candidates = rankFieldMatches(ref, fields, 1);
  const top = candidates[0];
  if (top && top.score >= MATCH_THRESHOLD) {
    return {
      kind: 'existing',
      field_id: top.field.id,
      field_name: top.field.name,
      suggested_ref: ref,
    };
  }
  return {
    kind: 'new',
    temp_id: cryptoRandomId(),
    name: titleCase(ref),
    size: '',
    skip_size: false,
    suggested_ref: ref,
  };
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function cryptoRandomId(): string {
  // Simple unique id for client-side keys; crypto.randomUUID isn't available everywhere
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Effective value for a cell — override if present, else extracted. */
function effective(
  sample: ExtractedSample,
  state: RowState,
  col: keyof ExtractedSample,
): string {
  const overrideKey = col as string;
  if (state.overrides[overrideKey] !== undefined) return state.overrides[overrideKey];
  const v = sample[col];
  if (v === null || v === undefined) return '';
  return String(v);
}

/** Parsed numeric effective value, or null. */
function effectiveNum(sample: ExtractedSample, state: RowState, col: keyof ExtractedSample): number | null {
  const s = effective(sample, state, col);
  if (s === '') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// =============================================================================
// Main component
// =============================================================================

export function ReviewForm({ document, samples, fields, settings }: Props) {
  const router = useRouter();
  const isCommitted = document.status === 'committed';

  // Per-row state map keyed by extracted_sample id
  const [rowStates, setRowStates] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const s of samples) {
      init[s.id] = {
        decision: 'pending',
        overrides: {},
        links: initialLinksFor(s, fields),
        composite: initialCompositeFor(s),
      };
    }
    return init;
  });

  // User's preferred size unit, inferred from settings.slurryUnit
  // (gal/ac → acres, m3/ha → hectares). Acceptable heuristic until proper
  // onboarding unit-picker lands.
  const preferAcres = settings.unitSystem === 'acres';

  // Composite list of "what will happen on commit" for the preview
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingCount = useMemo(
    () => Object.values(rowStates).filter((r) => r.decision === 'pending').length,
    [rowStates],
  );
  const acceptedCount = useMemo(
    () => Object.values(rowStates).filter((r) => r.decision === 'accepted' || r.decision === 'edited').length,
    [rowStates],
  );
  const rejectedCount = useMemo(
    () => Object.values(rowStates).filter((r) => r.decision === 'rejected').length,
    [rowStates],
  );

  const allResolved = pendingCount === 0 && samples.length > 0;

  // Mutators ------------------------------------------------------------

  function setRow(id: string, mut: (r: RowState) => RowState) {
    setRowStates((prev) => ({ ...prev, [id]: mut(prev[id]) }));
  }

  function setOverride(id: string, col: string, value: string) {
    setRow(id, (r) => {
      const overrides = { ...r.overrides, [col]: value };
      // If the user types something, mark as edited (unless already rejected)
      const decision = r.decision === 'rejected' ? 'rejected' : 'edited';
      return { ...r, overrides, decision };
    });
  }

  function setLinks(id: string, links: FieldLink[]) {
    setRow(id, (r) => {
      // If the user explicitly removed extra links so we're back to a single
      // field, treat that as the user saying "actually it's one field" — flip
      // composite back to false. This way the trash-can button can revert a
      // mistaken "yes" answer.
      let composite = r.composite;
      if (links.length <= 1 && composite === true) {
        composite = false;
      }
      return { ...r, links, composite };
    });
  }

  function setDecision(id: string, decision: UserDecision) {
    setRow(id, (r) => ({ ...r, decision }));
  }

  /**
   * Answer the "is this two separate fields?" prompt.
   *
   *   answer=true  → split the label and create a second field-link row
   *                  (links recalculated by linksAfterSplit).
   *   answer=false → keep one row; if we'd previously split, restore the
   *                  original single full-label link.
   */
  function setComposite(id: string, answer: boolean) {
    setRowStates((prev) => {
      const r = prev[id];
      const sample = samples.find((s) => s.id === id);
      if (!sample) return prev;

      let nextLinks = r.links;
      if (answer && (r.composite === null || r.composite === false)) {
        // Switching to "yes it's multiple fields" — split now
        nextLinks = linksAfterSplit(sample, fields);
      } else if (!answer && r.composite !== false) {
        // Switching to "no, just one field" — restore single full-label link
        nextLinks = initialLinksFor(sample, fields);
      }
      return { ...prev, [id]: { ...r, composite: answer, links: nextLinks } };
    });
  }

  function acceptAll() {
    setRowStates((prev) => {
      const next: Record<string, RowState> = {};
      for (const [id, r] of Object.entries(prev)) {
        if (r.decision === 'pending') {
          // If the user already edited something it stays 'edited', else 'accepted'
          const hasEdits = Object.keys(r.overrides).length > 0;
          next[id] = { ...r, decision: hasEdits ? 'edited' : 'accepted' };
        } else {
          next[id] = r;
        }
      }
      return next;
    });
  }

  // Commit handler ------------------------------------------------------

  async function handleConfirmCommit() {
    setSubmitting(true);
    setError(null);
    try {
      type DecisionEntry = {
        extracted_sample_id: string;
        decision: 'accepted' | 'edited' | 'rejected';
        overrides: Record<string, unknown>;
        field_links: Array<
          | { existing_field_id: string; replace_existing?: boolean }
          | { new_field: { name: string; acres?: number; ha?: number; skip_size: boolean } }
        >;
      };

      const decisions: DecisionEntry[] = [];
      for (const s of samples) {
        const r = rowStates[s.id];
        if (r.decision === 'pending') {
          // Should not happen — Finalise is gated. Defensive skip.
          continue;
        }
        if (r.decision === 'rejected') {
          decisions.push({
            extracted_sample_id: s.id,
            decision: 'rejected',
            overrides: {},
            field_links: [],
          });
          continue;
        }
        // accepted or edited
        const field_links = r.links
          .filter((l) => {
            if (l.kind === 'existing') return Boolean(l.field_id);
            return l.name.trim().length > 0;
          })
          .map<DecisionEntry['field_links'][number]>((l) => {
            if (l.kind === 'existing') {
              return {
                existing_field_id: l.field_id,
                replace_existing: l.replace_existing === true,
              };
            }
            const sizeNum = parseFloat(l.size);
            const sizeOk = !isNaN(sizeNum) && sizeNum > 0;
            const new_field: { name: string; acres?: number; ha?: number; skip_size: boolean } = {
              name: l.name.trim(),
              skip_size: l.skip_size,
            };
            if (!l.skip_size && sizeOk) {
              if (preferAcres) new_field.acres = sizeNum;
              else new_field.ha = sizeNum;
            }
            return { new_field };
          });
        decisions.push({
          extracted_sample_id: s.id,
          decision: r.decision,
          overrides: r.overrides,
          field_links,
        });
      }

      const result = await commitDocumentDecisions(document.id, { decisions });
      // Server redirects on success; if we got a result it didn't redirect
      if (result && (result as { error?: string }).error) {
        setError((result as { error: string }).error);
        setSubmitting(false);
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) {
        setError(err.message);
      }
      setSubmitting(false);
    }
  }

  // Pre-commit validation: every non-rejected row must have at least one
  // valid field link, every new-field link must have a non-empty name, and
  // every new-field link must either have a valid positive size or have
  // "I'll add later" ticked.
  const commitBlockers = useMemo(() => {
    const blockers: string[] = [];
    for (const s of samples) {
      const r = rowStates[s.id];
      if (r.decision === 'rejected' || r.decision === 'pending') continue;
      const sampleLabel = s.lab_sample_label ?? 'a sample';
      const validLinks = r.links.filter((l) => {
        if (l.kind === 'existing') return Boolean(l.field_id);
        return l.name.trim().length > 0;
      });
      if (validLinks.length === 0) {
        blockers.push(`${sampleLabel}: no field selected`);
      }
      for (const l of r.links) {
        if (l.kind !== 'new') continue;
        const name = l.name.trim();
        if (name.length === 0) {
          blockers.push(`${sampleLabel}: new field name missing`);
          continue;
        }
        if (l.skip_size) continue;
        // Size must be present and valid
        if (l.size === '' || l.size === undefined || l.size === null) {
          blockers.push(
            `${sampleLabel}: enter a size for "${name}", or tick "I'll add the size later"`,
          );
          continue;
        }
        const n = parseFloat(l.size);
        if (isNaN(n) || n <= 0) {
          blockers.push(`${sampleLabel}: invalid size for "${name}"`);
        }
      }
    }
    return blockers;
  }, [samples, rowStates]);

  // ---------------------------------------------------------------------

  if (isCommitted) {
    return (
      <CommittedView document={document} samples={samples} />
    );
  }

  return (
    <div style={{ padding: 16, paddingBottom: 120 }}>
      {/* Summary banner */}
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
          {samples.length} samples extracted
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          {acceptedCount} accepted · {rejectedCount} rejected · {pendingCount} pending
        </div>
      </div>

      {/* Bulk action */}
      {pendingCount > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={acceptAll}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
            }}
          >
            <CheckSquare size={14} /> Accept all pending ({pendingCount})
          </button>
        </div>
      )}

      {/* Sample cards */}
      {samples.map((s) => (
        <SampleRowCard
          key={s.id}
          sample={s}
          fields={fields}
          state={rowStates[s.id]}
          preferAcres={preferAcres}
          onOverride={(col, v) => setOverride(s.id, col, v)}
          onLinks={(ls) => setLinks(s.id, ls)}
          onDecision={(d) => setDecision(s.id, d)}
          onComposite={(a) => setComposite(s.id, a)}
        />
      ))}

      {/* Footer */}
      {error && (
        <div
          className="card"
          style={{
            padding: 12,
            marginBottom: 14,
            background: 'var(--red-soft)',
            borderColor: 'var(--red)',
            color: 'var(--red)',
            fontSize: 13,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
          }}
        >
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {commitBlockers.length > 0 && (
        <div
          className="card"
          style={{
            padding: 12,
            marginBottom: 14,
            background: 'var(--amber-soft)',
            borderColor: 'var(--amber)',
            fontSize: 12,
            color: 'var(--ink)',
          }}
        >
          <div
            style={{
              fontWeight: 700,
              color: 'var(--amber)',
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <AlertCircle size={14} />
            {commitBlockers.length === 1
              ? '1 issue to resolve before finalising'
              : `${commitBlockers.length} issues to resolve before finalising`}
          </div>
          <ul style={{ margin: '6px 0 0 16px', padding: 0, lineHeight: 1.6 }}>
            {commitBlockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        className="btn-primary"
        disabled={!allResolved || commitBlockers.length > 0 || submitting}
        onClick={() => setShowConfirm(true)}
        style={{
          width: '100%',
          padding: '14px',
          fontSize: 15,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <CheckCircle2 size={18} />
        {allResolved
          ? `Finalise — commit ${acceptedCount} sample${acceptedCount === 1 ? '' : 's'}`
          : `Finalise (${pendingCount} pending)`}
      </button>

      {showConfirm && (
        <ConfirmCommitModal
          samples={samples}
          rowStates={rowStates}
          fields={fields}
          submitting={submitting}
          onCancel={() => setShowConfirm(false)}
          onConfirm={handleConfirmCommit}
        />
      )}
    </div>
  );
}

// =============================================================================
// Sample row card
// =============================================================================

function SampleRowCard({
  sample,
  fields,
  state,
  preferAcres,
  onOverride,
  onLinks,
  onDecision,
  onComposite,
}: {
  sample: ExtractedSample;
  fields: Field[];
  state: RowState;
  preferAcres: boolean;
  onOverride: (col: string, v: string) => void;
  onLinks: (ls: FieldLink[]) => void;
  onDecision: (d: UserDecision) => void;
  onComposite: (answer: boolean) => void;
}) {
  const isRejected = state.decision === 'rejected';
  const isAcceptedLike = state.decision === 'accepted' || state.decision === 'edited';

  // Validation hints per cell
  const phWarn = validatePH(effectiveNum(sample, state, 'ph'));
  const pIdxWarn = validateSoilIndex(effectiveNum(sample, state, 'p_index'), 'P');
  const kIdxWarn = validateSoilIndex(effectiveNum(sample, state, 'k_index'), 'K');

  const extraEntries = Object.entries(sample.extras ?? {});

  return (
    <div
      className="card"
      style={{
        padding: 0,
        marginBottom: 12,
        opacity: isRejected ? 0.55 : 1,
        borderColor: isRejected
          ? 'var(--red)'
          : isAcceptedLike
            ? 'var(--forest)'
            : 'var(--line)',
        borderWidth: 1,
      }}
    >
      {/* Header bar */}
      <div
        style={{
          padding: '10px 14px',
          background: isRejected
            ? 'var(--red-soft)'
            : isAcceptedLike
              ? 'var(--forest-soft)'
              : 'var(--paper)',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
              {sample.lab_sample_label ?? '(no label)'}
            </div>
            {state.composite === null && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  background: 'var(--amber)',
                  color: 'var(--paper)',
                  padding: '2px 6px',
                  borderRadius: 3,
                }}
                title="This sample's name suggests it may be more than one field. Confirm below."
              >
                <AlertCircle size={10} /> Check below
              </span>
            )}
          </div>
          {sample.lab_sample_ref && (
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              Ref: {sample.lab_sample_ref}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <DecisionButton
            label="Accept"
            icon={<Check size={14} />}
            colour="forest"
            active={isAcceptedLike}
            onClick={() => onDecision(Object.keys(state.overrides).length > 0 ? 'edited' : 'accepted')}
          />
          <DecisionButton
            label="Reject"
            icon={<X size={14} />}
            colour="red"
            active={isRejected}
            onClick={() => onDecision('rejected')}
          />
        </div>
      </div>

      {/* Body — hidden when rejected to reduce noise */}
      {!isRejected && (
        <div style={{ padding: 14 }}>
          {/* Composite-question banner — only when label looks composite AND
              user hasn't answered yet */}
          {state.composite === null && (
            <CompositeQuestionBanner
              label={sample.lab_sample_label ?? ''}
              onAnswer={onComposite}
            />
          )}

          {/* Field-link section */}
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--ink-soft)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 6,
              }}
            >
              {state.composite === true ? 'Attach to fields' : 'Attach to field'}
            </div>
            <FieldLinkEditor
              links={state.links}
              fields={fields}
              isComposite={state.composite === true}
              preferAcres={preferAcres}
              onChange={onLinks}
            />
          </div>

          {/* Data cells */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
              gap: 10,
            }}
          >
            <Cell
              label="Sample date"
              value={effective(sample, state, 'sample_date')}
              onChange={(v) => onOverride('sample_date', v)}
              type="date"
            />
            <Cell
              label="pH"
              value={effective(sample, state, 'ph')}
              onChange={(v) => onOverride('ph', v)}
              warning={phWarn?.message}
            />
            <Cell
              label="P (ppm)"
              value={effective(sample, state, 'p_ppm')}
              onChange={(v) => onOverride('p_ppm', v)}
            />
            <Cell
              label="P index"
              value={effective(sample, state, 'p_index')}
              onChange={(v) => onOverride('p_index', v)}
              warning={pIdxWarn?.message}
            />
            <Cell
              label="K (ppm)"
              value={effective(sample, state, 'k_ppm')}
              onChange={(v) => onOverride('k_ppm', v)}
            />
            <Cell
              label="K index"
              value={effective(sample, state, 'k_index')}
              onChange={(v) => onOverride('k_index', v)}
              warning={kIdxWarn?.message}
            />
            <Cell
              label="Mg (ppm)"
              value={effective(sample, state, 'mg_ppm')}
              onChange={(v) => onOverride('mg_ppm', v)}
            />
            <Cell
              label="Mg index"
              value={effective(sample, state, 'mg_index')}
              onChange={(v) => onOverride('mg_index', v)}
            />
          </div>

          {/* Extras */}
          {extraEntries.length > 0 && (
            <details style={{ marginTop: 14 }}>
              <summary
                style={{
                  fontSize: 12,
                  color: 'var(--ink-soft)',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                Extended analytes ({extraEntries.length})
              </summary>
              <div
                style={{
                  marginTop: 10,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                  gap: 8,
                }}
              >
                {extraEntries.map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      background: 'var(--paper)',
                      padding: '6px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                    }}
                  >
                    <div style={{ color: 'var(--muted)', textTransform: 'capitalize' }}>
                      {k.replace(/_/g, ' ')}
                    </div>
                    <div style={{ fontWeight: 700, color: 'var(--ink)' }}>
                      {String(v)}
                    </div>
                  </div>
                ))}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--muted)',
                  fontStyle: 'italic',
                  marginTop: 8,
                  lineHeight: 1.5,
                }}
              >
                These are stored in the sample's `extras` data for future use. Not
                editable in MVP.
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Decision button
// =============================================================================

function CompositeQuestionBanner({
  label,
  onAnswer,
}: {
  label: string;
  onAnswer: (yes: boolean) => void;
}) {
  // Direct question wording does the work — "Is this two fields?" tells the
  // user what they're answering. Yes/No buttons keep the action minimal.
  const parts = splitComposite(label);
  const n = parts.length;
  const numberWord =
    n === 2 ? 'two' : n === 3 ? 'three' : n === 4 ? 'four' : `${n}`;

  return (
    <div
      style={{
        background: 'var(--amber-soft)',
        border: `2px solid var(--amber)`,
        borderRadius: 4,
        padding: 14,
        marginBottom: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: 'var(--ink)',
          lineHeight: 1.4,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        <AlertCircle
          size={18}
          style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }}
        />
        <span>Is this {numberWord} fields?</span>
      </div>
      {n >= 2 && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--ink-soft)',
            paddingLeft: 26,
            lineHeight: 1.5,
          }}
        >
          The name <strong>"{label}"</strong> looks like it might cover{' '}
          {n === 2 ? 'two fields' : `${n} fields`}: {parts.map((p) => `"${p}"`).join(', ')}.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, paddingLeft: 26 }}>
        <button
          type="button"
          onClick={() => onAnswer(true)}
          style={{
            flex: 1,
            padding: '10px 14px',
            fontSize: 14,
            fontWeight: 700,
            background: 'var(--forest)',
            color: 'var(--paper)',
            border: '1px solid var(--forest)',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onAnswer(false)}
          style={{
            flex: 1,
            padding: '10px 14px',
            fontSize: 14,
            fontWeight: 700,
            background: 'var(--card)',
            color: 'var(--ink)',
            border: '1px solid var(--line)',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          No
        </button>
      </div>
    </div>
  );
}

function DecisionButton({
  label,
  icon,
  colour,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  colour: 'forest' | 'red';
  active: boolean;
  onClick: () => void;
}) {
  const bg = active
    ? colour === 'forest'
      ? 'var(--forest)'
      : 'var(--red)'
    : 'var(--card)';
  const fg = active ? 'var(--paper)' : `var(--${colour})`;
  const border = `var(--${colour})`;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
        borderRadius: 4,
        padding: '6px 10px',
        fontSize: 12,
        fontWeight: 700,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        cursor: 'pointer',
      }}
    >
      {icon} {label}
    </button>
  );
}

// =============================================================================
// Cell — single editable value
// =============================================================================

function Cell({
  label,
  value,
  onChange,
  warning,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  warning?: string;
  type?: 'text' | 'date';
}) {
  const hasWarn = Boolean(warning);
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          color: 'var(--ink-soft)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={warning}
        style={{
          padding: '6px 8px',
          border: `1px solid ${hasWarn ? 'var(--amber)' : 'var(--line)'}`,
          background: hasWarn ? 'var(--amber-soft)' : 'var(--card)',
          borderRadius: 4,
          fontSize: 13,
          fontFamily: 'inherit',
          color: 'var(--ink)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
    </label>
  );
}

// =============================================================================
// Field-link editor
// =============================================================================

function FieldLinkEditor({
  links,
  fields,
  isComposite,
  preferAcres,
  onChange,
}: {
  links: FieldLink[];
  fields: Field[];
  isComposite: boolean;
  preferAcres: boolean;
  onChange: (ls: FieldLink[]) => void;
}) {
  function update(idx: number, next: FieldLink) {
    onChange(links.map((l, i) => (i === idx ? next : l)));
  }

  function remove(idx: number) {
    onChange(links.filter((_, i) => i !== idx));
  }

  function add() {
    onChange([
      ...links,
      {
        kind: 'new',
        temp_id: cryptoRandomId(),
        name: '',
        size: '',
        skip_size: false,
      },
    ]);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {links.map((link, idx) => (
        <LinkEditorRow
          key={link.kind === 'existing' ? `e-${link.field_id}-${idx}` : link.temp_id}
          link={link}
          fields={fields}
          preferAcres={preferAcres}
          canRemove={links.length > 1}
          onChange={(next) => update(idx, next)}
          onRemove={() => remove(idx)}
        />
      ))}
      {isComposite && (
        <button
          type="button"
          onClick={add}
          className="btn-ghost"
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            padding: '6px 10px',
          }}
        >
          <Plus size={12} /> Add another field
        </button>
      )}
    </div>
  );
}

function LinkEditorRow({
  link,
  fields,
  preferAcres,
  canRemove,
  onChange,
  onRemove,
}: {
  link: FieldLink;
  fields: Field[];
  preferAcres: boolean;
  canRemove: boolean;
  onChange: (next: FieldLink) => void;
  onRemove: () => void;
}) {
  const selectValue = link.kind === 'existing' ? link.field_id : '__new__';

  function handleSelectChange(v: string) {
    if (v === '__new__') {
      onChange({
        kind: 'new',
        temp_id: link.kind === 'new' ? link.temp_id : cryptoRandomId(),
        name: link.kind === 'new' ? link.name : titleCase(link.suggested_ref ?? ''),
        size: link.kind === 'new' ? link.size : '',
        skip_size: link.kind === 'new' ? link.skip_size : false,
        suggested_ref: link.suggested_ref,
      });
    } else {
      const f = fields.find((x) => x.id === v);
      if (!f) return;
      onChange({
        kind: 'existing',
        field_id: f.id,
        field_name: f.name,
        suggested_ref: link.suggested_ref,
      });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <select
          className="select"
          value={selectValue}
          onChange={(e) => handleSelectChange(e.target.value)}
          style={{ flex: 1 }}
        >
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.needs_setup ? ' (needs setup)' : ''}
            </option>
          ))}
          <option value="__new__">+ Create new field…</option>
        </select>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove this field link"
            style={{
              background: 'transparent',
              border: '1px solid var(--line)',
              borderRadius: 4,
              padding: 6,
              color: 'var(--muted)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Inline confirmation prompt for high-similarity existing match */}
      {link.kind === 'existing' && link.suggested_ref && (
        <SuggestionConfirmer suggested={link.suggested_ref} fieldName={link.field_name} />
      )}

      {/* When linking to a field that already has soil data, ask: replace or add as new */}
      {link.kind === 'existing' && (() => {
        const f = fields.find((x) => x.id === link.field_id);
        if (!f || !f.sampled) return null;
        return (
          <ReplaceExistingPrompt
            fieldName={f.name}
            existingDate={f.sample_date}
            replace={link.replace_existing === true}
            onChange={(next) => onChange({ ...link, replace_existing: next })}
          />
        );
      })()}

      {/* Inline new-field mini-form */}
      {link.kind === 'new' && (
        <NewFieldMiniForm
          link={link}
          preferAcres={preferAcres}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function ReplaceExistingPrompt({
  fieldName,
  existingDate,
  replace,
  onChange,
}: {
  fieldName: string;
  existingDate: string | null;
  replace: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div
      style={{
        padding: 10,
        background: 'var(--paper)',
        borderRadius: 4,
        border: '1px dashed var(--line)',
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ color: 'var(--ink-soft)', lineHeight: 1.5 }}>
        <strong>{fieldName}</strong> already has a soil sample
        {existingDate ? ` from ${existingDate}` : ''}. What would you like to do?
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => onChange(false)}
          style={{
            flex: 1,
            minWidth: 120,
            padding: '6px 10px',
            fontSize: 12,
            fontWeight: 700,
            background: !replace ? 'var(--forest)' : 'var(--card)',
            color: !replace ? 'var(--paper)' : 'var(--ink)',
            border: `1px solid ${!replace ? 'var(--forest)' : 'var(--line)'}`,
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Add as new sample
        </button>
        <button
          type="button"
          onClick={() => onChange(true)}
          style={{
            flex: 1,
            minWidth: 120,
            padding: '6px 10px',
            fontSize: 12,
            fontWeight: 700,
            background: replace ? 'var(--amber)' : 'var(--card)',
            color: replace ? 'var(--paper)' : 'var(--ink)',
            border: `1px solid ${replace ? 'var(--amber)' : 'var(--line)'}`,
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Replace existing
        </button>
      </div>
      {replace && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--amber)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            lineHeight: 1.5,
          }}
        >
          <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            The existing sample for {fieldName} will be permanently deleted on commit.
            Choose "Add as new sample" to keep history instead.
          </span>
        </div>
      )}
    </div>
  );
}

function SuggestionConfirmer({ suggested, fieldName }: { suggested: string; fieldName: string }) {
  // Soft helper line — purely informational. The dropdown is the canonical control.
  const same = suggested.toLowerCase().replace(/[^a-z0-9]/g, '') === fieldName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (same) return null;
  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--muted)',
        paddingLeft: 4,
        fontStyle: 'italic',
      }}
    >
      Is "{suggested}" the same as "{fieldName}"? Change the dropdown above if not.
    </div>
  );
}

function NewFieldMiniForm({
  link,
  preferAcres,
  onChange,
}: {
  link: Extract<FieldLink, { kind: 'new' }>;
  preferAcres: boolean;
  onChange: (next: FieldLink) => void;
}) {
  const sizeLabel = preferAcres ? 'Acres' : 'Hectares';

  return (
    <div
      style={{
        padding: 10,
        background: 'var(--paper)',
        borderRadius: 4,
        border: '1px dashed var(--line)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label style={{ flex: '2 1 180px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            style={{
              fontSize: 11,
              color: 'var(--ink-soft)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            New field name
          </span>
          <input
            className="input"
            value={link.name}
            placeholder="e.g. Doctors"
            onChange={(e) => onChange({ ...link, name: e.target.value })}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
        </label>
        {!link.skip_size && (
          <label style={{ flex: '1 1 100px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span
              style={{
                fontSize: 11,
                color: 'var(--ink-soft)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {sizeLabel}
            </span>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              value={link.size}
              placeholder="optional"
              onChange={(e) => onChange({ ...link, size: e.target.value })}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </label>
        )}
      </div>
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: 'var(--ink-soft)',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={link.skip_size}
          onChange={(e) => onChange({ ...link, skip_size: e.target.checked, size: e.target.checked ? '' : link.size })}
        />
        I'll add the size later
      </label>
      {link.skip_size && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            lineHeight: 1.5,
          }}
        >
          <Info size={12} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            The field will be created with a placeholder size and flagged for setup.
            Total-spread figures will be unreliable until you set the real size.
          </span>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Confirm commit modal
// =============================================================================

function ConfirmCommitModal({
  samples,
  rowStates,
  fields,
  submitting,
  onCancel,
  onConfirm,
}: {
  samples: ExtractedSample[];
  rowStates: Record<string, RowState>;
  fields: Field[];
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const accepted = samples.filter((s) => {
    const d = rowStates[s.id].decision;
    return d === 'accepted' || d === 'edited';
  });
  const rejected = samples.filter((s) => rowStates[s.id].decision === 'rejected');
  const newFieldsToCreate = accepted.flatMap((s) =>
    rowStates[s.id].links.filter((l) => l.kind === 'new' && l.name.trim().length > 0),
  );
  const replacements = accepted.flatMap((s) =>
    rowStates[s.id].links.filter((l) => {
      if (l.kind !== 'existing' || l.replace_existing !== true) return false;
      const f = fields.find((x) => x.id === l.field_id);
      return Boolean(f?.sampled);
    }),
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 100,
      }}
      onClick={onCancel}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 560,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 0,
        }}
      >
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--line)',
            background: 'var(--paper)',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 15 }}>Confirm and commit</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Review what's about to happen. Nothing is saved until you confirm.
          </div>
        </div>

        <div style={{ padding: 16, fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ marginBottom: 12 }}>
            <strong>{accepted.length}</strong> sample{accepted.length === 1 ? '' : 's'} will be saved.{' '}
            {rejected.length > 0 && (
              <span style={{ color: 'var(--muted)' }}>
                {rejected.length} rejected and will not be saved.
              </span>
            )}
          </div>

          {newFieldsToCreate.length > 0 && (
            <div
              style={{
                marginBottom: 12,
                padding: 10,
                background: 'var(--amber-soft)',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              <strong>{newFieldsToCreate.length}</strong> new field
              {newFieldsToCreate.length === 1 ? ' will be created' : 's will be created'}:{' '}
              {newFieldsToCreate.map((l) => (l.kind === 'new' ? l.name : '')).join(', ')}
            </div>
          )}

          {replacements.length > 0 && (
            <div
              style={{
                marginBottom: 12,
                padding: 10,
                background: 'var(--amber-soft)',
                border: '1px solid var(--amber)',
                borderRadius: 4,
                fontSize: 12,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
              }}
            >
              <AlertCircle
                size={14}
                style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }}
              />
              <span>
                <strong>{replacements.length}</strong> existing soil sample
                {replacements.length === 1 ? '' : 's'} will be permanently replaced.
                Older sample data for these fields will be lost.
              </span>
            </div>
          )}

          <details open style={{ marginTop: 8 }}>
            <summary
              style={{
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: 700,
                color: 'var(--ink-soft)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 8,
              }}
            >
              Full preview
            </summary>
            <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {accepted.map((s) => {
                const r = rowStates[s.id];
                const targets = r.links.map((l) => {
                  if (l.kind === 'existing') {
                    const f = fields.find((x) => x.id === l.field_id);
                    const name = f?.name ?? '(field)';
                    if (l.replace_existing && f?.sampled) {
                      return `${name} (replacing prior sample)`;
                    }
                    return name;
                  }
                  const skipNote = l.skip_size ? ' — no size set' : '';
                  return `${l.name.trim() || '(unnamed)'} (new${skipNote})`;
                });
                return (
                  <li
                    key={s.id}
                    style={{
                      padding: '8px 0',
                      borderBottom: '1px solid var(--line-soft)',
                      fontSize: 12,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{s.lab_sample_label ?? '(no label)'}</div>
                    <div style={{ color: 'var(--muted)', marginTop: 2 }}>
                      →{' '}{targets.join(' + ')}
                    </div>
                  </li>
                );
              })}
              {rejected.map((s) => (
                <li
                  key={s.id}
                  style={{
                    padding: '8px 0',
                    borderBottom: '1px solid var(--line-soft)',
                    fontSize: 12,
                    color: 'var(--muted)',
                  }}
                >
                  <div style={{ textDecoration: 'line-through' }}>
                    {s.lab_sample_label ?? '(no label)'}
                  </div>
                  <div style={{ fontStyle: 'italic', marginTop: 2 }}>rejected — not saved</div>
                </li>
              ))}
            </ol>
          </details>

          <div
            style={{
              marginTop: 14,
              fontSize: 12,
              color: 'var(--muted)',
              display: 'flex',
              gap: 6,
              alignItems: 'flex-start',
              lineHeight: 1.5,
            }}
          >
            <Info size={12} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              The source PDF will be deleted after commit. Make sure you have your own
              copy if you need to refer back to the original.
            </span>
          </div>
        </div>

        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            background: 'var(--paper)',
          }}
        >
          <button
            type="button"
            className="btn-ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={submitting}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <CheckCircle2 size={16} />
            {submitting ? 'Saving…' : 'Confirm and save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Committed view
// =============================================================================

function CommittedView({
  document,
  samples,
}: {
  document: ImportDocument;
  samples: ExtractedSample[];
}) {
  const committed = samples.filter((s) => s.committed_sample_id);
  const rejected = samples.filter((s) => s.user_decision === 'rejected');
  return (
    <div style={{ padding: 16 }}>
      <div
        className="card"
        style={{
          padding: 14,
          marginBottom: 14,
          background: 'var(--forest-soft)',
          borderColor: 'var(--forest)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--forest-dark)',
          }}
        >
          <CheckCircle2 size={18} /> Document committed
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 6, lineHeight: 1.5 }}>
          {committed.length} sample{committed.length === 1 ? '' : 's'} saved to your records.
          {rejected.length > 0 && ` ${rejected.length} rejected.`}
        </div>
        {document.committed_at && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            Committed at {new Date(document.committed_at).toLocaleString()}
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', lineHeight: 1.5 }}>
        The source PDF has been removed from storage. The committed sample data is
        permanent and is now visible from each linked field's soil page.
      </div>
    </div>
  );
}
