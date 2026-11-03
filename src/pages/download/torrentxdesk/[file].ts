import type { APIRoute } from 'astro';
import { getLatestRelease, getDownloadFiles, siteManifest } from '../../../lib/torrentxdesk';

export const prerender = false;

/**
 * Serves TorrentXDesk installers from autcust.com by streaming them from the latest GitHub release.
 *   /download/torrentxdesk/TorrentXDesk-Setup.exe
 *   /download/torrentxdesk/TorrentXDesk-Setup.msi
 *   /download/torrentxdesk/latest.json   (update manifest with autcust.com URLs)
 */
export const ALL: APIRoute = async ({ params, request }) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  let manifest;
  try {
    manifest = await getLatestRelease();
  } catch (e) {
    console.error('TorrentXDesk manifest error:', e instanceof Error ? e.message : e);
    return new Response('Download temporarily unavailable. Please try again shortly.', { status: 503 });
  }

  const requested = params.file ?? '';

  if (requested === 'latest.json') {
    return new Response(JSON.stringify(siteManifest(manifest), null, 2), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  }

  const file = getDownloadFiles(manifest).find((f) => f.name === requested);
  if (!file) return new Response('Not Found', { status: 404 });

  // Pass Range through so downloads can resume.
  const upstreamHeaders: Record<string, string> = { 'User-Agent': 'autcust.com-downloads' };
  const range = request.headers.get('range');
  if (range) upstreamHeaders.Range = range;

  const upstream = await fetch(file.upstream, { headers: upstreamHeaders, redirect: 'follow' });
  if (!upstream.ok && upstream.status !== 206 && upstream.status !== 416) {
    console.error(`TorrentXDesk upstream error ${upstream.status} for ${file.name}`);
    await upstream.body?.cancel();
    return new Response('Download temporarily unavailable. Please try again shortly.', { status: 502 });
  }

  const headers = new Headers({
    'Content-Type': file.contentType,
    'Content-Disposition': `attachment; filename="${file.name}"`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const h of ['Content-Length', 'Content-Range', 'ETag', 'Last-Modified']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }

  if (request.method === 'HEAD') {
    await upstream.body?.cancel();
    return new Response(null, { status: upstream.status, headers });
  }

  return new Response(upstream.body, { status: upstream.status, headers });
};
