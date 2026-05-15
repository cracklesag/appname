import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Save } from 'lucide-react';
import { Header } from '@/components/Header';
import { loadField } from '@/lib/data';
import { saveSoil } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function SoilPage({ params }: { params: { id: string } }) {
  const field = await loadField(params.id);
  if (!field) notFound();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <Header title="Update field" subtitle={field.name} backHref={`/fields/${field.id}`} />
      <form action={saveSoil} style={{ paddingBottom: 100 }}>
        <input type="hidden" name="field_id" value={field.id} />
        <div style={{ padding: 16 }}>
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 10 }}>Latest soil analysis</div>
            <div style={{ marginBottom: 12 }}>
              <div className="label" style={{ fontSize: 11 }}>Sample date</div>
              <input type="date" name="sample_date" className="input" defaultValue={field.sample_date ?? today} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div className="label" style={{ fontSize: 11 }}>pH</div>
                <input type="number" step="0.1" inputMode="decimal" name="ph" className="input" defaultValue={field.ph ?? ''} placeholder="e.g. 5.8" />
              </div>
              <div style={{ flex: 1 }}>
                <div className="label" style={{ fontSize: 11 }}>P idx</div>
                <input type="number" step="0.1" inputMode="decimal" name="p_idx" className="input" defaultValue={field.p_idx ?? ''} placeholder="e.g. 2.5" />
              </div>
              <div style={{ flex: 1 }}>
                <div className="label" style={{ fontSize: 11 }}>K idx</div>
                <input type="number" step="0.1" inputMode="decimal" name="k_idx" className="input" defaultValue={field.k_idx ?? ''} placeholder="e.g. 2.0" />
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="label" style={{ marginBottom: 10 }}>Field events</div>
            <div style={{ marginBottom: 12 }}>
              <div className="label" style={{ fontSize: 11 }}>Last ploughed</div>
              <input type="date" name="last_ploughed" className="input" defaultValue={field.last_ploughed ?? ''} />
            </div>
            <div>
              <div className="label" style={{ fontSize: 11 }}>Last reseeded</div>
              <input type="date" name="last_reseeded" className="input" defaultValue={field.last_reseeded ?? ''} />
            </div>
          </div>

          <div className="card" style={{ padding: 14 }}>
            <div className="label" style={{ marginBottom: 6 }}>Field notes</div>
            <textarea name="notes" className="textarea" rows={3} defaultValue={field.notes ?? ''} placeholder="Anything to remember about this field…" />
          </div>
        </div>

        <div style={{ position: 'sticky', bottom: 0, padding: 16, background: 'linear-gradient(to top, var(--paper) 70%, transparent)', display: 'flex', gap: 10 }}>
          <Link href={`/fields/${field.id}`} className="btn-ghost" style={{ flex: 1, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Cancel</Link>
          <button type="submit" className="btn-primary" style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Save size={18} /> Save
          </button>
        </div>
      </form>
    </div>
  );
}
