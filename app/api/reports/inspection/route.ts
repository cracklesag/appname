import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { loadFields, loadAllApplications, loadSprayRecords, loadAllProducts, loadSettings } from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import { getSeasonStart, calcNutrients } from '@/lib/rules';
import type { Application, Product } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Inspection reports — themed PDFs with totals, plus the full pack.
//   ?report=full (default) | organic | fertiliser | lime | spray | soil
// Nutrient figures reuse calcNutrients, so totals here agree with the Plan
// engine (dated product analyses, RB209 organic availability, lime guard).

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 42;
const INK = rgb(0.16, 0.16, 0.16);
const MUTED = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.85, 0.83, 0.78);
const FOREST = rgb(0.11, 0.37, 0.29);

interface Col { header: string; width: number; align?: 'right' }

class PdfWriter {
  doc!: PDFDocument;
  page!: PDFPage;
  font!: PDFFont;
  bold!: PDFFont;
  y = 0;
  pageNo = 0;
  title = '';

  async init(title: string) {
    this.title = title;
    this.doc = await PDFDocument.create();
    this.font = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage(A4);
    this.pageNo += 1;
    this.y = A4[1] - MARGIN;
    if (this.pageNo > 1) {
      this.page.drawText(this.title, { x: MARGIN, y: A4[1] - 24, size: 8, font: this.font, color: MUTED });
    }
    this.page.drawText(`Page ${this.pageNo}`, { x: A4[0] - MARGIN - 40, y: 24, size: 8, font: this.font, color: MUTED });
  }

  ensure(space: number) {
    if (this.y - space < MARGIN + 20) this.newPage();
  }

  heading(text: string) {
    this.ensure(34);
    this.y -= 10;
    this.page.drawText(text, { x: MARGIN, y: this.y, size: 13, font: this.bold, color: FOREST });
    this.y -= 18;
  }

  text(text: string, size = 9.5, color = INK, font?: PDFFont) {
    this.ensure(size + 6);
    this.page.drawText(text, { x: MARGIN, y: this.y, size, font: font ?? this.font, color });
    this.y -= size + 5;
  }

  private clip(text: string, width: number, size: number, font: PDFFont): string {
    let t = text;
    while (t.length > 1 && font.widthOfTextAtSize(t, size) > width - 6) t = t.slice(0, -1);
    return t === text ? t : `${t.slice(0, -1)}\u2026`;
  }

  table(cols: Col[], rows: string[][], opts?: { boldRows?: Set<number> }) {
    const size = 8.5;
    const rowH = 14;
    const drawHeader = () => {
      let x = MARGIN;
      for (const c of cols) {
        const tx = c.align === 'right' ? x + c.width - 6 - this.bold.widthOfTextAtSize(c.header, size) : x;
        this.page.drawText(c.header, { x: tx, y: this.y, size, font: this.bold, color: INK });
        x += c.width;
      }
      this.y -= 4;
      this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: MARGIN + cols.reduce((s, c) => s + c.width, 0), y: this.y }, thickness: 0.8, color: FOREST });
      this.y -= rowH - 3;
    };
    this.ensure(rowH * 3);
    drawHeader();
    rows.forEach((row, ri) => {
      if (this.y < MARGIN + 26) { this.newPage(); drawHeader(); }
      const f = opts?.boldRows?.has(ri) ? this.bold : this.font;
      let x = MARGIN;
      row.forEach((cell, i) => {
        const c = cols[i];
        const t = this.clip(cell ?? '', c.width, size, f);
        const tx = c.align === 'right' ? x + c.width - 6 - f.widthOfTextAtSize(t, size) : x;
        this.page.drawText(t, { x: tx, y: this.y, size, font: f, color: INK });
        x += c.width;
      });
      this.y -= 3;
      this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: MARGIN + cols.reduce((s, c) => s + c.width, 0), y: this.y }, thickness: 0.4, color: LINE });
      this.y -= rowH - 3;
    });
    this.y -= 6;
  }
}

const fmt = (iso: string | null | undefined) => {
  if (!iso) return '\u2014';
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return iso ?? ''; }
};
const r0 = (v: number) => String(Math.round(v));
const r1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

// ---- amount conversions for tonnage / volume totals -----------------
const AC_TO_HA_AREAL = 2.4711; // per-acre rate -> per-hectare rate
const LB_TO_KG = 0.45359;
const UK_GAL_TO_L = 4.54609;

/** Convert an application's rate to a per-ha physical amount in the product's
 *  natural unit: t (solids/granular), m3 (slurry volume), or L (liquid fert). */
