import type { APIRoute } from 'astro';
import { getLatestRelease, getLatestManifest, FILES } from '../../../lib/torrentxdesk';

export const prerender = false;

/** Windows is distributed only through the Microsoft Store. */
const MS_STORE_PAGE = 'https://apps.microsoft.com/detail/9N8D2ZTD7QBD';

/**
 * Serves TorrentXDesk Linux packages from autcust.com by streaming them from the latest GitHub release.
 *   /download/torrentxdesk/TorrentXDesk-linux-amd64.deb | -x86_64.rpm | -x64.tar.gz
 *   /download/torrentxdesk/TorrentXDesk-Setup.exe | .msi  → redirect to the Microsoft Store listing
 *   /download/torrentxdesk/latest.json   (update manifest, as published on GitHub)
 */
export const ALL: APIRoute = async ({ params, request }) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const requested = params.file ?? '';
  const unavailable = () =>
    new Response('Download temporarily unavailable. Please try again shortly.', { status: 503 });

  if (requested === 'latest.json') {
    try {
      const manifest = await getLatestManifest();
      // Served unchanged: the Windows download links in it point at GitHub, not at the redirect below.
      return new Response(JSON.stringify(manifest, null, 2), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      });
    } catch (e) {
      console.error('TorrentXDesk manifest error:', e instanceof Error ? e.message : e);
      return unavailable();
    }
  }

  // Old direct Windows download links now go to the Microsoft Store.
  if (FILES.some((f) => f.name === requested && f.platform === 'windows')) {
    return Response.redirect(MS_STORE_PAGE, 301);
  }

  // Only known file names can ever be proxied.
  if (!FILES.some((f) => f.name === requested)) return new Response('Not Found', { status: 404 });

  let file;
  try {
    file = (await getLatestRelease()).files.find((f) => f.name === requested);
  } catch (e) {
    console.error('TorrentXDesk release error:', e instanceof Error ? e.message : e);
    return unavailable();
  }
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
