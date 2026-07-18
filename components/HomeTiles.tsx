'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronUp, ChevronDown, ChevronRight, ClipboardList, X } from 'lucide-react';
import { dismissAftercutN, undismissAftercutN } from '@/lib/actions';

/**
 * Tappable summary tiles for the home screen. Each tile shows a count; tapping
 * it expands an inline list of the relevant fields beneath the tile row.
 * Keeps the home calm by default (just the numbers) and reveals detail on
 * demand. Pure client interaction — the data is computed server-side and
 * passed in.
 */

export type ComingUpEntry = {
  fieldId: string;
  fieldName: string;
  kind: 'n_due' | 'n_overdue' | 'grazing_due';
  days: number;
  daysUntil?: number;
  /** e.g. "~46 units/ac N still to go" — only on n_due / n_overdue rows. */
  nLeft?: string;
  /** The cut anchoring this N window — target for "happy it's short" dismissal. */
  cutId?: string;
};

export function HomeTiles({
  nNow,
  grazingDue,
}: {
  nNow: ComingUpEntry[];
  grazingDue: ComingUpEntry[];
}) {
  const [open, setOpen] = useState<'n' | 'grazing' | null>(null);
  const router = useRouter();
  // "Happy it's short" dismissal: keep the last dismissed row so Undo stays
  // available even if the list empties.
  const [undoN, setUndoN] = useState<{ cutId: string; name: string } | null>(null);
  const [busyCutId, setBusyCutId] = useState<string | null>(null);

  async function handleDismissN(cutId: string, name: string) {
    if (busyCutId) return;
    setBusyCutId(cutId);
    try {
      await dismissAftercutN(cutId);
      setUndoN({ cutId, name });
      router.refresh();
    } finally {
      setBusyCutId(null);
    }
  }

  async function handleUndoN() {
    if (!undoN || busyCutId) return;
    setBusyCutId(undoN.cutId);
    try {
      await undismissAftercutN(undoN.cutId);
      setUndoN(null);
      router.refresh();
    } finally {
      setBusyCutId(null);
    }
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button
          type="button"
          onClick={() => setOpen(open === 'n' ? null : 'n')}
          aria-expanded={open === 'n'}
          style={{
            textAlign: 'left',
            cursor: nNow.length > 0 ? 'pointer' : 'default',
            // Colour tracks the OPEN state: brighter amber when this tile is
            // open, a subtle amber tint when closed-but-fields-due (so work
            // waiting still reads), neutral when nothing's due.
            border: open === 'n' ? '1px solid rgba(250,199,117,0.9)'
              : nNow.length > 0 ? '1px solid rgba(250,199,117,0.4)' : '1px solid transparent',
            background: open === 'n' ? 'rgba(250,199,117,0.34)'
              : nNow.length > 0 ? 'rgba(250,199,117,0.14)' : 'rgba(239,231,214,0.1)',
            borderRadius: 10,
            padding: '10px 12px',
            fontFamily: 'inherit',
            transition: 'background 140ms ease, border-color 140ms ease',
          }}
          disabled={nNow.length === 0}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 23, fontWeight: 700, color: nNow.length > 0 ? '#FAC775' : 'var(--brand-cream)' }}>{nNow.length}</span>
            {nNow.length > 0 && (open === 'n'
              ? <ChevronUp size={15} style={{ color: '#FAC775' }} />
              : <ChevronDown size={15} style={{ color: '#FAC775' }} />)}
          </div>
          <div style={{ marginTop: 1 }}>
            <div style={{ fontSize: 11.5, color: 'rgba(239,231,214,0.85)', fontWeight: 600 }}>After-cut N</div>
            <div style={{ fontSize: 10, color: 'rgba(239,231,214,0.5)', marginTop: 1 }}>after each cut</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setOpen(open === 'grazing' ? null : 'grazing')}
          aria-expanded={open === 'grazing'}
          style={{
            textAlign: 'left',
            cursor: grazingDue.length > 0 ? 'pointer' : 'default',
            // Lights up green/teal only while open — otherwise neutral, so the
            // colour makes clear which tile you're looking at.
            border: open === 'grazing' ? '1px solid rgba(150,206,160,0.85)' : '1px solid transparent',
            background: open === 'grazing' ? 'rgba(120,190,140,0.28)' : 'rgba(239,231,214,0.1)',
            borderRadius: 10,
            padding: '10px 12px',
            fontFamily: 'inherit',
            transition: 'background 140ms ease, border-color 140ms ease',
          }}
          disabled={grazingDue.length === 0}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 23, fontWeight: 700, color: open === 'grazing' ? '#AEE3BC' : 'var(--brand-cream)' }}>{grazingDue.length}</span>
            {grazingDue.length > 0 && (open === 'grazing'
              ? <ChevronUp size={15} style={{ color: '#AEE3BC' }} />
              : <ChevronDown size={15} style={{ color: 'rgba(239,231,214,0.7)' }} />)}
          </div>
          <div style={{ marginTop: 1 }}>
            <div style={{ fontSize: 11.5, color: 'rgba(239,231,214,0.85)', fontWeight: 600 }}>Grazing dressing</div>
            <div style={{ fontSize: 10, color: 'rgba(239,231,214,0.5)', marginTop: 1 }}>every ~4 weeks</div>
          </div>
        </button>
      </div>

      {/* Expanded lists render below the tile row, inside the hero's dark area */}
      {open === 'n' && nNow.length > 0 && (
        <div style={{ marginTop: 10, background: 'rgba(0,0,0,0.16)', borderRadius: 10, padding: 8 }}>
          <Link
            href={`/plan?preselect=${nNow.map((c) => c.fieldId).join(',')}&from=/`}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'rgba(239,231,214,0.92)', color: 'var(--forest-dark)', borderRadius: 7, padding: '10px 11px', marginBottom: 6, textDecoration: 'none', fontSize: 12.5, fontWeight: 700 }}
          >
            <ClipboardList size={14} /> Create job sheets · {nNow.length} field{nNow.length === 1 ? '' : 's'}
            <ChevronRight size={13} />
          </Link>
          {nNow.map((c) => (
            <div key={c.fieldId} style={{ display: 'flex', alignItems: 'stretch', gap: 6, marginBottom: 6 }}>
            <Link
              href={`/fields/${c.fieldId}/log?type=bag_fert&from=/`}
              style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(239,231,214,0.12)', borderRadius: 7, padding: '9px 11px', textDecoration: 'none' }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--brand-cream)' }}>{c.fieldName}</span>
                {c.nLeft && <span style={{ fontSize: 10.5, color: 'rgba(239,231,214,0.65)' }}>{c.nLeft}</span>}
              </span>
              <span style={{ fontSize: 11, color: c.kind === 'n_overdue' ? '#FAC775' : 'rgba(239,231,214,0.7)', display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                {c.kind === 'n_overdue' ? `overdue ${c.days}d` : (c.days === 0 ? 'cut today' : `cut ${c.days}d ago`)}
                <ChevronRight size={13} />
              </span>
            </Link>
            {c.cutId && (
              <button
                type="button"
                onClick={() => handleDismissN(c.cutId!, c.fieldName)}
                disabled={busyCutId != null}
                aria-label={`Remove ${c.fieldName} — happy it's short this cut`}
                title="Happy it's short — remove for this cut"
                style={{ width: 34, borderRadius: 7, background: 'rgba(239,231,214,0.08)', border: 'none', color: 'rgba(239,231,214,0.55)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: busyCutId === c.cutId ? 0.4 : 1 }}
              >
                <X size={13} />
              </button>
            )}
            </div>
          ))}
          <div style={{ height: 0 }} />
        </div>
      )}
      {open === 'n' && undoN && (
        <button
          type="button"
          onClick={handleUndoN}
          disabled={busyCutId != null}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', marginTop: 8, background: 'transparent', border: '1px dashed rgba(239,231,214,0.35)', borderRadius: 7, padding: '8px 11px', color: 'rgba(239,231,214,0.75)', fontSize: 11.5, cursor: 'pointer' }}
        >
          Marked {undoN.name} as fine for this cut · Undo
        </button>
      )}
      {open === 'grazing' && grazingDue.length > 0 && (
        <div style={{ marginTop: 10, background: 'rgba(0,0,0,0.16)', borderRadius: 10, padding: 8 }}>
          <Link
            href="/reports/grazing/job?from=%2F"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'rgba(239,231,214,0.92)', color: 'var(--forest-dark)', borderRadius: 7, padding: '10px 11px', marginBottom: 6, textDecoration: 'none', fontSize: 12.5, fontWeight: 700 }}
          >
            <ClipboardList size={14} /> Create job sheets · {grazingDue.length} field{grazingDue.length === 1 ? '' : 's'}
            <ChevronRight size={13} />
          </Link>
          {grazingDue.map((c) => (
            <Link
              key={c.fieldId}
              href={`/fields/${c.fieldId}?from=/`}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(239,231,214,0.12)', borderRadius: 7, padding: '9px 11px', marginBottom: 6, textDecoration: 'none' }}
            >
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--brand-cream)' }}>{c.fieldName}</span>
              <span style={{ fontSize: 11, color: 'rgba(239,231,214,0.7)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {(c.daysUntil ?? 0) <= 0 ? 'due now' : `~${c.daysUntil}d`}
                <ChevronRight size={13} />
              </span>
            </Link>
          ))}
          <div style={{ height: 0 }} />
        </div>
      )}
    
        </>
  );
}
