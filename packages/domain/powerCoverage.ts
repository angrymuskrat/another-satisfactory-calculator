import type { Catalog } from './types';
import data from '../game-data/power-generators.json';

export interface CoverageRate { itemId: string; average: number; peak: number }
export interface GeneratorCoverage { id: string; name: string; power: number; average: number; peak: number; fuels: CoverageRate[]; supplemental: CoverageRate | null }

const count = (power: number, generator: number) => power > 0 ? Math.ceil(power / generator - 1e-9) : 0;
const perMinute = (power: number, energy: number) => Math.max(0, power) * 60 / energy;

/** При 100% топливо и вода требуются для полной мощности каждой установленной машины. */
export function powerCoverage(catalog: Pick<Catalog, 'version'>, average: number, peak: number): GeneratorCoverage[] | null {
  if (catalog.version !== data.provenance.catalogVersion) return null;
  return data.generators.map(g => {
    const averageCount = count(average, g.power), peakCount = count(peak, g.power);
    const supply = (itemId: string, energy: number) => ({ itemId,
      average: perMinute(averageCount * g.power, energy), peak: perMinute(peakCount * g.power, energy) });
    return { id: g.id, name: g.name, power: g.power, average: averageCount, peak: peakCount,
      fuels: g.fuels.map(f => supply(f.itemId, f.energy)),
      supplemental: g.supplemental && supply(g.supplemental.itemId, 1 / g.supplemental.perMJ) };
  });
}
