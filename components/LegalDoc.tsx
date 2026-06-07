import { marked } from 'marked';
import { Header } from '@/components/Header';

export function LegalDoc({
  title,
  markdown,
  backHref = '/settings',
}: {
  title: string;
  markdown: string;
  backHref?: string;
}) {
  const html = marked.parse(markdown, { async: false }) as string;
  return (
    <div>
      <Header title={title} subtitle="Swardly" backHref={backHref} />
      <style>{`
        .legal-prose { padding: 16px 16px 90px; color: var(--ink); font-size: 14px; line-height: 1.6; max-width: 720px; margin: 0 auto; }
        .legal-prose h2 { font-size: 19px; font-weight: 700; margin: 4px 0 12px; }
        .legal-prose h3 { font-size: 15px; font-weight: 700; margin: 22px 0 6px; }
        .legal-prose p { margin: 0 0 10px; }
        .legal-prose ul, .legal-prose ol { margin: 0 0 12px; padding-left: 20px; }
        .legal-prose li { margin: 4px 0; }
        .legal-prose strong { font-weight: 700; }
        .legal-prose em { color: var(--muted); }
        .legal-prose hr { border: none; border-top: 1px solid var(--line); margin: 22px 0; }
        .legal-prose a { color: var(--forest-dark, #3d5b29); }
      `}</style>
      <div className="legal-prose" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
