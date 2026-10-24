import { describe, expect, it } from 'vitest';
import generators from '../packages/game-data/power-generators.json';
import gameCatalog from '../packages/game-data/catalog.json';
import { powerCoverage } from '../packages/domain/powerCoverage';

describe('данные генераторов', () => {
  it('совпадают с цифрами игры и версией каталога', () => {
    expect(generators.provenance.catalogVersion).toBe(gameCatalog.version);
    const coal = generators.generators.find(g => g.id === 'coal-generator')!;
    const fuel = generators.generators.find(g => g.id === 'fuel-generator')!;
    expect(coal).toMatchObject({ name: 'Угольный генератор', power: 75, supplemental: { itemId: 'water', perMJ: 0.01 } });
    expect(coal.fuels).toEqual([{ itemId: 'coal', energy: 300 }, { itemId: 'compacted-coal', energy: 630 }, { itemId: 'petroleum-coke', energy: 180 }]);
    expect(fuel).toMatchObject({ name: 'Топливный генератор', power: 250, supplemental: null });
    expect(fuel.fuels).toEqual([{ itemId: 'fuel', energy: 750 }, { itemId: 'turbofuel', energy: 2000 }, { itemId: 'liquid-biofuel', energy: 750 }, { itemId: 'rocket-fuel', energy: 3600 }, { itemId: 'ionized-fuel', energy: 5000 }]);
    // Контроль с игрой: 15 угля и 45 м³ воды, 20 м³ топлива в минуту.
    expect(coal.power * 60 / 300).toBe(15);
    expect(coal.power * 60 * coal.supplemental!.perMJ).toBeCloseTo(45, 9);
    expect(fuel.power * 60 / 750).toBe(20);
  });
});

const version = { version: gameCatalog.version };
describe('powerCoverage', () => {
  it('300 МВт средней мощности — 4 угольных, 60 угля и 180 м³ воды', () => {
    const coal = powerCoverage(version, 300, 400)!.find(g => g.id === 'coal-generator')!;
    expect(coal.average).toBe(4);
    expect(coal.peak).toBe(6);
    expect(coal.fuels.find(f => f.itemId === 'coal')).toEqual({ itemId: 'coal', average: 60, peak: 80 });
    expect(coal.supplemental!.average).toBeCloseTo(180, 9);
  });
  it('кратная мощность и численный шум не добавляют генератор', () => {
    const fuel = powerCoverage(version, 250, 250.0000001)!.find(g => g.id === 'fuel-generator')!;
    expect([fuel.average, fuel.peak]).toEqual([1, 1]);
    expect(fuel.fuels.find(f => f.itemId === 'fuel')!.average).toBe(20);
    expect(powerCoverage(version, 75, 75)!.find(g => g.id === 'coal-generator')!.average).toBe(1);
  });
  it('нулевая мощность — ноль генераторов и расхода', () => {
    const coal = powerCoverage(version, 0, 0)!.find(g => g.id === 'coal-generator')!;
    expect([coal.average, coal.peak, coal.fuels[0].average]).toEqual([0, 0, 0]);
  });
  it('другая версия каталога — справки нет', () => {
    expect(powerCoverage({ version: 'other' }, 300, 300)).toBeNull();
  });
});
