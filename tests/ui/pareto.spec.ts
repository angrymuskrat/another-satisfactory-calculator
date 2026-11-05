import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createDefaultPlan } from '../../packages/domain/defaults';
import type { Catalog } from '../../packages/domain/types';
test.setTimeout(90000);
test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });
const catalog = JSON.parse(readFileSync(new URL('../../packages/game-data/catalog.json', import.meta.url), 'utf8')) as Catalog;
function fixture(supply = false) {
  const plan = createDefaultPlan(catalog); plan.mode = 'target'; plan.settings.pareto = true;
  plan.targets = [{ itemId: supply ? 'iron-ingot' : 'wire', rate: 30, weight: 1, scale: 1 }];
  plan.settings.enabledRecipeIds = supply ? ['iron-ingot', 'generate-coal'] : ['iron-ingot', 'copper-ingot', 'wire', 'alt-iron-wire'];
  plan.sources = (supply ? ['iron-ore', 'coal', 'water'] : ['iron-ore', 'copper-ore']).map(itemId => ({ id: itemId, itemId, kind: 'flow' as const, limit: 100, count: 1, purity: 1 as const, minerId: '', clock: 100 }));
  if (supply) plan.settings.selfSupply = 'coal'; return plan;
}
test('обзор, выбор клавиатурой, лимиты, пересчёт и сохранение', async ({ page }) => {
  await page.addInitScript(plan => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('ficsit-plan-v1', JSON.stringify(plan)); } }, fixture());
  await page.goto('/'); await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  const region = page.getByRole('region', { name: 'Компромиссы по ресурсам и энергии' });
  const choose = region.getByRole('button', { name: /^Использовать:/ }).first();
  await expect(choose).toBeEnabled({ timeout: 65000 });
  expect(await region.getByRole('row').count()).toBeGreaterThan(3);
  await page.screenshot({ path: 'output/playwright/pareto-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/playwright/pareto-mobile.png', fullPage: true });
  await choose.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Построить', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Вернуться к вариантам', exact: true }).click();
  const results = page.locator('.results-page');
  await results.getByRole('checkbox', { name: 'Без суммарного лимита: Железная руда', exact: true }).uncheck();
  await results.getByRole('textbox', { name: 'Суммарный лимит: Железная руда', exact: true }).fill('1');
  await expect(choose).toBeDisabled();
  await page.getByRole('button', { name: 'Пересчитать обзор', exact: true }).click();
  await expect(choose).toBeEnabled({ timeout: 65000 });
  await expect(page.getByText(/База сравнения:/)).toBeVisible();
  await page.reload();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!).settings.inputLimits['iron-ore'])).toBe(1);
});
test('самообеспечение входит в результат и строительную схему, каталог генерации открывается', async ({ page }) => {
  await page.addInitScript(plan => localStorage.setItem('ficsit-plan-v1', JSON.stringify(plan)), fixture(true));
  await page.goto('/'); await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  const choose = page.getByRole('button', { name: /^Использовать:/ }).first();
  await expect(choose).toBeEnabled({ timeout: 65000 }); await choose.click();
  await expect(page.locator('.energy-panel')).toContainText('Генерация');
  await expect(page.locator('.energy-panel')).toContainText('75');
  await page.getByRole('button', { name: 'Построить', exact: true }).click();
  await expect(page.locator('.construction-panel')).toContainText('Уголь');
  await page.getByRole('button', { name: 'Рецепты', exact: true }).click();
  await expect(page.locator('body')).not.toBeEmpty();
});
test('частичный ответ сохраняется после отмены, изменение входа запрещает его принятие', async ({ page }) => {
  const plan = fixture(true);
  await page.addInitScript(plan => localStorage.setItem('ficsit-plan-v1', JSON.stringify(plan)), plan);
  await page.route(/solver\.worker.*\.js/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + '\nconst originalPost = self.postMessage.bind(self); self.postMessage = message => { if (message.partial) originalPost(message); };' });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  const choose = page.getByRole('button', { name: /^Использовать:/ }).first();
  await expect(choose).toBeVisible(); await expect(choose).toBeDisabled();
  await page.getByRole('button', { name: 'Отменить расчёт', exact: true }).click();
  await expect(choose).toBeEnabled();
  await page.locator('.results-page').getByRole('checkbox', { name: 'Без суммарного лимита: Уголь', exact: true }).uncheck();
  await expect(choose).toBeDisabled();
});
