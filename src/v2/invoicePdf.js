// Vector PDF generation for invoices — the QuickBooks-style template the
// office supplied (slate bars, single BILL TO block placed for a window
// envelope). Geometry was measured off that sample at 100dpi and converted
// to this 816 x 1056 px canvas (x0.96). Body text is the built-in
// Helvetica; Oswald (embedded) is used for the wordmark and PAID stamp.

const fmt2 = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (v) => '$' + fmt2(v);
const slashDate = (d) => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${m}/${day}/${y}`;
};

const PAGE_W = 816, PAGE_H = 1056;
const SLATE = '#7889a1';
const SEP = '#d9dce1';

// Right-side bars
const BX = 494, BR = 791, BW = BR - BX;
// Items table
const TX = 24, TR = 791;
const DATE_X = 65, DESC_X = 305, DESC_W = 110;
const QTY_R = 540, RATE_R = 669, AMT_R = 758;

const FONTS = [
  ['Oswald-Bold.ttf', 'Oswald'],
];
const fontCache = new Map(); // filename -> base64

async function fetchFontB64(file) {
  if (fontCache.has(file)) return fontCache.get(file);
  const buf = await (await fetch(`/fonts/${file}`)).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  const b64 = btoa(bin);
  fontCache.set(file, b64);
  return b64;
}

async function installFonts(pdf) {
  for (const [file, family] of FONTS) {
    const b64 = await fetchFontB64(file);
    pdf.addFileToVFS(file, b64);
    pdf.addFont(file, family, 'normal');
  }
}

// jsPDF font sizes are in POINTS while this layout is in CSS px.
const PT = 0.75;

function setF(pdf, { font = 'helvetica', bold = false, size = 13.5, color = '#000000' } = {}) {
  if (font === 'helvetica') pdf.setFont('helvetica', bold ? 'bold' : 'normal');
  else pdf.setFont(font, 'normal');
  pdf.setFontSize(size * PT);
  pdf.setTextColor(color);
}

function text(pdf, str, x, y, opts = {}) {
  const { align = 'left', charSpace = 0, maxWidth = null, lineHeight = 1.3, size = 13.5 } = opts;
  setF(pdf, opts);
  const o = { baseline: 'top', align };
  if (charSpace) o.charSpace = charSpace * PT;
  if (maxWidth) {
    const lines = pdf.splitTextToSize(String(str), maxWidth);
    lines.forEach((ln, i) => pdf.text(ln, x, y + i * size * lineHeight, o));
    return lines.length * size * lineHeight;
  }
  pdf.text(String(str), x, y, o);
  return size * lineHeight;
}

function bar(pdf, x, y, w, h) {
  pdf.setFillColor(SLATE);
  pdf.rect(x, y, w, h, 'F');
}

// The small solid-green PAID badge, centered at (cx, cy).
function drawPaidBadge(pdf, cx, cy, scale = 1) {
  const FS = 34 * scale, PADX = 18 * scale, PADY = 5 * scale, B = Math.max(4 * scale, 3.5), R = 8 * scale, LS = 4 * scale;
  pdf.setFont('Oswald', 'normal');
  pdf.setFontSize(FS * PT);
  const textW = pdf.getTextWidth('PAID') + 3 * LS;
  const w = textW + 2 * PADX + 2 * B;
  const h = FS + 2 * PADY + 2 * B;
  pdf.setFillColor('#16a34a');
  pdf.roundedRect(cx - w / 2, cy - h / 2, w, h, R, R, 'F');
  pdf.setTextColor('#ffffff');
  pdf.text('PAID', cx - textW / 2, cy + (FS * 0.72) / 2, { charSpace: LS * PT });
}

export function drawInvoicePage(pdf, { invoice, customer, company, logo }) {
  const lines = invoice.lines || [];
  const paid = invoice.status === 'paid';
  const balance = paid ? 0 : (invoice.balance ?? invoice.total);
  const termsDays = invoice.txn_date && invoice.due_date
    ? Math.round((new Date(invoice.due_date) - new Date(invoice.txn_date)) / 86400000)
    : null;
  const coName = company?.company_name || 'Miller Sawdust';

  /* ---- Top-left company block ---- */
  let y = 53;
  y += text(pdf, coName, 65, y, { bold: true, size: 14, lineHeight: 1.33 });
  for (const ln of [
    company?.street_address,
    (company?.city || company?.zip) ? `${[company?.city, company?.state].filter(Boolean).join(', ')}  ${company?.zip || ''}`.trim() : null,
    company?.phone,
    company?.email,
  ].filter(Boolean)) {
    y += text(pdf, ln, 65, y, { size: 13.5, lineHeight: 1.33 });
  }

  /* ---- Top-right logo + wordmark ---- */
  if (logo) pdf.addImage(logo, 'PNG', 562, 50, 101, 101);
  text(pdf, 'MILLER SAWDUST', 612, 158, { font: 'Oswald', size: 17, align: 'center', charSpace: 1 });

  /* ---- BILL TO (window-envelope position: do not move) ---- */
  const custName = (customer?.company_name || customer?.name || 'Customer').trim();
  const custCityLine = [[customer?.city, customer?.state].filter(Boolean).join(', '), customer?.zip_code]
    .filter(Boolean).join('  ');
  let by = 220;
  by += text(pdf, 'BILL TO', 65, by, { bold: true, size: 13.5, lineHeight: 1.35 });
  for (const ln of [custName, customer?.street_address, custCityLine].filter(Boolean)) {
    by += text(pdf, ln, 65, by, { size: 13.5, lineHeight: 1.35 });
  }

  /* ---- Right info bars ---- */
  bar(pdf, BX, 208, BW, 38);
  text(pdf, `INVOICE ${invoice.doc_number || ''}`.trim(), BX + 9, 208 + 10.5, { bold: true, size: 17, color: '#ffffff' });

  bar(pdf, BX, 260, BW, 36);
  setF(pdf, { bold: true, size: 12.5, color: '#ffffff' });
  const dateLblW = pdf.getTextWidth('DATE ');
  text(pdf, 'DATE', BX + 9, 260 + 11, { bold: true, size: 12.5, color: '#ffffff' });
  text(pdf, slashDate(invoice.txn_date), BX + 9 + dateLblW + 4, 260 + 11, { size: 12.5, color: '#ffffff' });
  if (termsDays > 0) {
    setF(pdf, { bold: true, size: 12.5, color: '#ffffff' });
    const termsLblW = pdf.getTextWidth('TERMS ');
    text(pdf, 'TERMS', 618, 260 + 11, { bold: true, size: 12.5, color: '#ffffff' });
    text(pdf, `Net ${termsDays}`, 618 + termsLblW + 4, 260 + 11, { size: 12.5, color: '#ffffff' });
  }

  bar(pdf, BX, 309, BW, 35);
  setF(pdf, { bold: true, size: 12.5, color: '#ffffff' });
  const dueLblW = pdf.getTextWidth('DUE DATE ');
  text(pdf, 'DUE DATE', BX + 9, 309 + 10.5, { bold: true, size: 12.5, color: '#ffffff' });
  text(pdf, slashDate(invoice.due_date), BX + 9 + dueLblW + 4, 309 + 10.5, { size: 12.5, color: '#ffffff' });

  /* ---- Left divider bar (bottom-aligned with the DUE DATE bar) ---- */
  bar(pdf, TX, 336, 484 - TX, 8);

  if (paid) drawPaidBadge(pdf, 742, 190, 0.45);

  /* ---- Items table ---- */
  bar(pdf, TX, 409, TR - TX, 29);
  const headY = 409 + 8.5;
  text(pdf, 'DATE', DATE_X, headY, { bold: true, size: 12, color: '#ffffff' });
  text(pdf, 'DESCRIPTION', DESC_X, headY, { bold: true, size: 12, color: '#ffffff' });
  text(pdf, 'QTY', QTY_R, headY, { bold: true, size: 12, color: '#ffffff', align: 'right' });
  text(pdf, 'RATE', RATE_R, headY, { bold: true, size: 12, color: '#ffffff', align: 'right' });
  text(pdf, 'AMOUNT', AMT_R, headY, { bold: true, size: 12, color: '#ffffff', align: 'right' });

  let iy = 438 + 9;
  const rows = lines.length ? lines : [{ name: 'No line detail on this invoice', qty: null, unit_price: null, amount: null }];
  rows.forEach((l, idx) => {
    const desc = l.description && l.description !== l.name ? l.description : (l.name || '—');
    setF(pdf, { size: 13.5 });
    const descLines = pdf.splitTextToSize(String(desc), DESC_W);
    const showDate = !/surcharge/i.test(l.name || '');
    if (showDate) text(pdf, slashDate(invoice.txn_date), DATE_X, iy, { size: 13.5 });
    descLines.forEach((ln, i) => text(pdf, ln, DESC_X, iy + i * 16.3, { size: 13.5 }));
    if (l.qty != null) text(pdf, String(l.qty), QTY_R, iy, { size: 13.5, align: 'right' });
    if (l.unit_price != null) text(pdf, fmt2(l.unit_price), RATE_R, iy, { size: 13.5, align: 'right' });
    if (l.amount != null) text(pdf, fmt2(l.amount), AMT_R, iy, { size: 13.5, align: 'right' });
    iy += Math.max(descLines.length * 16.3, 16.3) + 9;
    if (idx < rows.length - 1) {
      pdf.setDrawColor(SEP);
      pdf.setLineWidth(1);
      pdf.line(TX, iy, TR, iy);
      iy += 9;
    }
  });

  /* ---- TOTAL DUE bar + thank-you line ---- */
  const barTop = iy + 23;
  bar(pdf, 444, barTop, BR - 444, 38);
  text(pdf, 'TOTAL DUE', 444 + 13, barTop + 12, { size: 13.5, color: '#ffffff' });
  text(pdf, usd(balance), 768, barTop + 8.5, { bold: true, size: 19, color: '#ffffff', align: 'right' });
  text(pdf, 'We appreciate your business and look forward to serving you again soon.',
    31, barTop + 2, { size: 13.5, maxWidth: 400, lineHeight: 1.25 });

  /* ---- Footer ---- */
  text(pdf, 'Please add the invoice number on the check, Thank You.',
    PAGE_W / 2, 994, { size: 11.5, align: 'center' });

  /* ---- Diagonal PAID stamp (30 degrees, 35% opacity) ---- */
  if (paid) {
    const cx = PAGE_W / 2, cy = PAGE_H / 2;
    const DEG = 30, cA = Math.cos(DEG * Math.PI / 180), sA = Math.sin(DEG * Math.PI / 180);
    const CS = 12;
    pdf.saveGraphicsState();
    pdf.setGState(new pdf.GState({ opacity: 0.35, 'stroke-opacity': 0.35 }));
    pdf.setFont('Oswald', 'normal');
    pdf.setFontSize(150 * PT);
    pdf.setTextColor('#16a34a');
    const textW = pdf.getTextWidth('PAID') + 3 * CS;
    const W = textW + 2 * 56, H = 150 + 2 * 10;
    const at = (du, dv) => [cx + du * cA + dv * sA, cy - du * sA + dv * cA];
    pdf.setDrawColor('#16a34a');
    pdf.setLineWidth(10);
    pdf.setLineJoin(1);
    const corners = [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]].map(([du, dv]) => at(du, dv));
    pdf.lines(
      [1, 2, 3].map((i) => [corners[i][0] - corners[i - 1][0], corners[i][1] - corners[i - 1][1]]),
      corners[0][0], corners[0][1], [1, 1], 'S', true
    );
    const capH = 150 * 0.72;
    const [sx, sy] = at(-textW / 2, capH / 2);
    pdf.text('PAID', sx, sy, { angle: DEG, charSpace: CS * PT });
    pdf.restoreGraphicsState();
  }
}

function pdfDoc(jsPDF) {
  return new jsPDF({ orientation: 'portrait', unit: 'px', format: [PAGE_W, PAGE_H], hotfixes: ['px_scaling'] });
}

/** Render one invoice to a base64 PDF (no download) — used for email/SMS sending. */
export async function buildInvoicePdfBase64({ invoice, customer, company, logo }) {
  const { jsPDF } = await import('jspdf');
  const pdf = pdfDoc(jsPDF);
  await installFonts(pdf);
  drawInvoicePage(pdf, { invoice, customer, company, logo });
  return pdf.output('datauristring').split(',')[1];
}

/** Build the compiled PDF (one invoice per page) and save it under `filename`. */
export async function buildInvoicesPdf({ invoices, custById, company, logo, filename, onProgress }) {
  const { jsPDF } = await import('jspdf');
  const pdf = pdfDoc(jsPDF);
  await installFonts(pdf);
  invoices.forEach((inv, i) => {
    if (i > 0) pdf.addPage([PAGE_W, PAGE_H], 'portrait');
    drawInvoicePage(pdf, { invoice: inv, customer: custById.get(inv.customer_id), company, logo });
    onProgress?.(i + 1);
  });
  if (import.meta.env.MODE === 'sandbox') window.__lastPdfUrl = pdf.output('bloburl');
  pdf.save(filename);
}
