export const prerender = false;

import type { APIRoute } from 'astro';
import { SignJWT } from 'jose';
import { db } from '../../../lib/firebase';
import { hashString, getJwtSecret } from '../../../lib/auth';
import { getEnv } from '../../../lib/env';

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const csrfTokenHeader = request.headers.get('x-csrf-token');
    const csrfTokenCookie = cookies.get('csrf_token')?.value;

    if (!csrfTokenHeader || !csrfTokenCookie || csrfTokenHeader !== csrfTokenCookie) {
      return new Response(JSON.stringify({ error: 'CSRF token mismatch' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await request.json();
    const providedOtp = data.otp;

    const adminEmail = getEnv('ADMIN_EMAIL');
    if (!adminEmail) {
      return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500 });
    }

    const otpRef = db.collection('otps').doc(adminEmail);
    const otpDoc = await otpRef.get();

    if (!otpDoc.exists) {
      return new Response(JSON.stringify({ error: 'OTP expired or missing' }), { status: 400 });
    }

    const otpData = otpDoc.data();
    if (!otpData) {
      return new Response(JSON.stringify({ error: 'OTP data corrupted' }), { status: 400 });
    }

    // Check expiration (handle both Firestore Timestamp and JS Date formats just in case)
    const expiresAt = otpData.expiresAt?.toDate ? otpData.expiresAt.toDate() : new Date(otpData.expiresAt);
    if (new Date() > expiresAt) {
      await otpRef.delete(); // cleanup
      return new Response(JSON.stringify({ error: 'OTP expired' }), { status: 400 });
    }

    if (otpData.otp !== providedOtp) {
      return new Response(JSON.stringify({ error: 'Invalid OTP' }), { status: 400 });
    }

    // OTP is valid. Delete from Firebase to save space
    await otpRef.delete();

      // Create session JWT
      const secret = new TextEncoder().encode(getJwtSecret());

      const userAgent = request.headers.get('user-agent') || 'unknown';
      const fingerprint = await hashString(userAgent);

      const sessionJwt = await new SignJWT({ admin: true, fingerprint })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('24h')
        .sign(secret);

      cookies.set('admin_session', sessionJwt, {
        path: '/',
        httpOnly: true,
        secure: import.meta.env.PROD,
        sameSite: 'strict',
        maxAge: 60 * 60 * 24, // 24 hours
      });

      return new Response(JSON.stringify({ success: true, message: 'Logged in successfully' }), { status: 200 });
  } catch (error) {
    console.error('Verify OTP Error:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
};
