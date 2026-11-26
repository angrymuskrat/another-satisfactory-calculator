import mechanics from '../game-data/p2-mechanics.json' with { type: 'json' };

export const MIN_CLOCK_PERCENT = 1;
export const MAX_CLOCK_PERCENT = 250;
export const MIN_CLOCK_RATIO = MIN_CLOCK_PERCENT / 100;
export const CLOCK_POWER_EXPONENT = Math.log2(2.5);
export const BOOST_POWER_EXPONENT = 2;
export const purity = { impure: 0.5, normal: 1, pure: 2 } as const;
export type ResourcePurity = typeof purity[keyof typeof purity];
export const well = mechanics.well;

export function productionBoost(somersloops: number, slots: number) {
  return slots ? 1 + somersloops / slots : 1;
}
