import type { APIRoute } from 'astro';
import { db } from '../lib/firebase';

const SITE_URL = 'https://autcust.com';

export const GET: APIRoute = async () => {
  try {
    const urls = [];
    
    // Add static pages
    urls.push(`${SITE_URL}/`);
    urls.push(`${SITE_URL}/download/torrentxdesk`);
    
    // Fetch apps
    const appsSnapshot = await db.collection('apps').get();
    appsSnapshot.forEach((doc) => {
      urls.push(`${SITE_URL}/apps/${doc.id}`);
    });

    // Fetch policies
    const policiesSnapshot = await db.collection('policies').get();
    policiesSnapshot.forEach((doc) => {
      urls.push(`${SITE_URL}/policies/${doc.id}`);
    });

    // Fetch docs
    const docsSnapshot = await db.collection('docs').get();
    docsSnapshot.forEach((doc) => {
      urls.push(`${SITE_URL}/docs/${doc.id}`);
    });

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls.map((url) => `
  <url>
    <loc>${url}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`).join('')}
</urlset>`;

    return new Response(sitemap.trim(), {
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=3600'
      },
    });
  } catch (error) {
    console.error('Error generating sitemap:', error);
    return new Response('Error generating sitemap', { status: 500 });
  }
};
