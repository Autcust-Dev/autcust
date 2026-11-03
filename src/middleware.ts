import { defineMiddleware } from 'astro:middleware';

// Security headers (previously configured in vercel.json).
// public/_headers only applies to static assets, so server-rendered responses get them here.
const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export const onRequest = defineMiddleware(async (_context, next) => {
  let response = await next();
  try {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
  } catch {
    // Headers are immutable (e.g. on some redirects) — clone the response.
    response = new Response(response.body, response);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
  }
  return response;
});
