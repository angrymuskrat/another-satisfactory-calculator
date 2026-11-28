import ru from '../../../../packages/game-data/locales/ru.json';
import en from '../../../../packages/game-data/locales/en.json';
import { activeLocale } from './index';

export type GameKind = 'item' | 'recipe' | 'building' | 'miner' | 'belt' | 'pipe'
  | 'category' | 'schematic' | 'researchTree' | 'gamePhase' | 'generator';
export type GameNames = Record<GameKind, Record<string, string>>;

const FALLBACK_LOCALE = 'en';
const dictionaries = new Map<string, GameNames>();

export function registerGameNames(locale: string, names: GameNames): void {
  dictionaries.set(locale, names);
}

registerGameNames('ru', ru as GameNames);
registerGameNames(FALLBACK_LOCALE, en as GameNames);

function lookup(locale: string, kind: GameKind, id: string): string | undefined {
  const names = dictionaries.get(locale);
  if (!names || !Object.hasOwn(names, kind) || !Object.hasOwn(names[kind], id)) return undefined;
  const value = names[kind][id];
  return typeof value === 'string' ? value : undefined;
}

export function gameName(kind: GameKind, id: string, fallback: string, locale: string = activeLocale().id): string {
  return lookup(locale, kind, id) ?? lookup(FALLBACK_LOCALE, kind, id) ?? fallback;
}

export function searchNames(kind: GameKind, id: string, fallback: string): string {
  return [...new Set([gameName(kind, id, fallback), gameName(kind, id, fallback, 'ru'), gameName(kind, id, fallback, 'en')])].join(' ');
}

export const nameCollator = () => new Intl.Collator(activeLocale().tag);
