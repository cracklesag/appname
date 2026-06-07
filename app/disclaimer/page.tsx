import { LegalDoc } from '@/components/LegalDoc';
import { disclaimerMarkdown } from '@/lib/legal';

export const metadata = { title: 'Disclaimer — Swardly' };

export default function DisclaimerPage() {
  return <LegalDoc title="Disclaimer" markdown={disclaimerMarkdown} />;
}
