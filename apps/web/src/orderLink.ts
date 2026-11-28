import { parsePlannerPlan } from '../../../packages/domain/plannerCompatibility';
import type { Catalog, Plan } from '../../../packages/domain/types';
import type { Messages } from './i18n';
import { parseCatalogPlan } from './planStorage';

const prefix = '#order=';
const version = '1';
const maxEncodedLength = 64 * 1024;
const maxSnapshotBytes = 1024 * 1024;

export async function createOrderLink(plan: Plan, baseUrl: string, t: Messages): Promise<string> {
  const json = JSON.stringify(parsePlannerPlan(plan));
  const snapshot = new Blob([json]);
  if (snapshot.size > maxSnapshotBytes) throw new Error(t.orderLink.tooLarge);

  let format = 'json';
  let bytes: Uint8Array;
  if (typeof CompressionStream === 'function') {
    format = 'gz';
    const compressed = snapshot.stream().pipeThrough(new CompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
  } else {
    bytes = new Uint8Array(await snapshot.arrayBuffer());
  }
  if (Math.ceil(bytes.length * 4 / 3) > maxEncodedLength) throw new Error(t.orderLink.tooLarge);
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  const payload = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const url = new URL(baseUrl);
  return `${url.origin}${url.pathname}${prefix}${version}.${format}.${payload}`;
}

async function inflate(bytes: Uint8Array<ArrayBuffer>, t: Messages): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new Error(t.orderLink.noDecompression);
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read().catch(() => { throw new Error(t.orderLink.damaged); });
      if (done) break;
      size += value.length;
      if (size > maxSnapshotBytes) {
        await reader.cancel();
        throw new Error(t.orderLink.tooLarge);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const snapshot = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    snapshot.set(chunk, offset);
    offset += chunk.length;
  }
  return snapshot;
}

export async function readOrderLink(hash: string, catalog: Catalog, t: Messages): Promise<Plan> {
  if (!hash.startsWith(prefix)) throw new Error(t.orderLink.missingOrder);
  if (hash.length > prefix.length + '1.json.'.length + maxEncodedLength) throw new Error(t.orderLink.tooLarge);
  const [linkVersion, format, payload, extra] = hash.slice(prefix.length).split('.');
  if (linkVersion !== version) throw new Error(t.orderLink.unsupportedVersion);
  if (format !== 'gz' && format !== 'json') throw new Error(t.orderLink.unknownFormat);
  if (!payload || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error(t.orderLink.damaged);
  if (payload.length > maxEncodedLength) throw new Error(t.orderLink.tooLarge);

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const binary = atob(payload.replaceAll('-', '+').replaceAll('_', '/'));
    bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch {
    throw new Error(t.orderLink.damaged);
  }
  const snapshot = format === 'gz' ? await inflate(bytes, t) : bytes;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(snapshot));
  } catch {
    throw new Error(t.orderLink.damaged);
  }
  return parseCatalogPlan(value, catalog);
}
