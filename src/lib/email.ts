import { getEnv } from './env';

/**
 * Send an email via the Resend HTTP API (https://resend.com).
 * SMTP (nodemailer) is not available on Cloudflare Workers, so an HTTP-based provider is used.
 *
 * Required secrets: RESEND_API_KEY, EMAIL_FROM (e.g. "Admin Dashboard <noreply@autcust.com>").
 * Returns false if email is not configured.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<boolean> {
  const apiKey = getEnv('RESEND_API_KEY');
  const from = getEnv('EMAIL_FROM');
  if (!apiKey || !from) return false;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, text: opts.text, html: opts.html }),
  });

  if (!res.ok) {
    throw new Error(`Failed to send email: ${res.status} ${await res.text()}`);
  }
  return true;
}
