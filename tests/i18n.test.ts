import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LocaleProvider, useT } from '../apps/web/src/i18n';
import { detectLocale, LOCALE_KEY } from '../apps/web/src/i18n/locales';
import { plural } from '../apps/web/src/i18n/plural';

describe('detectLocale', () => {
  it('выбирает первый язык браузера, доступный в пакетах', () => {
    expect(detectLocale(['en-GB', 'ru'], null, ['ru', 'en'])).toBe('en');
    expect(detectLocale(['ru-UA'], null, ['ru', 'en'])).toBe('ru');
  });

  it('без совпадения берёт en, а без en — первый доступный', () => {
    expect(detectLocale(['de'], null, ['ru', 'en'])).toBe('en');
    expect(detectLocale(['de'], null, ['ru'])).toBe('ru');
    expect(detectLocale([], null, ['ru', 'en'])).toBe('en');
  });

  it('сохранённый выбор важнее языка браузера', () => {
    expect(detectLocale(['en'], 'ru', ['ru', 'en'])).toBe('ru');
  });

  it('игнорирует сохранённое значение вне доступных', () => {
    expect(detectLocale(['ru'], 'de', ['ru', 'en'])).toBe('ru');
    expect(detectLocale(['ru'], '', ['ru', 'en'])).toBe('ru');
    expect(detectLocale(['ru'], '<script>', ['ru', 'en'])).toBe('ru');
  });
});

describe('plural', () => {
  const forms = { one: 'машина', few: 'машины', many: 'машин', other: 'машины' };

  it('склоняет по правилам русского языка', () => {
    const got = [1, 2, 5, 21, 0, 1.5].map((n) => plural('ru-RU', n, forms));
    expect(got).toEqual(['машина', 'машины', 'машин', 'машина', 'машин', 'машины']);
  });

  it('склоняет по правилам английского языка', () => {
    const en = { one: 'machine', other: 'machines' };
    expect(plural('en-US', 1, en)).toBe('machine');
    expect(plural('en-US', 0, en)).toBe('machines');
    expect(plural('en-US', 2, en)).toBe('machines');
  });
});

describe('LocaleProvider', () => {
  it('неизвестный сохранённый язык: показывается доступный, ключ не переписывается', () => {
    const store = new Map([[LOCALE_KEY, 'de']]);
    const writes: string[] = [];
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { writes.push(key); store.set(key, value); } });
    try {
      let seen = '';
      const Probe = () => { seen = useT().locale.name; return null; };
      renderToStaticMarkup(createElement(LocaleProvider, null, createElement(Probe)));
      expect(seen).toBe('Русский');
      expect(store.get(LOCALE_KEY)).toBe('de');
      expect(writes).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  });
});
