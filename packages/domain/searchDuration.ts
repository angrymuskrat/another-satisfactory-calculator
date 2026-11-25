import type { ProductionVariants } from './types';
export const variantDuration = (previous?: ProductionVariants) => previous ? Math.min(120000, 25000 * 2 ** (previous.pass ?? 1)) : 25000;
