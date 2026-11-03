/**
 * Minimal Firestore client built on the Firestore REST API.
 *
 * `firebase-admin` depends on Node.js internals and gRPC, which are not available on
 * Cloudflare Workers. This module exposes the small subset of the admin SDK API that the
 * site uses (`db.collection(c).get()`, `db.collection(c).doc(id).get/set/delete`) on top of
 * `fetch`, authenticating with the same service account credentials.
 */
import { SignJWT, importPKCS8 } from 'jose';
import { getEnv } from './env';

const PRIVATE_KEY_ID = '2c5e22e9d3363f1b439f518d6b09c261baffd7f4';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';

type FirestoreValue = Record<string, any>;
type DocumentData = Record<string, any>;

// ---------- Auth ----------

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.token;
  }

  const clientEmail = getEnv('FIREBASE_CLIENT_EMAIL');
  const privateKeyRaw = getEnv('FIREBASE_PRIVATE_KEY');
  if (!clientEmail || !privateKeyRaw) {
    throw new Error('FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are not configured');
  }

  const privateKey = await importPKCS8(privateKeyRaw.replace(/\\n/g, '\n'), 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: PRIVATE_KEY_ID })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience(TOKEN_URI)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const res = await fetch(TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to obtain Google access token: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

// ---------- Value encoding ----------

function encodeValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === 'object') return { mapValue: { fields: encodeFields(value as DocumentData) } };
  throw new Error(`Unsupported Firestore value type: ${typeof value}`);
}

function encodeFields(data: DocumentData): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) fields[key] = encodeValue(val);
  }
  return fields;
}

function decodeValue(value: FirestoreValue): any {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {});
  if ('referenceValue' in value) return value.referenceValue;
  if ('bytesValue' in value) return value.bytesValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  return undefined;
}

function decodeFields(fields: Record<string, FirestoreValue>): DocumentData {
  const data: DocumentData = {};
  for (const [key, val] of Object.entries(fields)) data[key] = decodeValue(val);
  return data;
}

/** Quote a field path segment for updateMask if it isn't a simple identifier. */
function fieldPath(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    ? key
    : '`' + key.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
}

// ---------- HTTP ----------

function baseUrl(): string {
  const projectId = getEnv('FIREBASE_PROJECT_ID');
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not configured');
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function firestoreFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${baseUrl()}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

async function ensureOk(res: Response, action: string): Promise<void> {
  if (!res.ok) throw new Error(`Firestore ${action} failed: ${res.status} ${await res.text()}`);
}

// ---------- Public API (admin-SDK compatible subset) ----------

export class DocumentSnapshot {
  constructor(
    public readonly id: string,
    private readonly _data: DocumentData | undefined,
  ) {}

  get exists(): boolean {
    return this._data !== undefined;
  }

  data(): DocumentData | undefined {
    return this._data;
  }
}

export class QuerySnapshot {
  constructor(public readonly docs: DocumentSnapshot[]) {}

  get empty(): boolean {
    return this.docs.length === 0;
  }

  get size(): number {
    return this.docs.length;
  }

  forEach(cb: (doc: DocumentSnapshot) => void): void {
    this.docs.forEach(cb);
  }
}

function idFromName(name: string): string {
  return decodeURIComponent(name.substring(name.lastIndexOf('/') + 1));
}

export class DocumentReference {
  constructor(
    private readonly collectionId: string,
    public readonly id: string,
  ) {}

  private get path(): string {
    return `${encodeURIComponent(this.collectionId)}/${encodeURIComponent(this.id)}`;
  }

  async get(): Promise<DocumentSnapshot> {
    const res = await firestoreFetch(this.path);
    if (res.status === 404) return new DocumentSnapshot(this.id, undefined);
    await ensureOk(res, 'get');
    const json = (await res.json()) as { fields?: Record<string, FirestoreValue> };
    return new DocumentSnapshot(this.id, decodeFields(json.fields ?? {}));
  }

  async set(data: DocumentData, options: { merge?: boolean } = {}): Promise<void> {
    let query = '';
    if (options.merge) {
      const params = new URLSearchParams();
      for (const key of Object.keys(data)) {
        if (data[key] !== undefined) params.append('updateMask.fieldPaths', fieldPath(key));
      }
      query = `?${params.toString()}`;
    }
    const res = await firestoreFetch(`${this.path}${query}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: encodeFields(data) }),
    });
    await ensureOk(res, 'set');
  }

  async delete(): Promise<void> {
    const res = await firestoreFetch(this.path, { method: 'DELETE' });
    if (res.status === 404) return;
    await ensureOk(res, 'delete');
  }
}

export class CollectionReference {
  constructor(private readonly id: string) {}

  doc(docId: string): DocumentReference {
    return new DocumentReference(this.id, docId);
  }

  async get(): Promise<QuerySnapshot> {
    const docs: DocumentSnapshot[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ pageSize: '300' });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await firestoreFetch(`${encodeURIComponent(this.id)}?${params.toString()}`);
      await ensureOk(res, 'list');
      const json = (await res.json()) as {
        documents?: { name: string; fields?: Record<string, FirestoreValue> }[];
        nextPageToken?: string;
      };
      for (const d of json.documents ?? []) {
        docs.push(new DocumentSnapshot(idFromName(d.name), decodeFields(d.fields ?? {})));
      }
      pageToken = json.nextPageToken;
    } while (pageToken);
    return new QuerySnapshot(docs);
  }
}

export const db = {
  collection(id: string): CollectionReference {
    return new CollectionReference(id);
  },
};
