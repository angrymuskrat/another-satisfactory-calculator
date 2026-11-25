import { parsePlannerPlan } from '../../../packages/domain/plannerCompatibility';
import type { Catalog, Plan } from '../../../packages/domain/types';
import { parseCatalogPlan } from './planStorage';

const prefix = '#order=';
const version = '1';
const maxEncodedLength = 64 * 1024;
const maxSnapshotBytes = 1024 * 1024;
const tooLarge = 'Заказ слишком большой для ссылки. Используйте экспорт плана в JSON.';
const damaged = 'Ссылка на заказ повреждена. Скопируйте её целиком.';

export async function createOrderLink(plan: Plan, baseUrl: string): Promise<string> {
  const json = JSON.stringify(parsePlannerPlan(plan));
  const snapshot = new Blob([json]);
  if (snapshot.size > maxSnapshotBytes) throw new Error(tooLarge);

  let format = 'json';
  let bytes: Uint8Array;
  if (typeof CompressionStream === 'function') {
    format = 'gz';
    const compressed = snapshot.stream().pipeThrough(new CompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
  } else {
    bytes = new Uint8Array(await snapshot.arrayBuffer());
  }
  if (Math.ceil(bytes.length * 4 / 3) > maxEncodedLength) throw new Error(tooLarge);
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  const payload = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const url = new URL(baseUrl);
  return `${url.origin}${url.pathname}${prefix}${version}.${format}.${payload}`;
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Этот браузер не поддерживает сжатые ссылки. Откройте ссылку в обновлённом браузере или попросите файл плана в JSON.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read().catch(() => { throw new Error(damaged); });
      if (done) break;
      size += value.length;
      if (size > maxSnapshotBytes) {
        await reader.cancel();
        throw new Error(tooLarge);
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

export async function readOrderLink(hash: string, catalog: Catalog): Promise<Plan> {
  if (!hash.startsWith(prefix)) throw new Error('В ссылке отсутствует заказ.');
  if (hash.length > prefix.length + '1.json.'.length + maxEncodedLength) throw new Error(tooLarge);
  const [linkVersion, format, payload, extra] = hash.slice(prefix.length).split('.');
  if (linkVersion !== version) throw new Error('Эта версия ссылки на заказ не поддерживается.');
  if (format !== 'gz' && format !== 'json') throw new Error('Неизвестный формат ссылки на заказ.');
  if (!payload || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error(damaged);
  if (payload.length > maxEncodedLength) throw new Error(tooLarge);

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const binary = atob(payload.replaceAll('-', '+').replaceAll('_', '/'));
    bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch {
    throw new Error(damaged);
  }
  const snapshot = format === 'gz' ? await inflate(bytes) : bytes;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(snapshot));
  } catch {
    throw new Error(damaged);
  }
  return parseCatalogPlan(value, catalog);
}
