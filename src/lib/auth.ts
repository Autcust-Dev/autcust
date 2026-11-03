import { jwtVerify } from 'jose';
import type { AstroCookies } from 'astro';
import { getEnv } from './env';

export function getJwtSecret(): string {
  const secret = getEnv('JWT_SECRET');
  if (secret) return secret;
  if (import.meta.env.DEV) return 'fallback_secret_for_dev_only';
  // Never sign/verify admin sessions with a publicly known key in production.
  throw new Error('JWT_SECRET is not configured');
}

export async function hashString(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyAdminSession(request: Request, cookies: AstroCookies): Promise<boolean> {
  const sessionCookie = cookies.get('admin_session');
  if (!sessionCookie) return false;

  try {
    const secret = new TextEncoder().encode(getJwtSecret());
    const { payload } = await jwtVerify(sessionCookie.value, secret);
    
    const userAgent = request.headers.get('user-agent') || 'unknown';
    const fingerprint = await hashString(userAgent);

    if (payload.fingerprint !== fingerprint) {
      return false; // Possible session hijack
    }

    return true;
  } catch (err) {
    return false;
  }
}
