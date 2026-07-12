'use client';

import { useState } from 'react';
import { AlertTriangle, X, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { dismissNotification } from '@/lib/actions';
import { fmtDateShort } from '@/lib/rules';
import type { FarmWarning } from '@/lib/notifications';

/**
 * Home-page warnings — ADMIN ONLY (the parent gates on isAdmin before
 * rendering this). Collapsed to a single amber summary line; expands to the
 * list, each dismissable. Warnings are computed live server-side; dismissing
 * persists so it stays gone across reloads and for every admin on the farm.
 */
export function HomeNotifications({ warnings }: { warnings: FarmWarning[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (warnings.length === 0) return null;

  return (
    <div style={{ marginBottom: 16, border: '1px solid #e6c98a', background: '#fdf6e6', borderRadius: 12, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <AlertTriangle size={18} style={{ color: '#b0791f', flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: '#7a5410' }}>
          {warnings.length} thing{warnings.length === 1 ? '' : 's'} to check
        </span>
        {open ? <ChevronUp size={16} style={{ color: '#b0791f' }} /> : <ChevronDown size={16} style={{ color: '#b0791f' }} />}
      </button>

      {open && (
        <div style={{ padding: '0 12px 12px' }}>
          {warnings.map((w) => (
            <div key={w.id} style={{ display: 'flex', alignItems: 'stretch', gap: 6, marginTop: 8 }}>
              <Link
                href={`/fields/${w.fieldId}?tab=season&flag=${w.laterAppId},${w.earlierAppId}`}
                style={{ flex: 1, minWidth: 0, display: 'block', background: 'rgba(255,255,255,0.6)', borderRadius: 8, padding: '10px 11px', textDecoration: 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flex: 1, minWidth: 0 }}>{w.fieldName}</span>
                  <ChevronRight size={14} style={{ color: '#b0791f', flexShrink: 0 }} />
                </div>
                <div style={{ fontSize: 12, color: '#7a5410', marginTop: 2, lineHeight: 1.45 }}>
                  {w.productName} spread twice in {w.daysApart} day{w.daysApart === 1 ? '' : 's'} — {fmtDateShort(w.earlierDate)} and {fmtDateShort(w.latestDate)}. Tap to check it&apos;s not a double entry.
                </div>
              </Link>
              <form action={dismissNotification} onSubmit={() => setBusy(w.id)} style={{ display: 'flex' }}>
                <input type="hidden" name="warning_id" value={w.id} />
                <button
                  type="submit"
                  disabled={busy === w.id}
                  aria-label="Dismiss this warning"
                  title="Dismiss — I've checked this"
                  style={{ border: 'none', background: 'rgba(255,255,255,0.5)', borderRadius: 8, color: '#b0791f', cursor: 'pointer', padding: '0 9px', opacity: busy === w.id ? 0.4 : 1 }}
                >
                  <X size={15} />
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
