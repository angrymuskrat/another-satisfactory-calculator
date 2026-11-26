const SOLID = ['#e8a35c', '#d8cf62', '#9ccf6a', '#e2786a', '#c88fdc', '#e9b9a0', '#b5c26f', '#f0c24f', '#dc8fae', '#c4a47c'];
const FLUID = ['#71bad7', '#4f9fe0', '#8fd3f0', '#5fc6c9', '#7d9cf0', '#a4c8ff', '#49b3b8', '#6cd0e8', '#93b4e0', '#3f8fc4'];

// String hash with the murmur3 finalizer, so neighbouring ids spread over the palette.
function hash(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

/** Stable per item; fluids use a separate blue palette. */
export function itemColor(itemId: string, fluid: boolean) {
  const palette = fluid ? FLUID : SOLID;
  return palette[hash(itemId) % palette.length];
}

export const itemLineWidth = (fluid: boolean) => fluid ? 3 : 2;
