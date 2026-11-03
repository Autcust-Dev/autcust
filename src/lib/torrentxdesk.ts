/**
 * TorrentXDesk release info, sourced from the latest GitHub release's `latest.json` manifest.
 * Files are streamed to users from autcust.com (see src/pages/download/torrentxdesk/[file].ts),
 * so visitors never leave the site.
 */

const REPO = 'thetitanreddy/TorrentXDesk';
const MANIFEST_URL = `https://github.com/${REPO}/releases/latest/download/latest.json`;
const ALLOWED_PREFIX = `https://github.com/${REPO}/releases/download/`;
const SITE_DOWNLOAD_BASE = 'https://autcust.com/download/torrentxdesk';
const CACHE_MS = 5 * 60 * 1000;

export interface ReleaseManifest {
  version: string;
  url: string;
  msiUrl?: string;
  sha256?: string;
  size?: number;
  notes?: string;
  [key: string]: unknown;
}

export interface DownloadFile {
  /** File name as served from autcust.com */
  name: string;
  /** Upstream GitHub release asset URL */
  upstream: string;
  contentType: string;
}

let cache: { manifest: ReleaseManifest; fetchedAt: number } | null = null;

export async function getLatestRelease(): Promise<ReleaseManifest> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.manifest;

  const res = await fetch(MANIFEST_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to fetch TorrentXDesk manifest: ${res.status}`);
  const manifest = (await res.json()) as ReleaseManifest;
  if (!manifest.version || !manifest.url) throw new Error('Invalid TorrentXDesk manifest');

  cache = { manifest, fetchedAt: Date.now() };
  return manifest;
}

function fileNameFromUrl(url: string): string {
  return decodeURIComponent(url.substring(url.lastIndexOf('/') + 1));
}

/** The installer files offered for download, keyed by their public file name. */
export function getDownloadFiles(manifest: ReleaseManifest): DownloadFile[] {
  const files: DownloadFile[] = [];
  const add = (upstream: string | undefined, contentType: string) => {
    // Only ever proxy assets from this repo's releases.
    if (upstream && upstream.startsWith(ALLOWED_PREFIX)) {
      files.push({ name: fileNameFromUrl(upstream), upstream, contentType });
    }
  };
  add(manifest.url, 'application/vnd.microsoft.portable-executable');
  add(manifest.msiUrl, 'application/x-msi');
  return files;
}

/** Public URL path for a file on this site. */
export function sitePath(fileName: string): string {
  return `/download/torrentxdesk/${encodeURIComponent(fileName)}`;
}

/** The manifest with download URLs rewritten to point at autcust.com (for the in-app updater). */
export function siteManifest(manifest: ReleaseManifest): ReleaseManifest {
  const rewrite = (url?: string) =>
    url && url.startsWith(ALLOWED_PREFIX) ? `${SITE_DOWNLOAD_BASE}/${encodeURIComponent(fileNameFromUrl(url))}` : url;
  return { ...manifest, url: rewrite(manifest.url)!, msiUrl: rewrite(manifest.msiUrl) };
}

export function formatSize(bytes?: number): string | null {
  if (!bytes) return null;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
