/** Число параллельных лент/труб для среднего потока; относительный допуск не создаёт лишнюю линию из-за округления. */
export const parallelLines = (rate: number, capacity: number) =>
  rate > 0 ? Math.max(1, Math.ceil(rate / capacity - Math.min(1e-7, rate / capacity * 1e-8))) : 0;
