export const prerender = false;

import type { APIRoute } from 'astro';
import { db } from '../../../lib/firebase';
import { sendEmail } from '../../../lib/email';
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

    const adminEmail = getEnv('ADMIN_EMAIL');

    if (!adminEmail) {
      console.warn("ADMIN_EMAIL is not set in environment variables.");
      return new Response(JSON.stringify({ error: 'Server configuration error' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    const sent = await sendEmail({
      to: adminEmail,
      subject: 'Your Admin Dashboard OTP',
      text: `Your one-time password is: ${otp}. It will expire in 5 minutes.`,
      html: `<p>Your one-time password is: <strong>${otp}</strong></p><p>It will expire in 5 minutes.</p>`,
    });

    if (!sent) {
      // Fallback for development/testing if SMTP is not configured
      console.log('====================================');
      console.log(`DEVELOPMENT MODE - OTP for ${adminEmail}: ${otp}`);
      console.log('====================================');
    }

    // Save OTP to Firebase
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    await db.collection('otps').doc(adminEmail).set({
      otp,
      expiresAt
    });

    return new Response(JSON.stringify({ success: true, message: 'OTP sent' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Request OTP Error:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
