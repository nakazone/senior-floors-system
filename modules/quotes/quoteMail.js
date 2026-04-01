/**
 * Quote e-mail: Resend (API) ou SMTP (fallback).
 *
 * Resend: RESEND_API_KEY + RESEND_FROM_EMAIL (ou CRM_FROM_EMAIL como remetente).
 * SMTP: SMTP_HOST, SMTP_USER, SMTP_PASS, opcional SMTP_PORT (587), SMTP_SECURE, SMTP_FROM.
 */
import nodemailer from 'nodemailer';

function normalizeRecipient(to) {
  if (to == null) return '';
  const s = String(to).trim();
  if (!s) return '';
  if (s.includes(',')) return s.split(',')[0].trim();
  return s;
}

/** Diagnóstico sem segredos (healthcheck / CRM). */
export function getEmailTransportStatus() {
  const hasResendKey = !!process.env.RESEND_API_KEY?.trim();
  const hasResendFrom = !!(process.env.RESEND_FROM_EMAIL || process.env.CRM_FROM_EMAIL)?.trim();
  const resend = hasResendKey && hasResendFrom;
  const smtp = !!(
    process.env.SMTP_HOST?.trim() &&
    process.env.SMTP_USER?.trim() &&
    process.env.SMTP_PASS?.trim()
  );
  return {
    resend,
    smtp,
    ready: resend || smtp,
  };
}

async function sendViaResend({
  to,
  from,
  subject,
  html,
  pdfBuffer,
  filename = 'Senior-Floors-Quote.pdf',
}) {
  const key = process.env.RESEND_API_KEY?.trim();
  const fromAddr = (process.env.RESEND_FROM_EMAIL || process.env.CRM_FROM_EMAIL || '').trim();
  if (!key || !fromAddr) {
    return { ok: false, error: 'RESEND_API_KEY and RESEND_FROM_EMAIL (or CRM_FROM_EMAIL) required' };
  }

  const attachments = pdfBuffer
    ? [
        {
          filename,
          content: Buffer.isBuffer(pdfBuffer) ? pdfBuffer.toString('base64') : String(pdfBuffer),
        },
      ]
    : [];

  const body = {
    from: from || fromAddr,
    to: [to],
    subject: subject || 'Your flooring quote from Senior Floors',
    html:
      html ||
      `<p>Hello,</p><p>Please find your quote attached.</p><p>— Senior Floors</p>`,
    attachments: attachments.length ? attachments : undefined,
  };

  const replyTo = process.env.RESEND_REPLY_TO?.trim() || process.env.CRM_REPLY_TO?.trim();
  if (replyTo) body.reply_to = replyTo;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: json.message || json.name || res.statusText || 'Resend error',
      details: json,
    };
  }
  return { ok: true, id: json.id, transport: 'resend' };
}

async function sendViaSmtp({
  to,
  subject,
  html,
  pdfBuffer,
  filename = 'Senior-Floors-Quote.pdf',
}) {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !user || !pass) {
    return { ok: false, error: 'SMTP_HOST, SMTP_USER and SMTP_PASS required' };
  }

  const port = parseInt(process.env.SMTP_PORT || '587', 10) || 587;
  const secure =
    process.env.SMTP_SECURE === '1' ||
    process.env.SMTP_SECURE === 'true' ||
    String(port) === '465';

  const from =
    process.env.SMTP_FROM?.trim() ||
    process.env.CRM_FROM_EMAIL?.trim() ||
    `"Senior Floors" <${user}>`;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false' },
  });

  const attachments = pdfBuffer
    ? [
        {
          filename,
          content: Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer),
          contentType: 'application/pdf',
        },
      ]
    : [];

  const info = await transporter.sendMail({
    from,
    to,
    subject: subject || 'Your flooring quote from Senior Floors',
    html:
      html ||
      `<p>Hello,</p><p>Please find your quote attached.</p><p>— Senior Floors</p>`,
    attachments,
  });

  return {
    ok: true,
    id: info.messageId || `smtp-${Date.now()}`,
    transport: 'smtp',
  };
}

/**
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} [opts.subject]
 * @param {string} [opts.html]
 * @param {Buffer} [opts.pdfBuffer]
 * @param {string} [opts.filename]
 * @param {string} [opts.publicUrl] — incluído no HTML quando html não é passado (legado)
 */
export async function sendQuoteEmail({
  to,
  subject,
  html,
  pdfBuffer,
  filename = 'Senior-Floors-Quote.pdf',
  publicUrl,
}) {
  const recipient = normalizeRecipient(to);
  if (!recipient) {
    return { ok: false, error: 'Recipient email required' };
  }

  const defaultHtml = `<p>Hello,</p><p>Please find your quote attached. You can also view and approve it online${
    publicUrl ? `: <a href="${publicUrl}">${publicUrl}</a>` : '.'
  }</p><p>— Senior Floors</p>`;

  const finalHtml = html != null && String(html).trim() !== '' ? html : defaultHtml;

  const { resend, smtp, ready } = getEmailTransportStatus();
  if (!ready) {
    return {
      ok: false,
      error:
        'E-mail não configurado no servidor. Defina RESEND_API_KEY + RESEND_FROM_EMAIL, ou SMTP_HOST + SMTP_USER + SMTP_PASS (ver env.example). Teste GET /api/health/email.',
    };
  }

  const smtpPayload = {
    to: recipient,
    subject,
    html: finalHtml,
    pdfBuffer,
    filename,
  };

  if (resend) {
    const out = await sendViaResend({
      to: recipient,
      from: undefined,
      subject,
      html: finalHtml,
      pdfBuffer,
      filename,
    });
    if (out.ok || !smtp) return out;
    console.warn('[quoteMail] Resend falhou, a tentar SMTP:', out.error);
  }

  return sendViaSmtp(smtpPayload);
}
