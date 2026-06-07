'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileUp, AlertCircle, Info } from 'lucide-react';
import { Header } from '@/components/Header';
import { uploadDocument } from '@/lib/actions';

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<string>('soil_report');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > 20 * 1024 * 1024) {
      setError('File is larger than 20 MB. PDFs should usually be under a few MB.');
      setFile(null);
      e.target.value = '';
      return;
    }
    if (f && f.type && f.type !== 'application/pdf') {
      setError('Please choose a PDF file.');
      setFile(null);
      e.target.value = '';
      return;
    }
    setFile(f);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError('Choose a PDF first.');
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('doc_type', docType);
    try {
      await uploadDocument(fd);
      // server action redirects on success
    } catch (err) {
      if (err instanceof Error && !err.message.includes('NEXT_REDIRECT')) {
        setError(err.message);
      }
      setSubmitting(false);
    }
  }

  return (
    <div>
      <Header title="Import a document" subtitle="Swardly" backHref="/" />

      <form onSubmit={handleSubmit} style={{ padding: 16, paddingBottom: 100 }}>
        {/* Privacy notice — the design call is that we do NOT store the PDF long-term */}
        <div
          className="card"
          style={{
            padding: 14,
            marginBottom: 14,
            background: 'var(--amber-soft)',
            borderColor: 'var(--amber)',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
          }}
        >
          <Info size={18} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>
            <strong>Your PDF isn't stored long-term.</strong> We scan it to extract the
            data, then delete the file once you've confirmed the results. The extracted
            values stay in your account permanently. Please keep your own copy of the
            original PDF.
          </div>
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>Document type</div>
          <select
            className="select"
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
          >
            <option value="soil_report">Soil sample report</option>
            {/* Future: NMP, fertiliser invoice, slurry analysis */}
          </select>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
            Other document types will be added later.
          </div>
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="label" style={{ marginBottom: 10 }}>Choose your PDF</div>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={onPick}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid var(--line)',
              borderRadius: 4,
              background: 'var(--card)',
              fontSize: 14,
            }}
          />
          {file && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
              <strong>{file.name}</strong> · {(file.size / 1024).toFixed(0)} KB
            </div>
          )}
        </div>

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
              fontWeight: 700,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <Link
            href="/"
            className="btn-ghost"
            style={{
              flex: 1,
              textAlign: 'center',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none',
            }}
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="btn-primary"
            disabled={!file || submitting}
            style={{
              flex: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <FileUp size={18} /> {submitting ? 'Uploading…' : 'Upload and extract'}
          </button>
        </div>
      </form>
    </div>
  );
}
