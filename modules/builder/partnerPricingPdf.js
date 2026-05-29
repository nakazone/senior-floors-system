/**
 * Partner pricing table PDF (pdf-lib) — same brand layout as modules/quotes/quotePdf.js.
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

const CATEGORY_ORDER = [
  { key: 'installation', label: 'Installation' },
  { key: 'sand_finish', label: 'Sand & Finish' },
  { key: 'supply', label: 'Supply' },
  { key: 'custom', label: 'Custom' },
];

function money(n) {
  const x = Number(n) || 0;
  return `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function winAnsiSafe(s, maxLen) {
  let t = String(s ?? '')
    .replace(/\u2192/g, '->')
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u00A0/g, ' ');
  t = t.replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, '');
  if (maxLen != null) t = t.slice(0, maxLen);
  return t;
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

function groupServices(services) {
  const list = (services || []).filter((s) => s.is_visible !== false);
  const buckets = {};
  for (const def of CATEGORY_ORDER) buckets[def.key] = [];
  const other = [];
  for (const s of list) {
    const k = String(s.category || 'installation').toLowerCase();
    if (buckets[k]) buckets[k].push(s);
    else other.push(s);
  }
  const sections = CATEGORY_ORDER.filter((d) => buckets[d.key].length > 0).map((d) => ({
    label: d.label,
    items: buckets[d.key],
  }));
  if (other.length) sections.push({ label: 'Other', items: other });
  return sections;
}

/**
 * @param {object} opts
 * @param {Array} opts.services
 * @param {object} opts.meta - valid_through, last_updated, builder_display_name
 * @param {Array} [opts.volumeDiscounts]
 */
