// Muted world tones: orange, status green, amber and red stay reserved for actions and states.
const SOLID = ['#cdbb9c', '#a89886', '#ddd2bf', '#9ca8b8', '#b4a3c2', '#93b2a9', '#c4aba3', '#aab49c', '#c2b7d3', '#8f9a8b'];
const FLUID = ['#86b6cc', '#6e9ec2', '#a5cbdc', '#7fb4b4', '#8ea3d0', '#aec4e2', '#66a2a6', '#8cc2d2', '#a1b4d2', '#6390b2'];

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
