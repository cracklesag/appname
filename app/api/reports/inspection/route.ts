import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { loadFields, loadAllApplications, loadSprayRecords, loadAllProducts, loadSettings } from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import { getSeasonStart } from '@/lib/rules';

export const dynamic = 'force-dynamic';

// Inspection / Red Tractor pack — one-tap PDF: farm summary, soil analysis
// with sample-age flags, this season's application records, spray records.
// v1 deliberately reads like the paperwork an assessor asks for.

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
    return t === text ? t : `${t.slice(0, -1)}…`;
  }

  table(cols: Col[], rows: string[][]) {
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
    for (const row of rows) {
      if (this.y < MARGIN + 26) { this.newPage(); drawHeader(); }
      let x = MARGIN;
      row.forEach((cell, i) => {
        const c = cols[i];
        const t = this.clip(cell ?? '', c.width, size, this.font);
        const tx = c.align === 'right' ? x + c.width - 6 - this.font.widthOfTextAtSize(t, size) : x;
        this.page.drawText(t, { x: tx, y: this.y, size, font: this.font, color: INK });
        x += c.width;
      });
      this.y -= 3;
      this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: MARGIN + cols.reduce((s, c) => s + c.width, 0), y: this.y }, thickness: 0.4, color: LINE });
      this.y -= rowH - 3;
    }
    this.y -= 6;
  }
}

const fmt = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return iso; }
};

export async function GET() {
  const ctx = await getFarmContext();
  if (!ctx) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const [fields, apps, sprays, products, settings] = await Promise.all([
    loadFields(), loadAllApplications(), loadSprayRecords(), loadAllProducts(), loadSettings(),
  ]);

  const seasonStart = getSeasonStart();
  const seasonEndYear = parseInt(seasonStart.slice(0, 4), 10) + 1;
  const seasonLabel = `${seasonStart.slice(0, 4)}/${String(seasonEndYear).slice(2)} season (from 1 Oct ${seasonStart.slice(0, 4)})`;
  const acres = settings.unitSystem === 'acres';
  const HA_TO_AC = 2.47105;
  const area = (ha: number | null | undefined) => ha == null ? '—' : acres ? `${(ha * HA_TO_AC).toFixed(1)} ac` : `${ha.toFixed(1)} ha`;
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const fieldName = new Map(fields.map((f) => [f.id, f.name]));

  const w = new PdfWriter();
  const farmTitle = settings.farmName ? `${settings.farmName} — Inspection pack` : 'Swardly inspection pack';
  await w.init(farmTitle);

  // ---- Cover / summary ----
  w.page.drawText(farmTitle, { x: MARGIN, y: w.y, size: 18, font: w.bold, color: FOREST });
  w.y -= 26;
  w.text(`Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · ${seasonLabel}`, 9.5, MUTED);
  w.text('Nutrient management & field records prepared from Swardly. Guidance values follow AHDB RB209 (2023).', 9.5, MUTED);
  w.y -= 6;

  const totalHa = fields.reduce((s, f) => s + (f.ha ?? 0), 0);
  w.heading('Farm summary');
  w.table(
    [{ header: 'Fields', width: 90 }, { header: 'Mapped', width: 90 }, { header: 'Total area', width: 110 }, { header: 'Soil sampled', width: 120 }],
    [[
      String(fields.length),
      String(fields.filter((f) => f.boundary).length),
      area(totalHa),
      String(fields.filter((f) => f.sample_date).length),
    ]],
  );

  // ---- Soil analysis ----
  w.heading('Soil analysis by field');
  const now = Date.now();
  const stale = (iso: string | null) => iso ? (now - new Date(iso).getTime()) / 86400000 / 365.25 > 5 : false;
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
      f.ph != null ? f.ph.toFixed(1) : '—',
      f.p_idx != null ? String(f.p_idx) : '—',
      f.k_idx != null ? String(f.k_idx) : '—',
      f.mg_idx != null ? String(f.mg_idx) : '—',
      fmt(f.sample_date),
      !f.sample_date ? 'no sample' : stale(f.sample_date) ? 'resample due' : '',
    ]),
  );

  // ---- Applications this season ----
  const seasonApps = apps
    .filter((a) => a.date_applied >= seasonStart)
    .sort((a, b) => a.date_applied.localeCompare(b.date_applied));
  w.heading(`Fertiliser, organic & lime applications — ${seasonApps.length} record${seasonApps.length === 1 ? '' : 's'} this season`);
  if (seasonApps.length === 0) {
    w.text('No applications recorded this season yet.', 9.5, MUTED);
  } else {
    w.table(
      [
        { header: 'Date', width: 70 },
        { header: 'Field', width: 120 },
        { header: 'Product', width: 150 },
        { header: 'Rate', width: 80, align: 'right' },
        { header: 'Applied by', width: 90 },
      ],
      seasonApps.map((a) => [
        fmt(a.date_applied),
        fieldName.get(a.field_id) ?? '—',
        productName.get(a.product_id) ?? `Product ${a.product_id}`,
        `${a.rate_value} ${a.rate_unit}`,
        a.applied_by || '—',
      ]),
    );
  }

  // ---- Spray records this season ----
  const seasonSprays = sprays
    .filter((r) => r.date_applied >= seasonStart)
    .sort((a, b) => a.date_applied.localeCompare(b.date_applied));
  w.heading(`Spray records — ${seasonSprays.length} this season`);
  if (seasonSprays.length === 0) {
    w.text('No spray records this season yet.', 9.5, MUTED);
  } else {
    w.table(
      [
        { header: 'Date', width: 70 },
        { header: 'Field', width: 110 },
        { header: 'Products', width: 170 },
        { header: 'Water', width: 70, align: 'right' },
        { header: 'Coverage', width: 90 },
      ],
      seasonSprays.map((r) => [
        fmt(r.date_applied),
        fieldName.get(r.field_id) ?? '—',
        r.product_name,
        r.water_l_per_ha != null ? `${r.water_l_per_ha} L/ha` : '—',
        r.coverage === 'partial' ? 'Part field' : 'Whole field',
      ]),
    );
  }

  w.y -= 4;
  w.text('Figures are taken from records entered in Swardly and the soil analyses supplied by the farm.', 8, MUTED);
  w.text('Swardly provides record-keeping and RB209-based guidance; it is not a substitute for a FACTS-qualified adviser.', 8, MUTED);

  const bytes = await w.doc.save();
  const fileSeason = `${seasonStart.slice(0, 4)}-${String(seasonEndYear).slice(2)}`;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="swardly-inspection-pack-${fileSeason}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
