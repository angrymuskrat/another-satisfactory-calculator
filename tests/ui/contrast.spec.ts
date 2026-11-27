import { catalog } from './catalog';
import { chooseMaximum } from './chooseVariant';
import { expect, test, type Page } from '@playwright/test';
import { createDefaultPlan } from '../../packages/domain/defaults';

async function lowContrastTexts(page: Page) {
  return page.evaluate(() => {
    const parse = (value: string) => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean);
      return [Number(r), Number(g), Number(b), Number(a)];
    };
    const over = (top: number[], bottom: number[]) => {
      const a = top[3] + bottom[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      return [0, 1, 2].map(i => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a);
    };
    const background = (element: Element) => {
      const layers: number[][] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        const color = parse(getComputedStyle(node).backgroundColor);
        if (color[3] > 0) layers.push(color);
        if (color[3] >= 1) break;
      }
      return layers.reverse().reduce((under, layer) => over(layer, under), [255, 255, 255, 1]);
    };
    const luminance = (c: number[]) => {
      const [r, g, b] = c.slice(0, 3).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const failures: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const element = text.parentElement;
      if (!element || seen.has(element) || !text.textContent?.trim()) continue;
      seen.add(element);
      if (element.closest('[disabled], [aria-disabled="true"], [hidden], [inert], .sr-only, svg')) continue;
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      if (!rect.width || !rect.height || style.visibility !== 'visible') continue;
      let opaque = true;
      for (let node: Element | null = element; node; node = node.parentElement) if (Number(getComputedStyle(node).opacity) < 1) { opaque = false; break; }
      if (!opaque) continue;
      const fg = over(parse(style.color), background(element));
      const [a, b] = [luminance(fg), luminance(background(element))];
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const size = parseFloat(style.fontSize), bold = Number(style.fontWeight) >= 700;
      const needed = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (ratio < needed) failures.push(`${ratio.toFixed(2)} < ${needed}: «${text.textContent.trim().slice(0, 40)}» ${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`);
    }
    return failures;
  });
}

async function open(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name, exact: true }).click();
}

test('видимый текст на основных экранах контрастен своему фону', async ({ page }) => {
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
  for (const screen of ['Рецепты', 'Схемы разделителей', 'Технологии', 'Миры и фабрики', 'Профили']) {
    await open(page, screen);
    await check(screen);
  }
  expect(failures).toEqual([]);
});
