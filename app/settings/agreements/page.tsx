import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/Header';
import { loadAgreements, loadFieldAgreements } from '@/lib/data';
import { createAgreement, deleteAgreement } from '@/lib/actions';
import { AgreementForm } from '@/components/AgreementForm';
import { SCHEME_LABEL, summariseRestrictions, type AgreementScheme } from '@/lib/agreements';
import { ChevronRight, Plus, Trash2, Lock } from 'lucide-react';

export const dynamic = 'force-dynamic';

const SCHEME_ORDER: AgreementScheme[] = ['sfi', 'cs', 'es', 'custom'];

export default async function AgreementsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [agreements, links] = await Promise.all([loadAgreements(), loadFieldAgreements()]);
  const countByAgreement: Record<string, number> = {};
  for (const l of links) countByAgreement[l.agreement_id] = (countByAgreement[l.agreement_id] ?? 0) + 1;

  const byScheme = SCHEME_ORDER.map((s) => ({ scheme: s, items: agreements.filter((a) => a.scheme === s) })).filter((g) => g.items.length);

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Agreements" subtitle="SFI, stewardship & custom" backHref="/settings/land" />

      <div style={{ padding: '12px 16px' }}>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
          Agri-environment agreements and the restrictions they place on a field. Many per field. Caps feed the
          composed advisory N cap and warnings — they never change the recommended numbers. Seeded options are
          read-only; customise one to edit, or add your own.
        </p>

        {byScheme.map((g) => (
          <div key={g.scheme} style={{ marginBottom: 18 }}>
            <div className="label" style={{ marginBottom: 8 }}>{SCHEME_LABEL[g.scheme]}</div>
            {g.items.map((a) => {
              const isSeed = a.user_id === null;
              const chips = summariseRestrictions(a).slice(0, 4);
              const count = countByAgreement[a.id] ?? 0;
              return (
                <div key={a.id} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 13px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--forest-dark)', background: 'var(--forest-soft)', borderRadius: 4, padding: '1px 6px' }}>{a.code}</span>
                        <span style={{ fontFamily: '"Fraunces", serif', fontSize: 15, fontWeight: 600 }}>{a.name}</span>
                        {isSeed && <Lock size={11} style={{ color: 'var(--muted)' }} aria-label="Seeded — customise to edit" />}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>
                        {count ? `${count} field${count === 1 ? '' : 's'}` : 'no fields'}
                      </div>
                    </div>
                    <Link href={`/settings/agreements/${a.id}`} aria-label={`Open ${a.name}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 700, color: 'var(--forest-dark)', textDecoration: 'none' }}>
                      {isSeed ? 'Assign / customise' : 'Edit & assign'} <ChevronRight size={15} />
                    </Link>
                    {!isSeed && (
                      <form action={deleteAgreement}>
                        <input type="hidden" name="id" value={a.id} />
                        <button type="submit" aria-label={`Delete ${a.name}`} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', display: 'inline-flex', padding: 4 }}>
                          <Trash2 size={15} />
                        </button>
                      </form>
                    )}
                  </div>
                  {chips.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                      {chips.map((c, i) => (
                        <span key={i} style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'var(--amber-soft, #f2e5c9)', color: 'var(--amber, #9c6a1a)' }}>{c.label}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: 'var(--forest-dark)', display: 'inline-flex', alignItems: 'center', gap: 6, listStyle: 'none', marginBottom: 12 }}>
            <Plus size={15} /> Add a custom agreement
          </summary>
          <AgreementForm action={createAgreement} a={null} submitLabel="Add agreement" />
        </details>
      </div>
    </div>
  );
}
