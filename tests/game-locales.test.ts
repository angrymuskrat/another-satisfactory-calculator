import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gameName, registerGameNames, type GameNames } from '../apps/web/src/i18n/gameNames';

const read = (path: string) => JSON.parse(readFileSync(`packages/game-data/${path}`, 'utf8'));
const catalog = read('catalog.json');
const progression = read('progression.json');
const generators = read('power-generators.json').generators as { id: string; name: string; nameEn: string }[];
const menu = read('source/menu-assets.json').categories as { name: string; nameEn: string }[];
const manualEn = read('overrides.json').manualNames.en.category as Record<string, string>;
const ru = read('locales/ru.json') as GameNames;
const en = read('locales/en.json') as GameNames;

const hasBothNames = (s: { name?: string; nameEn?: string }) => Boolean(s.name?.trim() && s.nameEn?.trim());
const named = (list: { id: string }[]) => list.map((entry) => entry.id);
const kinds: Record<keyof GameNames, string[]> = {
  item: named(catalog.items),
  recipe: named(catalog.recipes),
  building: named(catalog.buildings),
  miner: named(catalog.miners),
  belt: named(catalog.belts),
  pipe: named(catalog.pipes),
  category: catalog.categories,
  schematic: progression.schematics.filter(hasBothNames).map((s: { id: string }) => s.id),
  researchTree: progression.researchTrees.map((t: { id: string }) => t.id),
  gamePhase: progression.gamePhases.map((p: { id: string }) => p.id),
  generator: named(generators),
};

describe('словари названий из игры', () => {
  for (const [label, dict] of [['ru', ru], ['en', en]] as const) {
    it(`${label}: у каждой сущности каталога есть непустое название`, () => {
      for (const [kind, ids] of Object.entries(kinds)) {
        for (const id of ids) {
          const value = dict[kind as keyof GameNames]?.[id];
          expect(typeof value === 'string' && value.trim() !== '', `${label}.${kind}.${id}`).toBe(true);
        }
      }
    });
  }

  it('ru совпадает с name, en — с nameEn для предметов, рецептов и зданий', () => {
    for (const kind of ['item', 'recipe', 'building'] as const) {
      const list = catalog[`${kind}s`] as { id: string; name: string; nameEn: string }[];
      for (const entry of list) {
        expect(ru[kind][entry.id]).toBe(entry.name);
        expect(en[kind][entry.id]).toBe(entry.nameEn);
      }
    }
  });

  it('схемы есть в словарях ровно тогда, когда у них есть оба названия', () => {
    for (const s of progression.schematics) {
      expect(Object.hasOwn(ru.schematic, s.id), s.id).toBe(hasBothNames(s));
      expect(Object.hasOwn(en.schematic, s.id), s.id).toBe(hasBothNames(s));
    }
  });

  it('ленты и трубы: номер уровня в английском названии и отличие названий', () => {
    catalog.belts.forEach((b: { id: string }, i: number) => expect(en.belt[b.id]).toContain(`Mk.${i + 1}`));
    const [first, second] = catalog.pipes.map((p: { id: string }) => en.pipe[p.id]);
    expect(first).not.toBe(second);
    expect(second).toContain('Mk.2');
  });

  it('названия добытчиков, лент и труб не повторяются внутри вида', () => {
    for (const kind of ['miner', 'belt', 'pipe'] as const) {
      for (const dict of [ru, en]) {
        const values = kinds[kind].map((id) => dict[kind][id]);
        expect(new Set(values).size, kind).toBe(values.length);
      }
    }
  });

  it('английские категории равны nameEn из меню игры, кроме ручного названия', () => {
    for (const category of catalog.categories as string[]) {
      const expected = Object.hasOwn(manualEn, category) ? manualEn[category] : menu.find((c) => c.name === category)?.nameEn;
      expect(expected, category).toBeTruthy();
      expect(en.category[category]).toBe(expected);
    }
  });

  it('генераторы совпадают с power-generators.json', () => {
    for (const g of generators) {
      expect(ru.generator[g.id]).toBe(g.name);
      expect(en.generator[g.id]).toBe(g.nameEn);
    }
  });

  it('ru-название категории равно её идентификатору', () => {
    for (const category of catalog.categories) expect(ru.category[category]).toBe(category);
  });

  it('в английском словаре нет кириллицы', () => {
    for (const [kind, entries] of Object.entries(en)) {
      for (const [id, value] of Object.entries(entries)) expect(value, `${kind}.${id}`).not.toMatch(/[А-Яа-яЁё]/);
    }
  });
});

describe('gameName', () => {
  it('неизвестный идентификатор возвращает запасное название', () => {
    expect(gameName('item', 'нет-такого', 'Запасное')).toBe('Запасное');
  });

  it('язык без словаря берёт английское название', () => {
    expect(gameName('item', 'iron-plate', 'Железная пластина', 'xx')).toBe('Iron Plate');
  });

  it('активный русский язык берёт русское название', () => {
    expect(gameName('item', 'iron-plate', 'x')).toBe(ru.item['iron-plate']);
  });

  it('служебные имена объекта не считаются названиями', () => {
    expect(gameName('item', 'constructor', 'Запасное')).toBe('Запасное');
    expect(gameName('item', 'toString', 'Запасное')).toBe('Запасное');
  });

  it('зарегистрированный словарь важнее английского', () => {
    const names = Object.fromEntries(Object.keys(en).map((k) => [k, {}])) as GameNames;
    names.item = { 'iron-plate': 'Eisenplatte' };
    registerGameNames('de', names);
    expect(gameName('item', 'iron-plate', 'x', 'de')).toBe('Eisenplatte');
    expect(gameName('item', 'copper-ingot', 'x', 'de')).toBe(en.item['copper-ingot']);
  });
});
