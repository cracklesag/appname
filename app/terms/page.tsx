import { LegalDoc } from '@/components/LegalDoc';
import { termsMarkdown } from '@/lib/legal';

export const metadata = { title: 'Terms of Service — Swardly' };

export default function TermsPage() {
  return <LegalDoc title="Terms of Service" markdown={termsMarkdown} />;
}