function amountPerHa(a: Application, product: Product | undefined): { v: number; unit: 't' | 'm3' | 'L' } {
  const ru = a.rate_unit as string;
  const v = a.rate_value;
  const liquidBag = product?.type === 'bag_fert' && (product as { form?: string }).form === 'liquid';
  switch (ru) {
    case 'kg/ha': return { v: v / 1000, unit: 't' };
    case 'kg/ac': return { v: (v * AC_TO_HA_AREAL) / 1000, unit: 't' };
    case 'lb/ac': return { v: (v * LB_TO_KG * AC_TO_HA_AREAL) / 1000, unit: 't' };
    case 't/ha': return { v, unit: 't' };
    case 't/ac': return { v: v * AC_TO_HA_AREAL, unit: 't' };
    case 'm3/ha': return { v, unit: 'm3' };
    case 'gal/ac': return { v: (v * UK_GAL_TO_L * AC_TO_HA_AREAL) / 1000, unit: 'm3' };
    case 'l/ha': return liquidBag ? { v, unit: 'L' } : { v: v / 1000, unit: 'm3' };
    case 'l/ac': return liquidBag ? { v: v * AC_TO_HA_AREAL, unit: 'L' } : { v: (v * AC_TO_HA_AREAL) / 1000, unit: 'm3' };
    default: return { v: 0, unit: 't' };
  }
}

const unitLabel = (u: 't' | 'm3' | 'L') => (u === 'm3' ? 'm\u00b3' : u);

interface ProductTotal {
  name: string;
  amount: number;
  amountUnit: 't' | 'm3' | 'L';
  areaHa: number;
  kgN: number;
  kgP: number;
  kgK: number;
}

