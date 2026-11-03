import { WorkerMailer } from 'worker-mailer';
import { getEnv } from './env';

/**
 * Send an email over SMTP using Cloudflare Workers TCP sockets (nodemailer does not run on Workers).
 *
 * Secrets: SMTP_HOST, SMTP_PORT (465 = implicit TLS, 587 = STARTTLS), SMTP_USER, SMTP_PASS,
 * and optionally EMAIL_FROM (e.g. "Admin Dashboard <you@autcust.com>"; defaults to SMTP_USER).
 * Note: Cloudflare blocks outbound port 25.
 *
 * Returns false if SMTP is not configured.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<boolean> {
  const host = getEnv('SMTP_HOST');
  const user = getEnv('SMTP_USER');
  const pass = getEnv('SMTP_PASS');
  if (!host || !user || !pass) return false;

  const port = parseInt(getEnv('SMTP_PORT') || '587', 10);
  const from = parseAddress(getEnv('EMAIL_FROM') || `Admin Dashboard <${user}>`);

  await WorkerMailer.send(
    {
      host,
      port,
      secure: port === 465,
      startTls: port !== 465,
      credentials: { username: user, password: pass },
      authType: ['plain', 'login'],
    },
    {
      from,
      to: { email: opts.to },
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    },
  );
  return true;
}

/** Parse `Name <email@x.com>` or a bare `email@x.com`. */
function parseAddress(value: string): { name?: string; email: string } {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return match ? { name: match[1] || undefined, email: match[2].trim() } : { email: value.trim() };
}
