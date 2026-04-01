/**
 * Professional quote PDF (pdf-lib) — Senior Floors.
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
  let y = pageH - 48;
  const margin = 48;
  const lineH = 14;
  const textColor = rgb(0.15, 0.18, 0.22);

  const logo = await tryEmbedLogo(pdf);
  if (logo) {
    const lw = 72;
    const lh = (logo.height / logo.width) * lw;
    page.drawImage(logo, { x: margin, y: y - lh, width: lw, height: lh });
    y -= lh + 8;
  }

  page.drawText(COMPANY.name, {
    x: margin,
    y,
    size: 18,
    font: fontBold,
    color: textColor,
  });
  y -= lineH + 4;
  page.drawText(COMPANY.tagline, { x: margin, y, size: 9, font, color: rgb(0.4, 0.42, 0.45) });
  y -= lineH + 2;
  page.drawText(`${COMPANY.phone} · ${COMPANY.email}`, { x: margin, y, size: 9, font, color: rgb(0.4, 0.42, 0.45) });
  y -= 28;

  const rightX = pageW - margin - 180;
  let ry = pageH - 48;
  page.drawText('QUOTE', { x: rightX, y: ry, size: 12, font: fontBold, color: textColor });
  ry -= lineH;
  page.drawText(quote.quote_number || `Quote #${quote.id}`, {
    x: rightX,
    y: ry,
    size: 10,
    font,
    color: textColor,
  });
  ry -= lineH;
  if (quote.issue_date) {
    page.drawText(`Issue: ${String(quote.issue_date).slice(0, 10)}`, { x: rightX, y: ry, size: 9, font });
    ry -= lineH;
  }
  if (quote.expiration_date) {
    page.drawText(`Expires: ${String(quote.expiration_date).slice(0, 10)}`, { x: rightX, y: ry, size: 9, font });
    ry -= lineH;
  }
  page.drawText(`Status: ${quote.status || 'draft'}`, { x: rightX, y: ry, size: 9, font });

  y = Math.min(y, ry) - 24;
  page.drawText('Bill to', { x: margin, y, size: 10, font: fontBold, color: textColor });
  y -= lineH;
  const clientName = customer.name || quote.customer_name || 'Client';
  page.drawText(clientName, { x: margin, y, size: 11, font: fontBold });
  y -= lineH;
  if (customer.email || quote.customer_email) {
    page.drawText(String(customer.email || quote.customer_email), { x: margin, y, size: 9, font });
    y -= lineH;
  }
  if (customer.phone || quote.customer_phone) {
    page.drawText(String(customer.phone || quote.customer_phone), { x: margin, y, size: 9, font });
    y -= lineH;
  }

  y -= 16;
  const typesFromLines = [
    ...new Set((items || []).map((it) => String(it.service_type || '').trim()).filter(Boolean)),
  ].sort();
  const serviceHeader =
    typesFromLines.length > 0
      ? typesFromLines.join(' · ')
      : quote.service_type || 'Flooring';
  page.drawText(`Service types: ${serviceHeader}`, { x: margin, y, size: 9, font });
  y -= 20;

  const colDesc = margin;
  const colQty = pageW - margin - 220;
  const colRate = pageW - margin - 130;
  const colAmt = pageW - margin - 60;
  page.drawText('Description', { x: colDesc, y, size: 9, font: fontBold, color: textColor });
  page.drawText('Qty', { x: colQty, y, size: 9, font: fontBold, color: textColor });
  page.drawText('Rate', { x: colRate, y, size: 9, font: fontBold, color: textColor });
  page.drawText('Amount', { x: colAmt, y, size: 9, font: fontBold, color: textColor });
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.5, color: rgb(0.85, 0.87, 0.9) });
  y -= 12;

  const wrap = (text, maxW, size) => {
    const words = String(text || '').split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) <= maxW) line = test;
      else {
        if (line) lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  };

  for (const it of items) {
    if (y < 120) {
      page = pdf.addPage([pageW, pageH]);
      y = pageH - margin;
    }
    const desc = it.description || it.name || it.floor_type || 'Line item';
    const qty = Number(it.quantity) || Number(it.area_sqft) || 0;
    const rate = Number(it.unit_price) || 0;
    const amt = Number(it.total_price) || qty * rate;
    const ut = it.unit_type ? String(it.unit_type).replace(/_/g, ' ') : 'sq ft';

    const descLines = wrap(desc, colQty - colDesc - 8, 9);
    const rowStartY = y;
    page.drawText(`${qty} ${ut}`, { x: colQty, y: rowStartY, size: 9, font, color: textColor });
    page.drawText(money(rate), { x: colRate, y: rowStartY, size: 9, font, color: textColor });
    page.drawText(money(amt), { x: colAmt, y: rowStartY, size: 9, font, color: textColor });

    let dy = rowStartY;
    for (const line of descLines) {
      if (dy < 80) {
        page = pdf.addPage([pageW, pageH]);
        dy = pageH - margin;
      }
      page.drawText(line, { x: colDesc, y: dy, size: 9, font, color: textColor });
      dy -= lineH;
    }
    const catalogNotes = String(it.catalog_customer_notes || '').trim();
    const lineComment = String(it.notes || '').trim();
    const detailParts = [];
    if (catalogNotes) detailParts.push(catalogNotes);
    if (lineComment) detailParts.push(`Comment: ${lineComment}`);
    if (detailParts.length) {
      const detailText = detailParts.join(' — ');
      for (const line of wrap(detailText, colQty - colDesc - 8, 8)) {
        if (dy < 80) {
          page = pdf.addPage([pageW, pageH]);
          dy = pageH - margin;
        }
        page.drawText(line, { x: colDesc, y: dy, size: 8, font: fontItalic, color: rgb(0.35, 0.37, 0.42) });
        dy -= lineH - 2;
      }
    }
    y = Math.min(dy, rowStartY - lineH) - 8;
  }

  y -= 10;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.5, color: rgb(0.85, 0.87, 0.9) });
  y -= 16;

  const sub = Number(quote.subtotal) || 0;
  const tax = Number(quote.tax_total) || 0;
  const total = Number(quote.total_amount) || 0;
  const drawRow = (label, val) => {
    page.drawText(label, { x: pageW - margin - 200, y, size: 10, font });
    page.drawText(val, { x: pageW - margin - 60, y, size: 10, font: fontBold });
    y -= lineH;
  };
  drawRow('Subtotal', money(sub));
  drawRow('Tax', money(tax));
  const discType = quote.discount_type === 'fixed' ? '$' : '%';
  const discVal = Number(quote.discount_value) || 0;
  drawRow(`Discount (${discType})`, discType === '$' ? money(discVal) : `${discVal}%`);
  y -= 4;
  drawRow('TOTAL', money(total));

  y -= 24;
  const terms = quote.terms_conditions || defaultTerms();
  page.drawText('Terms & conditions', { x: margin, y, size: 10, font: fontBold });
  y -= lineH;
  for (const line of wrap(terms, pageW - 2 * margin, 8)) {
    if (y < 60) {
      page = pdf.addPage([pageW, pageH]);
      y = pageH - margin;
    }
    page.drawText(line, { x: margin, y, size: 8, font, color: rgb(0.35, 0.37, 0.4) });
    y -= lineH - 2;
  }

  if (quote.notes) {
    y -= 10;
    page.drawText('Notes', { x: margin, y, size: 10, font: fontBold });
    y -= lineH;
    for (const line of wrap(quote.notes, pageW - 2 * margin, 8)) {
      if (y < 50) {
        page = pdf.addPage([pageW, pageH]);
        y = pageH - margin;
      }
      page.drawText(line, { x: margin, y, size: 8, font });
      y -= lineH - 2;
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