export async function GET(req: NextRequest) {
  const ctx = await getFarmContext();
  if (!ctx) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const reportParam = req.nextUrl.searchParams.get('report') ?? 'full';
  const report = ['full', 'organic', 'fertiliser', 'lime', 'spray', 'soil'].includes(reportParam) ? reportParam : 'full';

  const [fields, apps, sprays, products, settings] = await Promise.all([
    loadFields(), loadAllApplications(), loadSprayRecords(), loadAllProducts(), loadSettings(),
  ]);

  const seasonStart = getSeasonStart();
  const seasonEndYear = parseInt(seasonStart.slice(0, 4), 10) + 1;
  const seasonLabel = `${seasonStart.slice(0, 4)}/${String(seasonEndYear).slice(2)} season (from 1 Oct ${seasonStart.slice(0, 4)})`;
  const acres = settings.unitSystem === 'acres';
  const HA_TO_AC = 2.47105;
  const area = (ha: number | null | undefined) => (ha == null ? '\u2014' : acres ? `${(ha * HA_TO_AC).toFixed(1)} ac` : `${ha.toFixed(1)} ha`);
  const productById = new Map(products.map((p) => [p.id, p]));
  const fieldById = new Map(fields.map((f) => [f.id, f]));

  const seasonApps = apps.filter((a) => a.date_applied >= seasonStart).sort((a, b) => a.date_applied.localeCompare(b.date_applied));
  const appliedAreaHa = (a: Application): number => {
    if (a.coverage === 'partial') return a.drawn_ha ?? 0;
    return fieldById.get(a.field_id)?.ha ?? 0;
  };

  // ---- totals engine ----
  function totalsFor(rows: Application[]): { byProduct: ProductTotal[]; grand: { kgN: number; kgP: number; kgK: number } } {
    const map = new Map<number, ProductTotal>();
    let kgN = 0, kgP = 0, kgK = 0;
    for (const a of rows) {
      const product = productById.get(a.product_id);
      const ha = appliedAreaHa(a);
      const nut = calcNutrients(product, a.rate_value, a.rate_unit, a.date_applied, a.method);
      const amt = amountPerHa(a, product);
      const t = map.get(a.product_id) ?? { name: product?.name ?? `Product ${a.product_id}`, amount: 0, amountUnit: amt.unit, areaHa: 0, kgN: 0, kgP: 0, kgK: 0 };
      t.amount += amt.v * ha;
      t.areaHa += ha;
      t.kgN += nut.nPerHa * ha;
      t.kgP += nut.p2o5PerHa * ha;
      t.kgK += nut.k2oPerHa * ha;
      map.set(a.product_id, t);
      kgN += nut.nPerHa * ha; kgP += nut.p2o5PerHa * ha; kgK += nut.k2oPerHa * ha;
    }
    return { byProduct: [...map.values()].sort((x, y) => y.kgN - x.kgN || y.amount - x.amount), grand: { kgN, kgP, kgK } };
  }

  function recordsTable(w: PdfWriter, rows: Application[]) {
    w.table(
      [
        { header: 'Date', width: 64 },
        { header: 'Field', width: 108 },
        { header: 'Product', width: 132 },
        { header: 'Rate', width: 74, align: 'right' },
        { header: 'Area', width: 56, align: 'right' },
        { header: 'Applied by', width: 76 },
      ],
      rows.map((a) => [
        fmt(a.date_applied),
        fieldById.get(a.field_id)?.name ?? '\u2014',
        productById.get(a.product_id)?.name ?? `Product ${a.product_id}`,
        `${a.rate_value} ${a.rate_unit}`,
        area(appliedAreaHa(a)) + (a.coverage === 'partial' ? '*' : ''),
        a.applied_by || '\u2014',
      ]),
    );
    if (rows.some((a) => a.coverage === 'partial')) {
      w.text('* part-field application \u2014 area shown is the treated area only.', 8, MUTED);
    }
  }

  function totalsTable(w: PdfWriter, rows: Application[], opts?: { organicNote?: boolean }) {
    const { byProduct, grand } = totalsFor(rows);
    w.heading('Totals');
    const tableRows = byProduct.map((t) => [
      t.name,
      `${t.amount >= 100 ? r0(t.amount) : r1(t.amount)} ${unitLabel(t.amountUnit)}`,
      area(t.areaHa),
      r0(t.kgN), r0(t.kgP), r0(t.kgK),
    ]);
    tableRows.push(['Farm total', '', '', r0(grand.kgN), r0(grand.kgP), r0(grand.kgK)]);
    w.table(
      [
        { header: 'Product', width: 150 },
        { header: 'Amount', width: 84, align: 'right' },
        { header: 'Area covered', width: 84, align: 'right' },
        { header: 'N kg', width: 64, align: 'right' },
        { header: 'P\u2082O\u2085 kg', width: 64, align: 'right' },
        { header: 'K\u2082O kg', width: 64, align: 'right' },
      ],
      tableRows,
      { boldRows: new Set([tableRows.length - 1]) },
    );
    if (opts?.organicNote) {
      w.text('Organic N is shown as crop-available N (RB209 availability factors), matching the Plan engine.', 8, MUTED);
    }
  }

  function soilSection(w: PdfWriter) {
    w.heading('Soil analysis by field');
    const now = Date.now();
    const stale = (iso: string | null) => (iso ? (now - new Date(iso).getTime()) / 86400000 / 365.25 > 5 : false);
    w.table(
      [
        { header: 'Field', width: 130 },
        { header: 'Area', width: 60, align: 'right' },
        { header: 'pH', width: 42, align: 'right' },
        { header: 'P', width: 38, align: 'right' },
        { header: 'K', width: 38, align: 'right' },
        { header: 'Mg', width: 42, align: 'right' },
        { header: 'Sampled', width: 90 },
        { header: '', width: 70 },
      ],
      fields.map((f) => [
        f.name,
        area(f.ha),
        f.ph != null ? f.ph.toFixed(1) : '\u2014',
        f.p_idx != null ? String(f.p_idx) : '\u2014',
        f.k_idx != null ? String(f.k_idx) : '\u2014',
        f.mg_idx != null ? String(f.mg_idx) : '\u2014',
        fmt(f.sample_date),
        !f.sample_date ? 'no sample' : stale(f.sample_date) ? 'resample due' : '',
      ]),
    );
  }

  function spraySection(w: PdfWriter) {
    const seasonSprays = sprays.filter((r) => r.date_applied >= seasonStart).sort((a, b) => a.date_applied.localeCompare(b.date_applied));
    w.heading(`Spray records \u2014 ${seasonSprays.length} this season`);
    if (seasonSprays.length === 0) { w.text('No spray records this season yet.', 9.5, MUTED); return; }
    w.table(
      [
        { header: 'Date', width: 54 },
        { header: 'Field', width: 82 },
        { header: 'Products (litres)', width: 148 },
        { header: 'Weather', width: 100 },
        { header: 'Water', width: 56, align: 'right' },
        { header: 'Area', width: 70, align: 'right' },
      ],
      seasonSprays.map((r) => {
        const prods = Array.isArray(r.products) && r.products.length > 0
          ? r.products.map((p) => `${p.name}${p.litres != null ? ` ${r1(p.litres)}L` : ''}`).join(' + ')
          : `${r.product_name}${r.product_litres != null ? ` ${r1(r.product_litres)}L` : ''}`;
        const wx = [
          r.wind_dir ? `${r.wind_dir}${r.wind_speed_mph != null ? ` ${r.wind_speed_mph}mph` : ''}` : null,
          r.temp_c != null ? `${r.temp_c}\u00b0C` : null,
          r.weather_note,
        ].filter(Boolean).join(', ');
        const ha = r.area_ha ?? fieldById.get(r.field_id)?.ha ?? null;
        return [
          fmt(r.date_applied),
          fieldById.get(r.field_id)?.name ?? '\u2014',
          prods,
          wx || '\u2014',
          r.water_l_per_ha != null ? `${r.water_l_per_ha} L/ha` : '\u2014',
          `${area(ha)}${r.coverage === 'partial' ? ' (part)' : ''}`,
        ];
      }),
    );
    // Totals: how much of each product was used (reads the tank-mix array so
    // multi-product sprays are included, not just single-product records),
    // plus treated area and water volume for the season.
    const byProduct = new Map<string, number>();
    let waterL = 0, treatedHa = 0;
    for (const r of seasonSprays) {
      const ha = r.area_ha ?? fieldById.get(r.field_id)?.ha ?? 0;
      treatedHa += ha;
      if (r.water_l_per_ha != null) waterL += r.water_l_per_ha * ha;
      if (Array.isArray(r.products) && r.products.length > 0) {
        for (const p of r.products) {
          if (p.litres == null) continue;
          byProduct.set(p.name, (byProduct.get(p.name) ?? 0) + p.litres);
        }
      } else if (r.product_litres != null) {
        byProduct.set(r.product_name, (byProduct.get(r.product_name) ?? 0) + r.product_litres);
      }
    }
    w.heading('Totals');
    const productRows = [...byProduct.entries()].sort((a, b) => b[1] - a[1]).map(([name, l]) => [name, `${r1(l)} L`]);
    if (productRows.length > 0) {
      w.table(
        [
          { header: 'Product', width: 360 },
          { header: 'Total used', width: 150, align: 'right' },
        ],
        productRows,
      );
    }
    w.y -= 2;
    w.text(`Treated area this season: ${area(treatedHa)}${waterL > 0 ? ` \u00b7 ${r0(waterL)} L water total` : ''}`, 9.5, INK);
  }

  function appSection(w: PdfWriter, title: string, rows: Application[], opts?: { organicNote?: boolean }) {
    w.heading(`${title} \u2014 ${rows.length} record${rows.length === 1 ? '' : 's'} this season`);
    if (rows.length === 0) { w.text('No records this season yet.', 9.5, MUTED); return; }
    recordsTable(w, rows);
    totalsTable(w, rows, opts);
  }

  const organicApps = seasonApps.filter((a) => { const t = productById.get(a.product_id)?.type; return t === 'slurry' || t === 'solid_manure'; });
  const fertApps = seasonApps.filter((a) => productById.get(a.product_id)?.type === 'bag_fert');
  const limeApps = seasonApps.filter((a) => productById.get(a.product_id)?.type === 'lime');

  const REPORT_TITLES: Record<string, string> = {
    full: 'Inspection pack',
    organic: 'Organic manures report',
    fertiliser: 'Fertiliser report',
    lime: 'Lime report',
    spray: 'Spray report',
    soil: 'Soil analysis report',
  };

  const w = new PdfWriter();
  const farmTitle = `${settings.farmName ? settings.farmName + ' \u2014 ' : ''}${REPORT_TITLES[report]}`;
  await w.init(farmTitle);

  w.page.drawText(farmTitle, { x: MARGIN, y: w.y, size: 18, font: w.bold, color: FOREST });
  w.y -= 26;
  w.text(`Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} \u00b7 ${seasonLabel}`, 9.5, MUTED);
  w.text('Prepared from records in Swardly. Guidance values follow AHDB RB209 (2023).', 9.5, MUTED);
  w.y -= 6;

  if (report === 'full') {
    const totalHa = fields.reduce((s, f) => s + (f.ha ?? 0), 0);
    w.heading('Farm summary');
    w.table(
      [{ header: 'Fields', width: 90 }, { header: 'Mapped', width: 90 }, { header: 'Total area', width: 110 }, { header: 'Soil sampled', width: 120 }],
      [[String(fields.length), String(fields.filter((f) => f.boundary).length), area(totalHa), String(fields.filter((f) => f.sample_date).length)]],
    );
    soilSection(w);
    appSection(w, 'Organic manures', organicApps, { organicNote: true });
    appSection(w, 'Bag fertiliser', fertApps);
    appSection(w, 'Lime', limeApps);
    spraySection(w);
  } else if (report === 'organic') {
    appSection(w, 'Organic manures', organicApps, { organicNote: true });
  } else if (report === 'fertiliser') {
    appSection(w, 'Bag fertiliser', fertApps);
  } else if (report === 'lime') {
    appSection(w, 'Lime', limeApps);
  } else if (report === 'spray') {
    spraySection(w);
  } else if (report === 'soil') {
    soilSection(w);
  }

  w.y -= 4;
  w.text('Figures are taken from records entered in Swardly and the soil analyses supplied by the farm.', 8, MUTED);
  w.text('Swardly provides record-keeping and RB209-based guidance; it is not a substitute for a FACTS-qualified adviser.', 8, MUTED);

  const bytes = await w.doc.save();
  const fileSeason = `${seasonStart.slice(0, 4)}-${String(seasonEndYear).slice(2)}`;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="swardly-${report}-${fileSeason}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