export async function buildPartnerPricingPdfBuffer(opts) {
  const { services = [], meta = {}, volumeDiscounts = [] } = opts;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const pageW = 612;
  const pageH = 792;
  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - 48;
  const margin = 48;
  const contentW = pageW - 2 * margin;
  const lineH = 13;

  const wrap = (text, maxW, size, f = font) => {
    const words = winAnsiSafe(text).split(/\s+/);
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

  const colSvc = margin;
  const colUnit = pageW - margin - 280;
  const colPub = pageW - margin - 168;
  const colPartner = pageW - margin - 58;
  const svcMaxW = colUnit - colSvc - 8;

  const ensureSpace = (needFromBottom) => {
    if (y >= needFromBottom) return;
    page = pdf.addPage([pageW, pageH]);
    y = pageH - margin;
  };

  const baselineCenteredInBar = (barBottom, barH, fontSize) => {
    const ascent = fontSize * 0.76;
    const descent = fontSize * 0.235;
    return barBottom + barH / 2 - (ascent - descent) / 2;
  };

  const drawTableHeader = () => {
    ensureSpace(100);
    const fs = 8;
    const barPad = 5;
    const th = fontBold.heightAtSize(fs);
    const barH = th + 2 * barPad;
    const barTop = y;
    const barBottom = barTop - barH;
    const baselineY = baselineCenteredInBar(barBottom, barH, fs);
    page.drawRectangle({
      x: margin,
      y: barBottom,
      width: contentW,
      height: barH,
      color: PAL.primary,
      opacity: 0.06,
    });
    page.drawText('Service', { x: colSvc + 4, y: baselineY, size: fs, font: fontBold, color: PAL.primary });
    page.drawText('Unit', { x: colUnit, y: baselineY, size: fs, font: fontBold, color: PAL.primary });
    page.drawText('Public range', { x: colPub, y: baselineY, size: fs, font: fontBold, color: PAL.primary });
    page.drawText('Your price', { x: colPartner, y: baselineY, size: fs, font: fontBold, color: PAL.primary });
    y = barBottom - 4;
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
    const fs = 9;
    const barPad = 6;
    const th = fontBold.heightAtSize(fs);
    const barH = th + 2 * barPad;
    const barTop = y;
    const barBottom = barTop - barH;
    const baselineY = baselineCenteredInBar(barBottom, barH, fs);
    page.drawRectangle({
      x: margin,
      y: barBottom,
      width: contentW,
      height: barH,
      color: PAL.secondary,
      opacity: 0.22,
    });
    page.drawRectangle({
      x: margin,
      y: barBottom,
      width: 3,
      height: barH,
      color: PAL.primary,
    });
    page.drawText(winAnsiSafe(label).toUpperCase(), {
      x: margin + 10,
      y: baselineY,
      size: fs,
      font: fontBold,
      color: PAL.primary,
    });
    y = barBottom - 8;
  };

  const accentBarH = 5;
  const gapBelowAccent = 14;
  page.drawRectangle({
    x: 0,
    y: pageH - accentBarH,
    width: pageW,
    height: accentBarH,
    color: PAL.secondary,
  });

  const contentTopY = pageH - accentBarH - gapBelowAccent;
  const logoTopY = contentTopY;
  const logo = await tryEmbedLogo(pdf);
  const lw = logo ? 68 : 0;
  const lh = logo ? (logo.height / logo.width) * lw : 0;
  const logoBottomY = logoTopY - lh;

  if (logo) {
    page.drawImage(logo, { x: margin, y: logoBottomY, width: lw, height: lh });
  }

  const nameSize = 17;
  const tagSize = 8.5;
  const textColumnX = margin + (logo ? lw + 18 : 0);
  const nameBaselineY = logoTopY - nameSize * 0.72;
  const tagBaselineY = nameBaselineY - 14;
  const contactBaselineY = tagBaselineY - 12;

  page.drawText(COMPANY.name, {
    x: textColumnX,
    y: nameBaselineY,
    size: nameSize,
    font: fontBold,
    color: PAL.primary,
  });
  page.drawText(COMPANY.tagline, {
    x: textColumnX,
    y: tagBaselineY,
    size: tagSize,
    font,
    color: PAL.primaryMuted,
  });
  page.drawText(`${COMPANY.phone} · ${COMPANY.email}`, {
    x: textColumnX,
    y: contactBaselineY,
    size: tagSize,
    font,
    color: PAL.primaryMuted,
  });

  const textBlockLowY = contactBaselineY - 4;
  const headerLowY = lh > 0 ? Math.min(logoBottomY, textBlockLowY) : textBlockLowY;

  const rightW = 178;
  const rightX = pageW - margin - rightW;
  const panelH = 88;
  const panelTopY = contentTopY + 2;
  const panelBottomY = panelTopY - panelH;
  page.drawRectangle({
    x: rightX - 6,
    y: panelBottomY,
    width: rightW + 12,
    height: panelH,
    color: PAL.panelBg,
  });
  page.drawRectangle({
    x: rightX - 6,
    y: panelBottomY,
    width: 3,
    height: panelH,
    color: PAL.secondaryDark,
  });

  let ry = panelTopY - 16;
  page.drawText('PARTNER PRICING', { x: rightX, y: ry, size: 11, font: fontBold, color: PAL.primary });
  ry -= lineH;
  if (meta.valid_through) {
    page.drawText(`Valid through: ${String(meta.valid_through).slice(0, 10)}`, {
      x: rightX,
      y: ry,
      size: 8,
      font,
      color: PAL.lineMuted,
    });
    ry -= lineH;
  }
  if (meta.last_updated) {
    page.drawText(`Updated: ${String(meta.last_updated).slice(0, 10)}`, {
      x: rightX,
      y: ry,
      size: 8,
      font,
      color: PAL.lineMuted,
    });
    ry -= lineH;
  }
  page.drawText('Confidential partner rates', { x: rightX, y: ry, size: 8, font: fontItalic, color: PAL.lineMuted });

  y = Math.min(headerLowY - 10, panelBottomY - 8) - 12;

  page.drawText('Prepared for', { x: margin, y, size: 9, font: fontBold, color: PAL.secondaryDark });
  y -= lineH;
  page.drawText(winAnsiSafe(meta.builder_display_name || 'Partner', 80), {
    x: margin,
    y,
    size: 11,
    font: fontBold,
    color: PAL.primary,
  });
  y -= lineH + 14;

  const sections = groupServices(services);
  if (!sections.length) {
    ensureSpace(80);
    page.drawText('No services in this table.', { x: margin, y, size: 9, font, color: PAL.lineMuted });
    y -= lineH;
  }

  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    drawSectionTitle(sec.label);
    drawTableHeader();

    for (const s of sec.items) {
      ensureSpace(90);
      const rowStartY = y;
      if (s.is_locked) {
        for (const line of wrap(s.name || 'Service', svcMaxW, 9, fontBold)) {
          page.drawText(line, { x: colSvc, y: rowStartY, size: 9, font: fontBold, color: PAL.primary });
        }
        page.drawText('Contact manager', { x: colPartner, y: rowStartY, size: 8, font: fontItalic, color: PAL.lineMuted });
        y = rowStartY - lineH - 6;
        continue;
      }

      let dy = rowStartY;
      for (const line of wrap(s.name || '', svcMaxW, 9, fontBold)) {
        page.drawText(line, { x: colSvc, y: dy, size: 9, font: fontBold, color: PAL.primary });
        dy -= lineH;
      }
      page.drawText(winAnsiSafe(s.unit || 'sq ft', 24), {
        x: colUnit,
        y: rowStartY,
        size: 8.5,
        font,
        color: PAL.primary,
      });
      page.drawText(`${money(s.price_min)} - ${money(s.price_max)}`, {
        x: colPub,
        y: rowStartY,
        size: 8.5,
        font,
        color: PAL.primary,
      });
      page.drawText(money(s.partner_price), {
        x: colPartner,
        y: rowStartY,
        size: 8.5,
        font: fontBold,
        color: PAL.secondaryDark,
      });
      if (s.notes) {
        dy -= 2;
        for (const line of wrap(s.notes, svcMaxW, 7, fontItalic)) {
          ensureSpace(70);
          page.drawText(line, { x: colSvc, y: dy, size: 7, font: fontItalic, color: PAL.lineMuted });
          dy -= lineH - 2;
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

  if (volumeDiscounts.length) {
    y -= 10;
    drawSectionTitle('Volume discounts');
    ensureSpace(60);
    for (const v of volumeDiscounts) {
      ensureSpace(50);
      const label =
        v.range ||
        (v.min_sqft != null
          ? `${v.min_sqft}${v.max_sqft != null ? ` - ${v.max_sqft}` : '+'} sq ft`
          : 'Volume tier');
      const pct = v.pct ?? v.discount_pct ?? 0;
      page.drawText(winAnsiSafe(`${label}: ${pct}% off partner rate`, 120), {
        x: margin + 8,
        y,
        size: 8.5,
        font,
        color: PAL.primary,
      });
      y -= lineH + 2;
    }
  }

  y -= 8;
  ensureSpace(56);
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.75, color: PAL.secondaryDark });
  y -= 14;
  const footer =
    'Partner pricing is confidential. Rates assume standard site access and scope; formal quotes may vary. ' +
    'Contact Senior Floors for locked services or project-specific estimates.';
  for (const line of wrap(footer, contentW, 7.5)) {
    ensureSpace(40);
    page.drawText(line, { x: margin, y, size: 7.5, font, color: PAL.lineMuted });
    y -= lineH - 1;
  }

  return Buffer.from(await pdf.save());
}
