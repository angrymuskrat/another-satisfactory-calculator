import type { Catalog } from './types';
import data from '../game-data/power-generators.json';

export interface CoverageRate { itemId: string; average: number; peak: number }
export interface GeneratorCoverage { id: string; name: string; power: number; average: number; peak: number; fuels: CoverageRate[]; supplemental: CoverageRate | null }

const count = (power: number, generator: number) => power > 0 ? Math.ceil(power / generator - 1e-9) : 0;
const perMinute = (power: number, energy: number) => Math.max(0, power) * 60 / energy;

/** Справка вне оптимизации: генераторы на 100%, расход топлива пропорционален выдаваемой мощности. */
export function powerCoverage(catalog: Pick<Catalog, 'version'>, average: number, peak: number): GeneratorCoverage[] | null {
  if (catalog.version !== data.provenance.catalogVersion) return null;
  return data.generators.map(g => ({
    id: g.id, name: g.name, power: g.power, average: count(average, g.power), peak: count(peak, g.power),
    fuels: g.fuels.map(f => ({ itemId: f.itemId, average: perMinute(average, f.energy), peak: perMinute(peak, f.energy) })),
    supplemental: g.supplemental && { itemId: g.supplemental.itemId, average: perMinute(average, 1 / g.supplemental.perMJ), peak: perMinute(peak, 1 / g.supplemental.perMJ) },
  }));
}
