import { gunzipSync } from 'node:zlib';

export function decodeDocs(raw) {
  const groups = JSON.parse(gunzipSync(raw).toString('utf16le').replace(/^\uFEFF/, ''));
  return groups.flatMap(group => group.Classes.map(entry => ({ ...entry, nativeClass: group.NativeClass })));
}

export function parseIngredients(text) {
  return [...text.matchAll(/ItemClass="[^"]*\.([A-Za-z0-9_]+)'",Amount=([\d.]+)/g)]
    .map(([, className, amount]) => ({ className, amount: Number(amount) }));
}
