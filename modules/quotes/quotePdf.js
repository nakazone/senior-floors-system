/**
 * Professional quote PDF (pdf-lib) — Senior Floors.
 * Brand palette aligned with public/styles.css (--primary-color, --secondary-color).
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPANY = {
  name: 'Senior Floors',
  tagline: 'Hardwood · LVP · Refinishing · Denver Metro',
  phone: '(720) 751-9813',
  email: 'contact@senior-floors.com',
};

/** LP / CRM palette (#1a2036 navy, #d6b598 sand) */
const PAL = {
  primary: rgb(26 / 255, 32 / 255, 54 / 255),
  primaryMuted: rgb(42 / 255, 49 / 255, 80 / 255),
  secondary: rgb(214 / 255, 181 / 255, 152 / 255),
  secondaryDark: rgb(196 / 255, 165 / 255, 136 / 255),
  panelBg: rgb(240 / 255, 242 / 255, 248 / 255),
  lineMuted: rgb(0.35, 0.37, 0.42),
  rule: rgb(0.86, 0.88, 0.92),
  white: rgb(1, 1, 1),
};

function money(n) {
  const x = Number(n) || 0;
  return `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function tryEmbedLogo(pdf) {
  const candidates = [
    path.join(__dirname, '../../public/assets/SeniorFloors.png'),
    path.join(__dirname, '../../public/assets/logoSeniorFloors.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const bytes = fs.readFileSync(p);
        try {
          return await pdf.embedPng(bytes);
        } catch {
          try {
            return await pdf.embedJpg(bytes);
          } catch {
            /* continue */
          }
        }
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

/** Classify line for PDF sections (matches quote-builder service_type values). */
function lineSection(it) {
  if (String(it.item_type || '').toLowerCase() === 'product') return 'products';
  const st = String(it.service_type || '').trim();
  if (!st) return 'installation';
  const lower = st.toLowerCase();
  if (lower.includes('sand') || lower.includes('finishing')) return 'sand_finish';
  return 'installation';
}

const SECTION_DEFS = [
  { key: 'installation', label: 'Installation' },
  { key: 'sand_finish', label: 'Sand & Finishing' },
  { key: 'products', label: 'Materials & products' },
];

function groupItemsForPdf(items) {
  const list = Array.isArray(items) ? items : [];
  const buckets = { installation: [], sand_finish: [], products: [] };
  for (const it of list) {
    const k = lineSection(it);
    if (buckets[k]) buckets[k].push(it);
    else buckets.installation.push(it);
  }
  return SECTION_DEFS.filter((d) => buckets[d.key].length > 0).map((d) => ({
    label: d.label,
    items: buckets[d.key],
  }));
}

/**
 * @param {object} opts
 * @param {object} opts.quote - quote row + customer fields
 * @param {Array} opts.items - line items
 */
export async function buildQuotePdfBuffer(opts) {
  const { quote, items = [], customer = {} } = opts;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const pageW = 612;
  const pageH = 792;
  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - 40;
  const margin = 48;
  const contentW = pageW - 2 * margin;
  const lineH = 13;
  const textColor = PAL.primary;

  const wrap = (text, maxW, size, f = font) => {
    const words = String(text || '').split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(test, size) <= maxW) line = test;
      else {
        if (line) lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  };

  const colDesc = margin;
  const colQty = pageW - margin - 210;
  const colRate = pageW - margin - 128;
  const colAmt = pageW - margin - 58;
  const descMaxW = colQty - colDesc - 10;

  const ensureSpace = (needFromBottom) => {
    if (y >= needFromBottom) return;
    page = pdf.addPage([pageW, pageH]);
    y = pageH - margin;
  };

  const drawTableHeader = () => {
    ensureSpace(100);
    page.drawRectangle({
      x: margin,
      y: y - 18,
      width: contentW,
      height: 20,
      color: PAL.primary,
      opacity: 0.06,
    });
    page.drawText('Description', { x: colDesc + 4, y: y - 2, size: 8, font: fontBold, color: PAL.primary });
    page.drawText('Qty', { x: colQty, y: y - 2, size: 8, font: fontBold, color: PAL.primary });
    page.drawText('Rate', { x: colRate, y: y - 2, size: 8, font: fontBold, color: PAL.primary });
    page.drawText('Amount', { x: colAmt, y: y - 2, size: 8, font: fontBold, color: PAL.primary });
    y -= 26;
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageW - margin, y },
      thickness: 0.75,
      color: PAL.secondary,
    });
    y -= 14;
  };

  const drawSectionTitle = (label) => {
    ensureSpace(72);
    page.drawRectangle({
      x: margin,
      y: y - 16,
      width: contentW,
      height: 18,
      color: PAL.secondary,
      opacity: 0.22,
    });
    page.drawRectangle({
      x: margin,
      y: y - 16,
      width: 3,
      height: 18,
      color: PAL.primary,
    });
    page.drawText(label.toUpperCase(), {
      x: margin + 10,
      y: y - 3,
      size: 9,
      font: fontBold,
      color: PAL.primary,
    });
    y -= 26;
  };

  // Top brand bar
  page.drawRectangle({
    x: 0,
    y: pageH - 5,
    width: pageW,
    height: 5,
    color: PAL.secondary,
  });

  const logo = await tryEmbedLogo(pdf);
  if (logo) {
    const lw = 68;
    const lh = (logo.height / logo.width) * lw;
    page.drawImage(logo, { x: margin, y: y - lh, width: lw, height: lh });
    y -= lh + 10;
  }

  page.drawText(COMPANY.name, {
    x: margin,
    y,
    size: 17,
    font: fontBold,
    color: PAL.primary,
  });
  y -= lineH + 2;
  page.drawText(COMPANY.tagline, { x: margin, y, size: 8.5, font, color: PAL.primaryMuted });
  y -= lineH;
  page.drawText(`${COMPANY.phone} · ${COMPANY.email}`, {
    x: margin,
    y,
    size: 8.5,
    font,
    color: PAL.primaryMuted,
  });
  y -= 22;

  const rightW = 178;
  const rightX = pageW - margin - rightW;
  const quoteBoxTop = pageH - 42;
  page.drawRectangle({
    x: rightX - 6,
    y: quoteBoxTop - 76,
    width: rightW + 12,
    height: 82,
    color: PAL.panelBg,
  });
  page.drawRectangle({
    x: rightX - 6,
    y: quoteBoxTop - 76,
    width: 3,
    height: 82,
    color: PAL.secondaryDark,
  });

  let ry = quoteBoxTop - 14;
  page.drawText('QUOTE', { x: rightX, y: ry, size: 11, font: fontBold, color: PAL.primary });
  ry -= lineH;
  page.drawText(quote.quote_number || `Quote #${quote.id}`, {
    x: rightX,
    y: ry,
    size: 10,
    font: fontBold,
    color: PAL.secondaryDark,
  });
  ry -= lineH;
  if (quote.issue_date) {
    page.drawText(`Issue: ${String(quote.issue_date).slice(0, 10)}`, { x: rightX, y: ry, size: 8, font, color: PAL.lineMuted });
    ry -= lineH;
  }
  if (quote.expiration_date) {
    page.drawText(`Expires: ${String(quote.expiration_date).slice(0, 10)}`, {
      x: rightX,
      y: ry,
      size: 8,
      font,
      color: PAL.lineMuted,
    });
    ry -= lineH;
  }
  page.drawText(`Status: ${quote.status || 'draft'}`, { x: rightX, y: ry, size: 8, font, color: PAL.lineMuted });

  y = Math.min(y, ry - 8) - 8;

  page.drawText('Bill to', { x: margin, y, size: 9, font: fontBold, color: PAL.secondaryDark });
  y -= lineH;
  const clientName = customer.name || quote.customer_name || 'Client';
  page.drawText(clientName, { x: margin, y, size: 11, font: fontBold, color: PAL.primary });
  y -= lineH;
  if (customer.email || quote.customer_email) {
    page.drawText(String(customer.email || quote.customer_email), { x: margin, y, size: 8.5, font, color: PAL.lineMuted });
    y -= lineH;
  }
  if (customer.phone || quote.customer_phone) {
    page.drawText(String(customer.phone || quote.customer_phone), { x: margin, y, size: 8.5, font, color: PAL.lineMuted });
    y -= lineH;
  }

  y -= 20;

  const sections = groupItemsForPdf(items);
  if (!sections.length) {
    ensureSpace(100);
    page.drawText('No line items.', { x: margin, y, size: 9, font, color: PAL.lineMuted });
    y -= lineH;
  }

  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    drawSectionTitle(sec.label);
    drawTableHeader();

    for (const it of sec.items) {
      ensureSpace(110);
      const nameStr = String(it.name || '').trim();
      const descStr = String(it.description || '').trim();
      const headline =
        nameStr || (descStr ? descStr.split(/\n/)[0] : '') || String(it.floor_type || '') || 'Line item';
      let bodyStr = '';
      if (nameStr && descStr && descStr !== nameStr) {
        bodyStr = descStr;
      } else if (!nameStr && descStr && descStr.includes('\n')) {
        bodyStr = descStr.split(/\n/).slice(1).join('\n').trim();
      }
      const qty = Number(it.quantity) || Number(it.area_sqft) || 0;
      const rate = Number(it.unit_price) || 0;
      const amt = Number(it.total_price) || qty * rate;
      const ut = it.unit_type ? String(it.unit_type).replace(/_/g, ' ') : 'sq ft';

      const descLines = wrap(headline, descMaxW, 9, fontBold);
      const rowStartY = y;
      page.drawText(`${qty} ${ut}`, { x: colQty, y: rowStartY, size: 8.5, font, color: textColor });
      page.drawText(money(rate), { x: colRate, y: rowStartY, size: 8.5, font, color: textColor });
      page.drawText(money(amt), { x: colAmt, y: rowStartY, size: 8.5, font: fontBold, color: PAL.primary });

      let dy = rowStartY;
      for (const line of descLines) {
        ensureSpace(88);
        page.drawText(line, { x: colDesc, y: dy, size: 9, font: fontBold, color: textColor });
        dy -= lineH;
      }
      if (bodyStr) {
        for (const line of wrap(bodyStr, descMaxW, 7.5, fontItalic)) {
          ensureSpace(88);
          page.drawText(line, { x: colDesc, y: dy, size: 7.5, font: fontItalic, color: PAL.lineMuted });
          dy -= lineH - 1;
        }
      }
      const catalogNotes = String(it.catalog_customer_notes || '').trim();
      const lineComment = String(it.notes || '').trim();
      const detailParts = [];
      if (catalogNotes) detailParts.push(catalogNotes);
      if (lineComment) detailParts.push(`Comment: ${lineComment}`);
      if (detailParts.length) {
        const detailText = detailParts.join(' — ');
        for (const line of wrap(detailText, descMaxW, 7.5, fontItalic)) {
          ensureSpace(88);
          page.drawText(line, { x: colDesc, y: dy, size: 7.5, font: fontItalic, color: PAL.lineMuted });
          dy -= lineH - 1;
        }
      }
      y = Math.min(dy, rowStartY - lineH) - 6;
    }

    if (si < sections.length - 1) {
      y -= 4;
      ensureSpace(90);
      page.drawLine({
        start: { x: margin + 20, y },
        end: { x: pageW - margin - 20, y },
        thickness: 0.35,
        color: PAL.rule,
      });
      y -= 16;
    }
  }

  y -= 8;
  ensureSpace(120);
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.75, color: PAL.secondaryDark });
  y -= 18;

  const sub = Number(quote.subtotal) || 0;
  const tax = Number(quote.tax_total) || 0;
  const total = Number(quote.total_amount) || 0;
  const totalsX = pageW - margin - 198;
  const valX = pageW - margin - 58;

  const drawRow = (label, val, { bold = false, accent = false } = {}) => {
    ensureSpace(72);
    if (accent) {
      page.drawRectangle({
        x: totalsX - 8,
        y: y - 4,
        width: pageW - margin - (totalsX - 8) + 8,
        height: 16,
        color: PAL.primary,
        opacity: 1,
      });
      page.drawText(label, { x: totalsX, y: y, size: 10, font: fontBold, color: PAL.white });
      page.drawText(val, { x: valX, y: y, size: 10, font: fontBold, color: PAL.secondary });
    } else {
      page.drawText(label, { x: totalsX, y, size: 9, font, color: PAL.lineMuted });
      page.drawText(val, { x: valX, y, size: 9, font: bold ? fontBold : font, color: textColor });
    }
    y -= lineH + (accent ? 4 : 2);
  };

  drawRow('Subtotal', money(sub));
  drawRow('Tax', money(tax));
  const discType = quote.discount_type === 'fixed' ? '$' : '%';
  const discVal = Number(quote.discount_value) || 0;
  drawRow(`Discount (${discType})`, discType === '$' ? money(discVal) : `${discVal}%`);
  y -= 2;
  drawRow('TOTAL', money(total), { accent: true });

  y -= 22;
  page.drawText('Terms & conditions', { x: margin, y, size: 9, font: fontBold, color: PAL.secondaryDark });
  y -= lineH + 2;
  const terms = quote.terms_conditions || defaultTerms();
  for (const line of wrap(terms, contentW, 7.5)) {
    ensureSpace(56);
    page.drawText(line, { x: margin, y, size: 7.5, font, color: PAL.lineMuted });
    y -= lineH - 1;
  }

  if (quote.notes) {
    y -= 10;
    page.drawText('Notes', { x: margin, y, size: 9, font: fontBold, color: PAL.secondaryDark });
    y -= lineH + 2;
    for (const line of wrap(quote.notes, contentW, 7.5)) {
      ensureSpace(50);
      page.drawText(line, { x: margin, y, size: 7.5, font, color: textColor });
      y -= lineH - 1;
    }
  }

  return Buffer.from(await pdf.save());
}

function defaultTerms() {
  return (
    'This quote is valid until the expiration date shown. Pricing assumes access to the job site and ' +
    'accurate measurements; changes in scope may require a revised quote. A signed approval or deposit ' +
    'may be required to schedule work.'
  );
}
