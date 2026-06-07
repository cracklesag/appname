import { LegalDoc } from '@/components/LegalDoc';
import { privacyMarkdown } from '@/lib/legal';

export const metadata = { title: 'Privacy Policy — Swardly' };

export default function PrivacyPage() {
  return <LegalDoc title="Privacy Policy" markdown={privacyMarkdown} />;
}
