import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { SprayCalculator } from '@/components/SprayCalculator';
import { loadFields, loadSettings, loadSprayProducts } from '@/lib/data';
import { readSprayerSettings } from '@/lib/spray';
import { bboxOfGeometry, centroidOfBbox, type FieldGeometry } from '@/lib/geo';

export const dynamic = 'force-dynamic';

/**
 * The spray calculator as a standalone tool — separated from the records
 * register so working-out and compliance never blur. Solves the tank from
 * whichever end you know (an area, litres of one spray, or a full tank);
 * "Continue to spray log" carries the mix through when you want a record.
 */
export default async function SprayCalculatorPage() {
  const [fields, settings, sprayProducts] = await Promise.all([
    loadFields(), loadSettings(), loadSprayProducts(),
  ]);
  if (!settings.onboarded) redirect('/welcome');

  const sprayer = readSprayerSettings(settings);

  const calcFields = fields.filter((f) => !f.needs_setup).map((f) => {
    let lat: number | null = null, lng: number | null = null;
    if (f.boundary) {
      try { const c = centroidOfBbox(bboxOfGeometry(f.boundary as FieldGeometry)); lat = c.lat; lng = c.lng; } catch { /* unmapped */ }
    }
    return { id: f.id, name: f.name, ha: f.ha, lat, lng };
  });
  const calcProducts = sprayProducts.map((p) => ({ id: p.id, name: p.name, default_l_per_ha: p.default_l_per_ha }));

  return (
    <div style={{ paddingBottom: 80 }}>
      <Header tone="forest" title="Spray calculator" subtitle="Work out the tank — log it if you want" backHref="/spray" />
      <SprayCalculator fields={calcFields} products={calcProducts} sprayer={sprayer} unitSystem={settings.unitSystem} />
    </div>
  );
}
