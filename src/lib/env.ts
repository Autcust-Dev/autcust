import { env as workerEnv } from 'cloudflare:workers';

/**
 * Read a runtime variable/secret from the Cloudflare Worker environment.
 * Set these in the Cloudflare dashboard (Worker → Settings → Variables and Secrets)
 * or locally in `.dev.vars`.
 */
export function getEnv(name: string): string | undefined {
  const value = (workerEnv as unknown as Record<string, unknown>)[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
