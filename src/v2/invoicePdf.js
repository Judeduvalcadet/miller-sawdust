// Vector PDF generation for invoices. Draws the letterhead template with
// real embedded fonts (Lato + Oswald from /public/fonts) via jsPDF, so the
// saved file is sharp at any print size — no rasterized pages. Layout
// coordinates mirror InvoiceTemplate.jsx one-for-one (816 x 1056 px page).

const money = (v) => v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const PAGE_W = 816, PAGE_H = 1056;
const PAD_X = 52, PAD_TOP = 44, PAD_BOTTOM = 40;
const LEFT = PAD_X, RIGHT = PAGE_W - PAD_X, CONTENT_W = RIGHT - LEFT;
const RULE = '#cccccc', BAND = '#dedede';

const FONTS = [
  ['Lato-Light.ttf', 'LatoLight'],
  ['Lato-Regular.ttf', 'Lato'],
  ['Lato-Bold.ttf', 'LatoBold'],
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

/* Small drawing helpers — everything positions by the text box's TOP edge,
   like CSS, and advances a y cursor. */

// jsPDF font sizes are in POINTS while this layout is in CSS px; PT converts
// so a "13.5px" label renders at exactly the template's visual size.
const PT = 0.75;

function text(pdf, str, x, y, { font = 'Lato', size = 13.5, align = 'left', charSpace = 0, color = '#000000', maxWidth = null, lineHeight = 1.55 } = {}) {
  pdf.setFont(font, 'normal');
  pdf.setFontSize(size * PT);
  pdf.setTextColor(color);
  const opts = { baseline: 'top', align };
  if (charSpace) opts.charSpace = charSpace * PT;
  if (maxWidth) {
    const lines = pdf.splitTextToSize(String(str), maxWidth);
    lines.forEach((ln, i) => pdf.text(ln, x, y + i * size * lineHeight, opts));
    return lines.length * size * lineHeight;
  }
  pdf.text(String(str), x, y, opts);
  return size * lineHeight;
}

function label(pdf, str, x, y, { charSpace = 1.8, size = 11, align = 'left' } = {}) {
  return text(pdf, String(str).toUpperCase(), x, y, { font: 'Lato', size, align, charSpace, lineHeight: 1.2 });
}

function hline(pdf, y, color = RULE, x1 = LEFT, x2 = RIGHT, width = 1) {
  pdf.setDrawColor(color);
  pdf.setLineWidth(width);
  pdf.line(x1, y, x2, y);
}

// The small green PAID badge (horizontal), centered at (cx, cy), mirroring
// the screen template's PaidBadge. Height is 52 * scale (plus border floor).
function drawPaidBadge(pdf, cx, cy, scale = 1) {
  const FS = 34 * scale, PADX = 18 * scale, PADY = 5 * scale, B = Math.max(4 * scale, 3.5), R = 8 * scale, LS = 4 * scale;
  pdf.saveGraphicsState();
  pdf.setGState(new pdf.GState({ opacity: 0.7, 'stroke-opacity': 0.7 }));
  pdf.setFont('Oswald', 'normal');
  pdf.setFontSize(FS * PT);
  pdf.setTextColor('#16a34a');
  const textW = pdf.getTextWidth('PAID') + 3 * LS;
  const w = textW + 2 * PADX + B;
  const h = FS + 2 * PADY + B;
  pdf.setDrawColor('#16a34a');
  pdf.setLineWidth(B);
  pdf.roundedRect(cx - w / 2, cy - h / 2, w, h, R, R, 'S');
  pdf.text('PAID', cx - textW / 2, cy + (FS * 0.72) / 2, { charSpace: LS * PT });
  pdf.restoreGraphicsState();
}

export function drawInvoicePage(pdf, { invoice, customer, company, logo }) {
  const lines = invoice.lines || [];
  const paid = invoice.status === 'paid';
  const subtotal = lines.length
    ? lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
    : Number(invoice.total) || 0;
  const balance = paid ? 0 : (invoice.balance ?? invoice.total);
  const termsDays = invoice.txn_date && invoice.due_date
    ? Math.round((new Date(invoice.due_date) - new Date(invoice.txn_date)) / 86400000)
    : null;
  const coName = company?.company_name || 'Miller Sawdust';
  const custName = (customer?.company_name || customer?.name || 'Customer').trim();
  const custPerson = customer?.name && customer?.company_name && customer.name.trim() !== customer.company_name.trim()
    ? customer.name.trim() : null;
  const custCityLine = [[customer?.city, customer?.state].filter(Boolean).join(', '), customer?.zip_code]
    .filter(Boolean).join(' ');

  /* ---- Header (bottom-aligned like the CSS flex-end) ---- */
  const coLines = [
    company?.street_address,
    (company?.city || company?.zip) ? `${[company?.city, company?.state].filter(Boolean).join(', ')} ${company?.zip || ''}`.trim() : null,
    company?.phone,
    company?.email,
  ].filter(Boolean);
  const brandH = 40 + 10 + coLines.length * 13.5 * 1.55;
  const headerBottom = PAD_TOP + Math.max(132, brandH);

  if (logo) pdf.addImage(logo, 'PNG', LEFT, headerBottom - 132, 132, 132);
  const brandX = LEFT + 132 + 36;
  let y = headerBottom - brandH;
  text(pdf, coName, brandX, y, { font: 'Oswald', size: 40, charSpace: 0.4, lineHeight: 1 });
  y += 40 + 10;
  for (const ln of coLines) y += text(pdf, ln, brandX, y, { size: 13.5 });

  // Doc id, centered on its own column at the right edge
  pdf.setFont('LatoLight', 'normal');
  pdf.setFontSize(28 * PT);
  const numStr = `No. ${invoice.doc_number || '—'}`;
  const numW = pdf.getTextWidth(numStr);
  const cx = RIGHT - numW / 2;
  const numTop = headerBottom - 2 - 28 * 1.2;
  text(pdf, numStr, cx, numTop, { font: 'LatoLight', size: 28, align: 'center', charSpace: 0.5, lineHeight: 1.2 });
  const idLabelTop = numTop - 4 - 12 * 1.2;
  label(pdf, 'Invoice', cx, idLabelTop, { size: 12, charSpace: 3, align: 'center' });
  if (paid) drawPaidBadge(pdf, cx, idLabelTop - 6 - (52 * 0.58) / 2, 0.58);

  /* ---- Divider ---- */
  hline(pdf, headerBottom + 24);
  y = headerBottom + 24 + 22;

  /* ---- Bill to / Ship to / Details ---- */
  const colW = (CONTENT_W - 2 * 28) / 3;
  const colX = [LEFT, LEFT + colW + 28, LEFT + 2 * (colW + 28)];
  const drawAddress = (x, top) => {
    let yy = top;
    yy += text(pdf, custName, x, yy, { size: 15 }) + 2;
    for (const ln of [custPerson, customer?.street_address, custCityLine].filter(Boolean)) {
      yy += text(pdf, ln, x, yy, { size: 13.5, maxWidth: colW });
    }
    return yy - top;
  };
  const partiesTop = y;
  const blockTop = partiesTop + 11 * 1.2 + 8;
  label(pdf, 'Bill to', colX[0], partiesTop);
  const h1 = drawAddress(colX[0], blockTop);
  label(pdf, 'Ship to', colX[1], partiesTop);
  const h2 = drawAddress(colX[1], blockTop);
  label(pdf, 'Details', colX[2], partiesTop);
  const kv = [
    ['Issued', fmtDate(invoice.txn_date)],
    invoice.due_date ? ['Due', fmtDate(invoice.due_date)] : null,
    termsDays > 0 ? ['Terms', `Net ${termsDays}`] : null,
  ].filter(Boolean);
  let ky = blockTop;
  for (const [k, v] of kv) {
    text(pdf, k, colX[2], ky, { size: 13.5 });
    text(pdf, v, colX[2] + colW, ky, { size: 13.5, align: 'right' });
    ky += 13.5 * 1.55;
  }
  y = blockTop + Math.max(h1, h2, ky - blockTop);

  /* ---- Amount due band ---- */
  const bandTop = y + 26;
  const bandH = 18 + (11 * 1.2 + 4 + 13.5 * 1.2) + 18;
  pdf.setFillColor(BAND);
  pdf.roundedRect(LEFT, bandTop, CONTENT_W, bandH, 4, 4, 'F');
  label(pdf, paid ? 'Amount paid' : 'Amount due', LEFT + 24, bandTop + 18);
  text(pdf, paid ? 'Paid in full' : invoice.due_date ? `Payable by ${fmtDate(invoice.due_date)}` : 'Due on receipt',
    LEFT + 24, bandTop + 18 + 11 * 1.2 + 4, { size: 13.5, lineHeight: 1.2 });
  // The amount, light weight, vertically centered: what is owed, or, once
  // paid, what was paid.
  pdf.setFont('LatoLight', 'normal');
  pdf.setFontSize(32 * PT);
  pdf.setTextColor('#000000');
  pdf.text(money(paid ? invoice.total : balance), RIGHT - 24, bandTop + bandH / 2, { baseline: 'middle', align: 'right', charSpace: 0.3 * PT });

  /* ---- Line items ---- */
  const DESC_W = CONTENT_W - (64 + 104 + 112 + 3 * 16);
  const QTY_R = LEFT + DESC_W + 16 + 64;
  const RATE_R = QTY_R + 16 + 104;
  const AMT_R = RIGHT;
  y = bandTop + bandH + 28;
  label(pdf, 'Description', LEFT, y);
  label(pdf, 'Qty', QTY_R, y, { align: 'right' });
  label(pdf, 'Rate', RATE_R, y, { align: 'right' });
  label(pdf, 'Amount', AMT_R, y, { align: 'right' });
  y += 11 * 1.2 + 10;
  hline(pdf, y, '#000000');

  const rows = lines.length ? lines : [{ name: 'No line detail on this invoice', qty: null, unit_price: null, amount: null }];
  for (const l of rows) {
    pdf.setFont('Lato', 'normal');
    pdf.setFontSize(14 * PT);
    const nameLines = pdf.splitTextToSize(l.name || '—', DESC_W);
    const hasNote = l.description && l.description !== l.name;
    const noteLines = hasNote ? (pdf.setFontSize(12.5 * PT), pdf.splitTextToSize(l.description, DESC_W)) : [];
    const descH = nameLines.length * 14 * 1.2 + (hasNote ? 3 + noteLines.length * 12.5 * 1.2 : 0);
    const rowH = 14 + descH + 14;
    let dy = y + 14;
    for (const ln of nameLines) dy += text(pdf, ln, LEFT, dy, { size: 14, lineHeight: 1.2 });
    if (hasNote) {
      dy += 3;
      for (const ln of noteLines) dy += text(pdf, ln, LEFT, dy, { size: 12.5, lineHeight: 1.2 });
    }
    const mid = y + rowH / 2;
    pdf.setFont('Lato', 'normal');
    pdf.setFontSize(14 * PT);
    pdf.setTextColor('#000000');
    if (l.qty != null) pdf.text(String(l.qty), QTY_R, mid, { baseline: 'middle', align: 'right' });
    if (l.unit_price != null) pdf.text(money(l.unit_price), RATE_R, mid, { baseline: 'middle', align: 'right' });
    if (l.amount != null) pdf.text(money(l.amount), AMT_R, mid, { baseline: 'middle', align: 'right' });
    y += rowH;
    hline(pdf, y);
  }

  /* ---- Note (left) + totals (right) ---- */
  y += 18;
  if (invoice.note) {
    label(pdf, 'Note', LEFT, y);
    text(pdf, invoice.note, LEFT, y + 11 * 1.2 + 4, { size: 12.5, maxWidth: 380, lineHeight: 1.6 });
  }
  const TOT_X = RIGHT - 296;
  let ty = y;
  for (const [k, v] of [['Subtotal', money(subtotal)], ['Total', money(invoice.total)]]) {
    text(pdf, k, TOT_X, ty + 6, { size: 14, lineHeight: 1.2 });
    text(pdf, v, RIGHT, ty + 6, { size: 14, align: 'right', lineHeight: 1.2 });
    ty += 6 + 14 * 1.2 + 6;
  }
  ty += 6;
  hline(pdf, ty, '#000000', TOT_X, RIGHT);
  ty += 12;
  text(pdf, 'Balance due', TOT_X, ty + (20 - 14), { size: 14, lineHeight: 1.2 });
  text(pdf, money(balance), RIGHT, ty, { size: 20, align: 'right', lineHeight: 1.2 });

  /* ---- Footer (pinned to the bottom) ---- */
  const footLines = [
    ['Thank you for your business.', 13.5],
    company?.phone ? [`Questions about this invoice? Call ${company.phone}.`, 12.5] : null,
    invoice.source === 'quickbooks' ? [`Imported from QuickBooks${invoice.qb_id ? ` (QB #${invoice.qb_id})` : ''}`, 10.5, '#666666'] : null,
  ].filter(Boolean);
  const contentH = footLines.reduce((s, [, sz]) => s + sz * 1.6, 0);
  const contentBottom = PAGE_H - PAD_BOTTOM;
  hline(pdf, contentBottom - contentH - 20);
  let fy = contentBottom - contentH;
  for (const [str, sz, color] of footLines) {
    fy += text(pdf, str, LEFT, fy, { size: sz, lineHeight: 1.6, color: color || '#000000' });
  }
  text(pdf, `Invoice ${invoice.doc_number || '—'} · Page 1 of 1`, RIGHT, contentBottom - 12.5 * 1.6, { size: 12.5, align: 'right', lineHeight: 1.6 });

  /* ---- Big diagonal PAID stamp across the middle of a settled invoice ----
     30° tilt, 35% opacity. Pure vector, placed by hand (jsPDF's align and
     baseline options misplace angled text). */
  if (paid) {
    const cx = PAGE_W / 2, cy = PAGE_H / 2;
    const DEG = 30, cA = Math.cos(DEG * Math.PI / 180), sA = Math.sin(DEG * Math.PI / 180);
    const CS = 12; // letter-spacing, px
    pdf.saveGraphicsState();
    pdf.setGState(new pdf.GState({ opacity: 0.35, 'stroke-opacity': 0.35 }));
    pdf.setFont('Oswald', 'normal');
    pdf.setFontSize(150 * PT);
    pdf.setTextColor('#16a34a');
    const textW = pdf.getTextWidth('PAID') + 3 * CS;
    const W = textW + 2 * 56, H = 150 + 2 * 10;
    // u = reading direction (up-right at 30°), v = glyph-down
    const at = (du, dv) => [cx + du * cA + dv * sA, cy - du * sA + dv * cA];
    pdf.setDrawColor('#16a34a');
    pdf.setLineWidth(10);
    const corners = [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]].map(([du, dv]) => at(du, dv));
    corners.forEach((p, i) => {
      const q = corners[(i + 1) % 4];
      pdf.line(p[0], p[1], q[0], q[1]);
    });
    const capH = 150 * 0.72;
    const [sx, sy] = at(-textW / 2, capH / 2);
    pdf.text('PAID', sx, sy, { angle: DEG, charSpace: CS * PT });
    pdf.restoreGraphicsState();
  }
}

/** Build the compiled PDF (one invoice per page) and save it under `filename`. */
export async function buildInvoicesPdf({ invoices, custById, company, logo, filename, onProgress }) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [PAGE_W, PAGE_H], hotfixes: ['px_scaling'] });
  await installFonts(pdf);
  invoices.forEach((inv, i) => {
    if (i > 0) pdf.addPage([PAGE_W, PAGE_H], 'portrait');
    drawInvoicePage(pdf, { invoice: inv, customer: custById.get(inv.customer_id), company, logo });
    onProgress?.(i + 1);
  });
  if (import.meta.env.MODE === 'sandbox') window.__lastPdfUrl = pdf.output('bloburl');
  pdf.save(filename);
}
