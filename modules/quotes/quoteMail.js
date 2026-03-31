/**
 * Send quote email via Resend HTTP API (no extra npm dep beyond fetch).
 * Set RESEND_API_KEY and RESEND_FROM_EMAIL in env.
 */

export async function sendQuoteEmail({
  to,
  subject,
  html,
  pdfBuffer,
  filename = 'Senior-Floors-Quote.pdf',
  publicUrl,
}) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || process.env.CRM_FROM_EMAIL;
  if (!key || !from) {
    return { ok: false, error: 'RESEND_API_KEY or RESEND_FROM_EMAIL not configured' };
  }
  if (!to) {
    return { ok: false, error: 'Recipient email required' };
  }

  const attachments = pdfBuffer
    ? [
        {
          filename,
          content: Buffer.isBuffer(pdfBuffer) ? pdfBuffer.toString('base64') : pdfBuffer,
        },
      ]
    : [];

  const body = {
    from,
    to: [to],
    subject: subject || 'Your flooring quote from Senior Floors',
    html:
      html ||
      `<p>Hello,</p><p>Please find your quote attached. You can also view and approve it online${
        publicUrl ? `: <a href="${publicUrl}">${publicUrl}</a>` : '.'
      }</p><p>— Senior Floors</p>`,
    attachments: attachments.length ? attachments : undefined,
  };

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
    return { ok: false, error: json.message || res.statusText || 'Resend error', details: json };
  }
  return { ok: true, id: json.id };
}
