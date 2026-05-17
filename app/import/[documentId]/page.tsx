import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { createClient } from '@/lib/supabase/server';
import { ImportDocument, ExtractedSample } from '@/lib/types';
import { StatusView } from './StatusView';
import { ReviewShell } from './ReviewShell';

export const dynamic = 'force-dynamic';

export default async function ImportDocumentPage({
  params,
}: {
  params: { documentId: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: doc } = await supabase
    .from('documents')
    .select('*')
    .eq('id', params.documentId)
    .maybeSingle();

  if (!doc) notFound();

  const document = doc as ImportDocument;

  // If extraction is done, load the candidate samples for the review shell
  let samples: ExtractedSample[] = [];
  if (document.status === 'ready_for_review' || document.status === 'committed') {
    const { data: rows } = await supabase
      .from('extracted_samples')
      .select('*')
      .eq('document_id', document.id)
      .order('created_at', { ascending: true });
    samples = (rows as ExtractedSample[] | null) ?? [];
  }

  const subtitle = document.original_filename ?? 'Document';

  return (
    <div>
      <Header title="Document import" subtitle={subtitle} backHref="/import" />
      {document.status === 'queued' || document.status === 'processing' ? (
        <StatusView document={document} />
      ) : document.status === 'failed' ? (
        <FailedView document={document} />
      ) : document.status === 'discarded' ? (
        <DiscardedView />
      ) : (
        <ReviewShell document={document} samples={samples} />
      )}
    </div>
  );
}

function FailedView({ document }: { document: ImportDocument }) {
  return (
    <div style={{ padding: 16 }}>
      <div
        className="card"
        style={{
          padding: 14,
          background: 'var(--red-soft)',
          borderColor: 'var(--red)',
          color: 'var(--red)',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Extraction failed</div>
        <div style={{ fontSize: 13, color: 'var(--ink)' }}>
          {document.error_message || 'Something went wrong while extracting samples from this PDF.'}
        </div>
      </div>
    </div>
  );
}

function DiscardedView() {
  return (
    <div style={{ padding: 16 }}>
      <div className="card" style={{ padding: 14, color: 'var(--muted)' }}>
        This document was discarded.
      </div>
    </div>
  );
}
