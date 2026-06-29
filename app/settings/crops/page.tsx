import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/Header';
import { loadCrops } from '@/lib/data';
import { forkCrop, deleteCrop } from '@/lib/actions';
import { loadedCropsByCategory, EVIDENCE_LABEL } from '@/lib/crops';
import { getFarmContext } from '@/lib/farm';
import { ChevronRight, Trash2, Lock, Copy } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function CropCataloguePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [crops, farmCtx] = await Promise.all([loadCrops(), getFarmContext()]);
  const isAdmin = !!farmCtx && (farmCtx.isAdmin || farmCtx.role === 'admin');
  const groups = loadedCropsByCategory(crops);

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header title="Crop catalogue" subtitle="Crops you can allocate to fields" backHref="/crops" />

      <div style={{ padding: '12px 16px' }}>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
          The crops you can put a field on. The seeded crops follow AHDB/PDA guidance and are read-only —
          {isAdmin ? ' make your own custom version to tune yields, offtake, N target or pH for your ground.' : ' your farm admin can add custom versions of these.'}
        </p>

        {groups.map((g) => (
          <div key={g.category} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 10, paddingLeft: 2 }}>
              {g.label}
            </div>
            {g.crops.map((c) => {
              const isSeed = c.userId === null;
              return (
                <div key={c.id} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 13px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontFamily: '"Fraunces", serif', fontSize: 16, fontWeight: 600 }}>{c.profile.label}</span>
                      {isSeed
                        ? <Lock size={11} style={{ color: 'var(--muted)' }} aria-label="Seeded — make a custom version to edit" />
                        : <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: '#EAF1EA', color: 'var(--forest-dark)' }}>CUSTOM</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2, lineHeight: 1.4 }}>
                      {c.profile.summary}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3 }}>
                      {EVIDENCE_LABEL[c.profile.evidence]} · {c.profile.yieldDefault} {c.profile.yieldUnit} · target pH {c.profile.targetPh.toFixed(1)}
                    </div>
                  </div>

                  {isAdmin && (
                    isSeed ? (
                      <form action={forkCrop}>
                        <input type="hidden" name="crop_id" value={c.id} />
                        <button type="submit" aria-label={`Create a custom crop based on ${c.profile.label}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 700, color: 'var(--forest-dark)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                          <Copy size={14} /> Make custom
                        </button>
                      </form>
                    ) : (
                      <>
                        <Link href={`/settings/crops/${c.id}`} aria-label={`Edit ${c.profile.label}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 700, color: 'var(--forest-dark)', textDecoration: 'none' }}>
                          Edit <ChevronRight size={15} />
                        </Link>
                        <form action={deleteCrop}>
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" aria-label={`Delete ${c.profile.label}`} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', display: 'inline-flex', padding: 4 }}>
                            <Trash2 size={15} />
                          </button>
                        </form>
                      </>
                    )
                  )}
                </div>
              );
            })}
          </div>
        ))}

        <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginTop: 4 }}>
          To add a custom crop, start from the closest seeded crop and adjust it — that carries sensible nitrogen stages and
          micronutrient notes to begin with. A custom crop you no longer use can be deleted unless it&apos;s allocated to a field.
        </p>
      </div>
    </div>
  );
}
