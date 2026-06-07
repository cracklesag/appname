import { SoilType } from '@/lib/types';

/**
 * Best-effort soil type from an extracted soil sample's `extras` blob. Uses
 * organic-matter (LOI) % to spot organic/peaty soils, and any stated soil
 * texture for the mineral sub-types. Returns null when nothing usable is
 * present, so the importer never guesses blindly (the field is then left for
 * the user to set on the lime page). Banding follows RB209's mineral / organic
 * / peaty split: OM ≥ 20% → peaty, ≥ 10% → organic.
 */
export function suggestSoilTypeFromExtras(
  extras: Record<string, unknown> | null | undefined,
): SoilType | null {
  if (!extras || typeof extras !== 'object') return null;
  const e = extras as Record<string, unknown>;

  const numFrom = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = e[k];
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  const om = numFrom(
    'organic_matter_loi_pct', 'organic_matter_pct', 'om_pct',
    'loi_pct', 'loss_on_ignition_pct',
  );
  if (om != null) {
    if (om >= 20) return 'peaty';
    if (om >= 10) return 'organic';
  }

  const texRaw = e['soil_texture'] ?? e['textural_class'] ?? e['texture'] ?? e['soil_type'];
  const tex = String(texRaw ?? '').toLowerCase().trim();
  if (tex) {
    if (/peat/.test(tex)) return 'peaty';
    if (/organic/.test(tex)) return 'organic';
    if (/loamy sand/.test(tex)) return 'light_sand';
    if (/clay/.test(tex)) return 'heavy_clay';
    if (/silt/.test(tex)) return 'deep_silt';
    if (/loam/.test(tex)) return 'medium_loam';
    if (/sand/.test(tex)) return 'light_sand';
  }
  return null;
}
