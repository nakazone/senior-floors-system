/**
 * Client payment invoice PDF (from approved quote).
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizePdfText } from '../../lib/pdfWinAnsi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPANY = {
  name: 'Senior Floors',
  tagline: 'Hardwood - LVP - Refinishing - Denver Metro',
  phone: '(720) 751-9813',
  email: 'contact@senior-floors.com',
};

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

const TYPE_LABELS = {
  deposit: 'Deposit',
  progress: 'Progress payment',
  final: 'Final payment',
  full: 'Full payment',
  other: 'Payment',
};

const winAnsiSafe = sanitizePdfText;

function drawTxt(page, text, opts) {
  page.drawText(winAnsiSafe(text), opts);
}

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

const DEFAULT_PAYMENT_INSTRUCTIONS =
  'Please remit payment by check, Zelle, or bank transfer. Include the invoice number on your payment. ' +
  'Contact us if you need wiring details or have questions about this invoice.';

/**
 * @param {object} opts
 * @param {object} opts.invoice
 * @param {object} opts.quote
 * @param {object} [opts.customer]
 */
export async function buildInvoicePdfBuffer(opts) {
  const { invoice, quote, customer = {} } = opts;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageW = 612;
  const pageH = 792;
  const page = pdf.addPage([pageW, pageH]);
  let y = pageH - 48;
  const margin = 48;
  const contentW = pageW - 2 * margin;
  const lineH = 13;

  const wrap = (text, maxW, size, f = font) => {
    const words = winAnsiSafe(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(test, size) > maxW && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const accentBarH = 5;
  page.drawRectangle({ x: 0, y: pageH - accentBarH, width: pageW, height: accentBarH, color: PAL.secondary });

  const logo = await tryEmbedLogo(pdf);
  const logoTopY = pageH - accentBarH - 14;
  const lw = logo ? 68 : 0;
  const lh = logo ? (logo.height / logo.width) * lw : 0;
  if (logo) page.drawImage(logo, { x: margin, y: logoTopY - lh, width: lw, height: lh });

  const textX = margin + (logo ? lw + 18 : 0);
  drawTxt(page, COMPANY.name, { x: textX, y: logoTopY - 12, size: 17, font: fontBold, color: PAL.primary });
  drawTxt(page, COMPANY.tagline, { x: textX, y: logoTopY - 28, size: 8.5, font, color: PAL.primaryMuted });
  drawTxt(page, `${COMPANY.phone} - ${COMPANY.email}`, {
    x: textX,
    y: logoTopY - 40,
    size: 8.5,
    font,
    color: PAL.primaryMuted,
  });

  const rightX = pageW - margin - 178;
  const panelH = 88;
  const panelTopY = logoTopY + 2;
  const panelBottomY = panelTopY - panelH;
  page.drawRectangle({ x: rightX - 6, y: panelBottomY, width: 190, height: panelH, color: PAL.panelBg });
  page.drawRectangle({ x: rightX - 6, y: panelBottomY, width: 3, height: panelH, color: PAL.secondaryDark });

  let ry = panelTopY - 16;
  drawTxt(page, 'INVOICE', { x: rightX, y: ry, size: 11, font: fontBold, color: PAL.primary });
  ry -= lineH;
  drawTxt(page, invoice.invoice_number || `INV-${invoice.id}`, {
    x: rightX,
    y: ry,
    size: 10,
    font: fontBold,
    color: PAL.secondaryDark,
  });
  ry -= lineH;
  const issueDate = invoice.created_at ? String(invoice.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
  drawTxt(page, `Issue: ${issueDate}`, { x: rightX, y: ry, size: 8, font, color: PAL.lineMuted });
  ry -= lineH;
  if (invoice.due_date) {
    drawTxt(page, `Due: ${String(invoice.due_date).slice(0, 10)}`, { x: rightX, y: ry, size: 8, font, color: PAL.lineMuted });
    ry -= lineH;
  }
  drawTxt(page, `Status: ${invoice.status || 'issued'}`, { x: rightX, y: ry, size: 8, font, color: PAL.lineMuted });

  y = Math.min(panelBottomY - 12, logoTopY - lh - 20) - 16;

  drawTxt(page, 'Bill to', { x: margin, y, size: 9, font: fontBold, color: PAL.secondaryDark });
  y -= lineH;
  const clientName = customer.name || quote.customer_name || 'Client';
  drawTxt(page, clientName, { x: margin, y, size: 11, font: fontBold, color: PAL.primary });
  y -= lineH;
  if (customer.email || quote.customer_email) {
    drawTxt(page, String(customer.email || quote.customer_email), { x: margin, y, size: 8.5, font, color: PAL.lineMuted });
    y -= lineH;
  }
  if (customer.phone || quote.customer_phone) {
    drawTxt(page, String(customer.phone || quote.customer_phone), { x: margin, y, size: 8.5, font, color: PAL.lineMuted });
    y -= lineH;
  }

  y -= 20;
  drawTxt(page, 'Reference', { x: margin, y, size: 9, font: fontBold, color: PAL.secondaryDark });
  y -= lineH;
  drawTxt(page, `Approved quote: ${quote.quote_number || `#${quote.id}`}`, {
    x: margin,
    y,
    size: 9,
    font,
    color: PAL.primary,
  });
  y -= lineH;
  if (quote.total_amount != null) {
    drawTxt(page, `Quote total: ${money(quote.total_amount)}`, { x: margin, y, size: 9, font, color: PAL.lineMuted });
    y -= lineH;
  }

  y -= 16;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.75, color: PAL.rule });
  y -= 18;

  const typeLabel = TYPE_LABELS[invoice.invoice_type] || 'Payment';
  drawTxt(page, 'Description', { x: margin, y, size: 8, font: fontBold, color: PAL.lineMuted });
  drawTxt(page, 'Amount', { x: pageW - margin - 80, y, size: 8, font: fontBold, color: PAL.lineMuted });
  y -= lineH + 4;
  drawTxt(page, `${typeLabel} - flooring project per approved quote`, {
    x: margin,
    y,
    size: 9,
    font,
    color: PAL.primary,
  });
  const amtStr = money(invoice.amount);
  drawTxt(page, amtStr, {
    x: pageW - margin - fontBold.widthOfTextAtSize(winAnsiSafe(amtStr), 9),
    y,
    size: 9,
    font: fontBold,
    color: PAL.primary,
  });
  y -= lineH + 8;

  if (invoice.notes) {
    for (const line of wrap(invoice.notes, contentW - 20, 8)) {
      drawTxt(page, line, { x: margin + 8, y, size: 8, font, color: PAL.lineMuted });
      y -= lineH - 1;
    }
    y -= 8;
  }

  y -= 8;
  const barH = 52;
  const barBottom = y - barH;
  page.drawRectangle({ x: margin, y: barBottom, width: contentW, height: barH, color: PAL.primary });
  page.drawRectangle({ x: margin, y: barBottom, width: 5, height: barH, color: PAL.secondary });
  drawTxt(page, 'AMOUNT DUE', { x: margin + 14, y: barBottom + 28, size: 11, font: fontBold, color: PAL.white });
  const dueW = fontBold.widthOfTextAtSize(winAnsiSafe(amtStr), 20);
  drawTxt(page, amtStr, {
    x: pageW - margin - dueW,
    y: barBottom + 22,
    size: 20,
    font: fontBold,
    color: PAL.secondary,
  });
  y = barBottom - 20;

  drawTxt(page, 'Payment instructions', { x: margin, y, size: 9, font: fontBold, color: PAL.secondaryDark });
  y -= lineH + 2;
  const payText = invoice.payment_instructions || DEFAULT_PAYMENT_INSTRUCTIONS;
  for (const line of wrap(payText, contentW, 8)) {
    drawTxt(page, line, { x: margin, y, size: 8, font, color: PAL.lineMuted });
    y -= lineH - 1;
  }

  y -= 14;
  drawTxt(page, 'Thank you for choosing Senior Floors. Please contact us with any questions about this invoice.', {
    x: margin,
    y,
    size: 7.5,
    font,
    color: PAL.lineMuted,
  });

  return Buffer.from(await pdf.save());
}
