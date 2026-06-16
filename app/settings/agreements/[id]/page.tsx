import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/Header';
import { loadAgreements, loadFields, loadFieldAgreements } from '@/lib/data';
import { updateAgreement, forkAgreement } from '@/lib/actions';
import { AgreementForm } from '@/components/AgreementForm';
import { AgreementMembershipEditor } from '@/components/AgreementMembershipEditor';
import { SCHEME_LABEL } from '@/lib/agreements';

export const dynamic = 'force-dynamic';

export default async function AgreementDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [agreements, fields, links] = await Promise.all([loadAgreements(), loadFields(), loadFieldAgreements()]);
  const agreement = agreements.find((a) => a.id === params.id);
  if (!agreement) notFound();
  const isSeed = agreement.user_id === null;
  const memberFieldIds = links.filter((l) => l.agreement_id === agreement.id).map((l) => l.field_id);

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title={agreement.name} subtitle={`${agreement.code} · ${SCHEME_LABEL[agreement.scheme]}`} backHref="/settings/agreements" />

      <div style={{ padding: '12px 16px' }}>
        {isSeed ? (
          <div style={{ background: 'var(--forest-soft)', border: '1px solid var(--line)', borderRadius: 8, padding: 13, marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
              This is a seeded agreement, so its restrictions are read-only. Your real agreement may differ —
              make an editable copy to set your exact caps, dates and notes, then assign your fields to that.
            </div>
            <form action={forkAgreement} style={{ marginTop: 10 }}>
              <input type="hidden" name="source_id" value={agreement.id} />
              <button type="submit" className="btn-primary" style={{ width: '100%' }}>Customise (make an editable copy)</button>
            </form>
          </div>
        ) : (
          <>
            <div className="label" style={{ marginBottom: 8 }}>Restrictions</div>
            <div style={{ marginBottom: 16 }}>
              <AgreementForm action={updateAgreement} a={agreement} submitLabel="Save restrictions" />
            </div>
          </>
        )}

        <div className="label" style={{ marginBottom: 8 }}>Fields</div>
        <AgreementMembershipEditor agreementId={agreement.id} agreementName={agreement.name} fields={fields} memberFieldIds={memberFieldIds} />
      </div>
    </div>
  );
}
