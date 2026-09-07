import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createDefaultPlan } from '../../packages/domain/defaults';
import { createFactory, createWorld, emptyWorkspace } from '../../packages/domain/worlds';
import type { Catalog } from '../../packages/domain/types';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });
const catalog = JSON.parse(readFileSync(new URL('../../packages/game-data/catalog.json', import.meta.url), 'utf8')) as Catalog;

test('отдельные экраны сохраняют результат и состояние широкой схемы', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  await expect(nav.getByRole('button', { name: 'Цели и ограничения', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Заданный выпуск Выполнить производственный заказ' }).click();
  await page.getByRole('textbox', { name: 'Количество продукта 1', exact: true }).fill('7.5');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Результаты', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('textbox', { name: 'Количество продукта 1', exact: true })).not.toBeVisible();
  await expect(page.locator('.results-heading')).toContainText('Допустимое приближение', { timeout: 30000 });
  await page.getByRole('button', { name: 'Построить', exact: true }).click();
  await page.getByRole('button', { name: 'По типам зданий', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Схема строительства', exact: true });
  await graph.locator('.schematic-node-button').first().click();
  const selected = await graph.locator('.schematic-node.selected').getAttribute('data-node-id');
  const width = (await graph.boundingBox())!.width;
  expect(width).toBeGreaterThan(1500);
  const viewport = graph.locator('.schematic-viewport');
  await viewport.hover(); await page.mouse.wheel(0, -100);
  await expect(graph.locator('.schematic-canvas')).not.toHaveAttribute('style', 'transform: scale(0.75);');
  await graph.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click();
  await graph.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click();
  await viewport.evaluate(el => el.scrollTo(150, 120));
  const pan = await viewport.evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }));
  expect(pan.x).toBeGreaterThan(0);
  const transform = await graph.locator('.schematic-canvas').getAttribute('style');
  await nav.getByRole('button', { name: 'Цели и ограничения', exact: true }).click();
  await expect(graph).not.toBeVisible();
  // Дождаться ResizeObserver скрытого полотна.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await nav.getByRole('button', { name: 'Результаты', exact: true }).click();
  await expect(graph).toBeVisible();
  expect(await graph.locator('.schematic-canvas').getAttribute('style')).toBe(transform);
  expect(await graph.locator('.schematic-node.selected').getAttribute('data-node-id')).toBe(selected);
  await expect.poll(() => viewport.evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }))).toEqual(pan);
  await page.screenshot({ path: 'output/playwright/planner-wide-1920.png', fullPage: true });
  await nav.getByRole('button', { name: 'Цели и ограничения', exact: true }).click();
  await page.getByRole('textbox', { name: 'Количество продукта 1', exact: true }).fill('8');
  await nav.getByRole('button', { name: 'Результаты', exact: true }).click();
  await expect(page.locator('.results-heading')).toContainText('Требуется пересчёт');
  await expect(graph).toHaveCount(0);
});

test('старый гостевой план удаляется один раз, мир и новые фабрики остаются', async ({ page }) => {
  const current = createDefaultPlan(catalog), old = structuredClone(current); old.settings.objective = 'power';
  const world = createWorld(catalog, 'Мир остаётся', 'world', current);
  const workspace = { ...emptyWorkspace(catalog.version), worlds: [world], factories: [createFactory(old, 'old', world), createFactory(current, 'new', world)] };
  await page.addInitScript(({ old, workspace }) => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', 'yes');
    localStorage.setItem('ficsit-plan-v1', JSON.stringify(old));
    localStorage.setItem('ficsit-workspace-v1', JSON.stringify(workspace));
  }, { old, workspace });
  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: 'Старые планы' }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!).settings.objective)).toBe('smooth-power');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-workspace-v1')!));
  expect(saved.worlds).toHaveLength(1); expect(saved.factories.map((f: { id: string }) => f.id)).toEqual(['new']);
  await page.getByRole('textbox', { name: 'Название плана', exact: true }).fill('Новый заказ');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Название плана', exact: true })).toHaveValue('Новый заказ');
  await page.getByLabel('Файл плана JSON').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
  await expect(page.getByRole('status').filter({ hasText: 'прежнюю цель' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Название плана', exact: true })).toHaveValue('Новый заказ');
});

test('предпросмотр использует частоту технологий, проверки доступны в настройках', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Проверки расширения и перестройки', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сравнить цели оптимизации', exact: true })).toHaveCount(0);
  await expect(page.getByText(/Проверить полезное расширение/)).toBeVisible();
  await page.getByRole('button', { name: 'Технологии', exact: true }).click();
  await page.getByRole('textbox', { name: 'Частота производства', exact: true }).fill('50');
  await page.getByRole('button', { name: 'Рецепты', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Частота предпросмотра рецептов' })).toHaveCount(0);
  await expect(page.getByText('Справочные показатели одной машины при 50%', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Сравнить выбранные рецепты/ })).toBeVisible();
});

test('расчёт можно отменить после смены экрана, тайм-аут и поздний worker не скрываются', async ({ page }) => {
  await page.goto('/');
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/solver\.worker.*\.js/, async route => { await pending; await route.continue().catch(() => {}); });
  try {
    await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
    await page.getByRole('button', { name: 'Цели и ограничения', exact: true }).click();
    await page.getByRole('button', { name: 'Отменить расчёт', exact: true }).click();
    await page.getByRole('button', { name: 'Результаты', exact: true }).click();
    await expect(page.getByText('Расчёт отменён.', { exact: true })).toBeVisible();
    release();
    await expect(page.locator('.results-column .kpi')).toHaveCount(0);
    await page.unroute(/\/solver\.worker.*\.js/);
    await page.clock.install();
    const timed = new Promise<void>(resolve => { release = resolve; });
    await page.route(/\/solver\.worker.*\.js/, async route => { await timed; await route.continue().catch(() => {}); });
    await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Отменить расчёт', exact: true })).toBeVisible();
    await page.clock.fastForward(30_001);
    await expect(page.getByText(/Расчёт остановлен по времени/)).toBeVisible();
    await expect(page.locator('.results-column .kpi')).toHaveCount(0);
  } finally { release(); await page.unroute(/\/solver\.worker.*\.js/); }
});

for (const width of [390, 1440]) test(`рамки полей прилегают к контуру, ширина ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Заданный выпуск Выполнить производственный заказ' }).click();
  const number = page.getByRole('textbox', { name: 'Количество продукта 1', exact: true });
  await number.focus();
  expect(await number.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  expect(await number.locator('..').evaluate(el => getComputedStyle(el).boxShadow)).not.toBe('none');
  await page.screenshot({ path: `output/playwright/planner-focus-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await number.fill('-2');
  await expect(number).toHaveAttribute('aria-invalid', 'true');
  await number.press('Tab');
  await expect(number).not.toHaveAttribute('aria-invalid', 'true');
});
