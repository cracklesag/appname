'use client';

import { FileDown, Share2, ExternalLink } from 'lucide-react';
import { useState } from 'react';

// One inspection-report row with two actions:
//   Open  — opens the PDF in a NEW TAB, so you're never stranded in a full-page
//           PDF with no way back to the app.
//   Share — fetches the PDF and hands it to the phone's native share sheet
//           (Mail, WhatsApp, AirDrop, …). Falls back to opening it if the
//           browser can't share files.
export function ReportRow({
  url,
  title,
  sub,
  filename,
}: {
  url: string;
  title: string;
  sub: string;
  filename: string;
}) {
  const [busy, setBusy] = useState(false);

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const file = new File([blob], filename, { type: 'application/pdf' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title });
      } else {
        // No file sharing available — open the PDF so the OS share/download can take over.
        const objUrl = URL.createObjectURL(blob);
        window.open(objUrl, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
      }
    } catch {
      // Aborted share or a fetch problem — fall back to just opening the report.
      window.open(url, '_blank', 'noopener');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ padding: 14, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <FileDown size={19} style={{ color: 'var(--forest)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink)' }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.4 }}>{sub}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${title}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', border: '1px solid var(--line)', borderRadius: 9, color: 'var(--ink)', textDecoration: 'none', fontSize: 12.5 }}
        >
          <ExternalLink size={14} /> Open
        </a>
        <button
          type="button"
          onClick={share}
          disabled={busy}
          aria-label={`Share ${title}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', border: 'none', borderRadius: 9, background: 'var(--forest)', color: '#fff', fontSize: 12.5, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
        >
          <Share2 size={14} /> {busy ? 'Preparing…' : 'Share'}
        </button>
      </div>
    </div>
  );
}
