import { catalog } from './catalog';
import { chooseMaximum } from './chooseVariant';
import { expect, test, type Page } from '@playwright/test';
import { createDefaultPlan } from '../../packages/domain/defaults';

async function lowContrastTexts(page: Page) {
  return page.evaluate(() => {
    type Rgba = [number, number, number, number];
    const parse = (value: string): Rgba => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean);
      return [Number(r), Number(g), Number(b), Number(a)];
    };
    const over = (top: Rgba, bottom: Rgba): Rgba => {
      const a = top[3] + bottom[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      const mix = (i: number) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a;
      return [mix(0), mix(1), mix(2), a];
    };
    // Each ancestor is a compositing group: its background and descendants blend onto the backdrop at its opacity.
    const pixel = (element: Element, ink: Rgba | null): Rgba => {
      const chain: Element[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) chain.unshift(node);
      const paint = (index: number, backdrop: Rgba): Rgba => {
        if (index === chain.length) return ink ? over(ink, backdrop) : backdrop;
        const style = getComputedStyle(chain[index]);
        const content = paint(index + 1, over(parse(style.backgroundColor), backdrop));
        const opacity = Number(style.opacity);
        const lerp = (i: number) => backdrop[i] + (content[i] - backdrop[i]) * opacity;
        return [lerp(0), lerp(1), lerp(2), 1];
      };
      return paint(0, [255, 255, 255, 1]);
    };
    const luminance = (c: Rgba) => {
      const [r, g, b] = c.slice(0, 3).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility === 'visible'
        && !element.closest('[disabled], [aria-disabled="true"], [hidden], [inert], .sr-only');
    };
    const failures: string[] = [];
    const check = (element: Element, color: string, label: string) => {
      const style = getComputedStyle(element);
      const [fg, bg] = [luminance(pixel(element, parse(color))), luminance(pixel(element, null))];
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      const size = parseFloat(style.fontSize), bold = Number(style.fontWeight) >= 700;
      const needed = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (ratio < needed) failures.push(`${ratio.toFixed(2)} < ${needed}: «${label.slice(0, 40)}» ${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`);
    };
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const element = text.parentElement, value = text.textContent?.trim();
      if (!element || !value || seen.has(element) || element.closest('svg, option') || !visible(element)) continue;
      seen.add(element);
      check(element, getComputedStyle(element).color, value);
    }
    for (const field of document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')) {
      if (!visible(field) || ['checkbox', 'radio', 'range', 'hidden', 'file', 'color'].includes(field.type)) continue;
      const shown = field instanceof HTMLSelectElement ? field.selectedOptions[0]?.text ?? '' : field.value;
      if (shown) check(field, getComputedStyle(field).color, shown);
      else if ('placeholder' in field && field.placeholder) check(field, getComputedStyle(field, '::placeholder').color, field.placeholder);
    }
    return failures;
  });
}

async function open(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name, exact: true }).click();
}

test('видимый текст и значения полей на основных экранах контрастны своему фону', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const plan = createDefaultPlan(catalog); plan.settings.objective = 'smooth-power'; plan.mode = 'target'; plan.targets[0].rate = 7.5;
  await page.addInitScript(value => { if (!localStorage.getItem('ficsit-plan-v1')) localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)); }, plan);
  await page.goto('/');
  const failures: string[] = [];
  const check = async (screen: string) => failures.push(...(await lowContrastTexts(page)).map(f => `${screen}: ${f}`));
  await check('Цели');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await chooseMaximum(page);
  await expect(page.getByRole('button', { name: 'Рассчитать', exact: true })).toBeVisible({ timeout: 60000 });
  await check('Результаты');
  await page.getByRole('button', { name: 'Построить', exact: true }).click();
  await check('Инструкция');
  await open(page, 'Рецепты');
  await page.getByText('Быстрая настройка по прогрессу', { exact: true }).click();
  await page.getByRole('button', { name: 'Исследования MAM', exact: true }).click();
  await page.getByRole('button', { name: /^Ветка MAM: Кварц,/ }).click();
  await check('Рецепты, MAM «Кварц»');
  for (const screen of ['Схемы разделителей', 'Технологии', 'Миры и фабрики', 'Профили']) {
    await open(page, screen);
    await check(screen);
  }
  expect(failures).toEqual([]);
});
