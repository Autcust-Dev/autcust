/**
 * TorrentXDesk release info, sourced from the latest GitHub release.
 * Files are streamed to users from autcust.com (see src/pages/download/torrentxdesk/[file].ts),
 * so visitors never leave the site.
 */

const REPO = 'thetitanreddy/TorrentXDesk';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const MANIFEST_URL = `https://github.com/${REPO}/releases/latest/download/latest.json`;
const RELEASE_DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
const SITE_DOWNLOAD_BASE = 'https://autcust.com/download/torrentxdesk';
const CACHE_MS = 5 * 60 * 1000;

export type Platform = 'windows' | 'linux';

export interface FileSpec {
  id: 'exe' | 'msi' | 'deb' | 'rpm' | 'tar';
  name: string;
  platform: Platform;
  label: string;
  contentType: string;
}

/** The only files that can be downloaded through autcust.com. */
export const FILES: FileSpec[] = [
  { id: 'exe', name: 'TorrentXDesk-Setup.exe', platform: 'windows', label: 'Windows installer (.exe)', contentType: 'application/vnd.microsoft.portable-executable' },
  { id: 'msi', name: 'TorrentXDesk-Setup.msi', platform: 'windows', label: 'Windows MSI package (.msi)', contentType: 'application/x-msi' },
  { id: 'deb', name: 'TorrentXDesk-linux-amd64.deb', platform: 'linux', label: 'Debian / Ubuntu package (.deb)', contentType: 'application/vnd.debian.binary-package' },
  { id: 'rpm', name: 'TorrentXDesk-linux-x86_64.rpm', platform: 'linux', label: 'Fedora / openSUSE package (.rpm)', contentType: 'application/x-rpm' },
  { id: 'tar', name: 'TorrentXDesk-linux-x64.tar.gz', platform: 'linux', label: 'Portable archive (.tar.gz)', contentType: 'application/gzip' },
];

export interface ReleaseFile extends FileSpec {
  /** Upstream GitHub release asset URL */
  upstream: string;
  size?: number;
  sha256?: string;
}

export interface Release {
  version: string;
  tag: string;
  notes?: string;
  /** ISO date the release was published (from the GitHub API, if available) */
  publishedAt?: string;
  files: ReleaseFile[];
}

export interface ReleaseManifest {
  version: string;
  url: string;
  msiUrl?: string;
  sha256?: string;
  size?: number;
  notes?: string;
  [key: string]: unknown;
}

let releaseCache: { release: Release; fetchedAt: number } | null = null;
let manifestCache: { manifest: ReleaseManifest; fetchedAt: number } | null = null;

export async function getLatestManifest(): Promise<ReleaseManifest> {
  if (manifestCache && Date.now() - manifestCache.fetchedAt < CACHE_MS) return manifestCache.manifest;
  const res = await fetch(MANIFEST_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to fetch TorrentXDesk manifest: ${res.status}`);
  const manifest = (await res.json()) as ReleaseManifest;
  if (!manifest.version || !manifest.url) throw new Error('Invalid TorrentXDesk manifest');
  manifestCache = { manifest, fetchedAt: Date.now() };
  return manifest;
}

/** Release details from the GitHub API (sizes + checksums), falling back to latest.json. */
export async function getLatestRelease(): Promise<Release> {
  if (releaseCache && Date.now() - releaseCache.fetchedAt < CACHE_MS) return releaseCache.release;

  let release: Release | null = null;
  let manifest: ReleaseManifest | null = null;
  try {
    manifest = await getLatestManifest();
  } catch (e) {
    console.error('TorrentXDesk manifest error:', e instanceof Error ? e.message : e);
  }

  try {
    const res = await fetch(API_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'autcust.com-downloads' },
      // Cache at Cloudflare's edge to stay well under GitHub's API rate limit.
      cf: { cacheTtl: 300, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const json = (await res.json()) as {
      tag_name: string;
      published_at?: string | null;
      assets: { name: string; size: number; digest?: string | null }[];
    };
    const tag = json.tag_name;
    const files: ReleaseFile[] = [];
    for (const spec of FILES) {
      const asset = json.assets.find((a) => a.name === spec.name);
      if (!asset) continue;
      files.push({
        ...spec,
        upstream: `${RELEASE_DOWNLOAD_PREFIX}${encodeURIComponent(tag)}/${encodeURIComponent(spec.name)}`,
        size: asset.size,
        sha256: asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : undefined,
      });
    }
    release = {
      version: manifest?.version ?? tag.replace(/^v/, ''),
      tag,
      notes: manifest?.notes,
      publishedAt: json.published_at ?? undefined,
      files,
    };
  } catch (e) {
    console.error('TorrentXDesk GitHub API error:', e instanceof Error ? e.message : e);
  }

  if (!release) {
    if (!manifest) throw new Error('TorrentXDesk release information unavailable');
    // Fallback: no sizes/checksums for files other than the .exe.
    const tag = manifest.url.startsWith(RELEASE_DOWNLOAD_PREFIX)
      ? decodeURIComponent(manifest.url.slice(RELEASE_DOWNLOAD_PREFIX.length).split('/')[0])
      : `v${manifest.version}`;
    release = {
      version: manifest.version,
      tag,
      notes: manifest.notes,
      files: FILES.map((spec) => ({
        ...spec,
        upstream: `${RELEASE_DOWNLOAD_PREFIX}${encodeURIComponent(tag)}/${encodeURIComponent(spec.name)}`,
        size: spec.id === 'exe' ? manifest!.size : undefined,
        sha256: spec.id === 'exe' ? manifest!.sha256 : undefined,
      })),
    };
  }

  releaseCache = { release, fetchedAt: Date.now() };
  return release;
}

/** Public URL path for a file on this site. */
export function sitePath(fileName: string): string {
  return `/download/torrentxdesk/${encodeURIComponent(fileName)}`;
}

/** latest.json with download URLs rewritten to point at autcust.com (for the in-app updater). */
export function siteManifest(manifest: ReleaseManifest): ReleaseManifest {
  const rewrite = (url?: string) =>
    url && url.startsWith(RELEASE_DOWNLOAD_PREFIX)
      ? `${SITE_DOWNLOAD_BASE}/${url.substring(url.lastIndexOf('/') + 1)}`
      : url;
  return { ...manifest, url: rewrite(manifest.url)!, msiUrl: rewrite(manifest.msiUrl) };
}

export function formatSize(bytes?: number): string | null {
  if (!bytes) return null;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
