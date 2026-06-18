'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronUp, ChevronDown, ChevronRight, Leaf } from 'lucide-react';

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
};

export function HomeTiles({
  nNow,
  grazingDue,
  lowInputCount,
}: {
  nNow: ComingUpEntry[];
  grazingDue: ComingUpEntry[];
  lowInputCount: number;
}) {
  const [open, setOpen] = useState<'n' | 'grazing' | null>(null);

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
            border: nNow.length > 0 ? '1px solid rgba(250,199,117,0.5)' : '1px solid transparent',
            background: nNow.length > 0 ? 'rgba(250,199,117,0.18)' : 'rgba(239,231,214,0.1)',
            borderRadius: 10,
            padding: '10px 12px',
            fontFamily: 'inherit',
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
            border: '1px solid transparent',
            background: 'rgba(239,231,214,0.1)',
            borderRadius: 10,
            padding: '10px 12px',
            fontFamily: 'inherit',
          }}
          disabled={grazingDue.length === 0}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 23, fontWeight: 700, color: 'var(--brand-cream)' }}>{grazingDue.length}</span>
            {grazingDue.length > 0 && (open === 'grazing'
              ? <ChevronUp size={15} style={{ color: 'rgba(239,231,214,0.7)' }} />
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
          {nNow.map((c) => (
            <Link
              key={c.fieldId}
              href={`/fields/${c.fieldId}/log?type=bag_fert&from=/`}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(239,231,214,0.12)', borderRadius: 7, padding: '9px 11px', marginBottom: 6, textDecoration: 'none' }}
            >
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--brand-cream)' }}>{c.fieldName}</span>
              <span style={{ fontSize: 11, color: c.kind === 'n_overdue' ? '#FAC775' : 'rgba(239,231,214,0.7)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {c.kind === 'n_overdue' ? `overdue ${c.days}d` : (c.days === 0 ? 'cut today' : `cut ${c.days}d ago`)}
                <ChevronRight size={13} />
              </span>
            </Link>
          ))}
          <div style={{ height: 0 }} />
        </div>
      )}
      {open === 'grazing' && grazingDue.length > 0 && (
        <div style={{ marginTop: 10, background: 'rgba(0,0,0,0.16)', borderRadius: 10, padding: 8 }}>
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
    
      {lowInputCount > 0 && (
        <Link
          href="/reports/low-input"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 12, textDecoration: 'none', color: 'rgba(239,231,214,0.75)' }}
        >
          <Leaf size={15} style={{ opacity: 0.85 }} />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Low input</span>
          <span style={{ fontSize: 11.5, opacity: 0.55 }}>· {lowInputCount}</span>
          <ChevronRight size={13} style={{ opacity: 0.55 }} />
        </Link>
      )}
    </>
  );
}
