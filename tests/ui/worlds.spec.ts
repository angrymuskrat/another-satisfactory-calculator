import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import type { Catalog } from '../../packages/domain/types';
import type { Workspace } from '../../packages/domain/worlds';
import { createDefaultPlan } from '../../packages/domain/defaults';

const catalog = JSON.parse(readFileSync('packages/game-data/catalog.json', 'utf8')) as Catalog;
test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });
const workspace = (page: Page): Promise<Workspace> => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-workspace-v1')!));
async function openWorlds(page: Page) {
  await page.getByRole('button', { name: 'Миры и фабрики', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Создать пустой мир', exact: true })).toBeEnabled();
}

test('гость: legacy план, две фабрики, изолированный preview и JSON round-trip', async ({ page }) => {
  const legacy = { ...createDefaultPlan(catalog), name: 'Старый локальный план' };
  legacy.settings.enabledRecipeIds = legacy.settings.enabledRecipeIds.slice(0, 5);
  legacy.sources[0].limit = 37;
  await page.addInitScript(plan => { if (!localStorage.getItem('ficsit-plan-v1')) localStorage.setItem('ficsit-plan-v1', JSON.stringify(plan)); }, legacy);
  await page.goto('/'); await openWorlds(page);
  await page.getByRole('textbox', { name: 'Название мира', exact: true }).fill('Общий мир');
  await page.getByRole('button', { name: 'Создать мир из настроек плана', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Изменить прогресс Общий мир', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить копию текущего плана', exact: true }).click();
  await expect.poll(async () => (await workspace(page)).factories.length).toBe(1);
  await page.getByRole('textbox', { name: 'Название плана', exact: true }).fill('Вторая фабрика');
  await page.getByRole('button', { name: 'Сохранить копию текущего плана', exact: true }).click();
  await expect.poll(async () => (await workspace(page)).factories.length).toBe(2);
  const before = await workspace(page);
  expect(before.factories[0].plan.settings).toEqual(legacy.settings);
  expect(before.factories[0].plan.sources).toEqual(legacy.sources);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!))).toEqual(legacy);

  await page.getByRole('button', { name: 'Изменить прогресс Общий мир', exact: true }).click();
  await page.getByLabel('Максимальная лента мира', { exact: true }).selectOption('belt1');
  await page.getByLabel('Разгон открыт в мире', { exact: true }).check();
  await page.getByRole('button', { name: 'Просмотреть изменения мира', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Просмотр изменений мира' });
  await expect(preview).toContainText('Старый локальный план, Вторая фабрика');
  expect(await workspace(page)).toEqual(before);
  await page.getByRole('button', { name: 'Применить к миру и 2 фабрикам', exact: true }).click();
  await expect.poll(async () => (await workspace(page)).worlds[0].revision).toBe(2);
  const after = await workspace(page);
  for (let i = 0; i < 2; i++) {
    expect(after.factories[i].plan.settings).toEqual(before.factories[i].plan.settings);
    expect(after.factories[i].plan.sources).toEqual(before.factories[i].plan.sources);
    expect(after.factories[i].plan.world?.beltId).toBe('belt1');
    expect(after.factories[i].plan.world?.overclockUnlocked).toBe(true);
  }
  await page.reload(); await openWorlds(page);
  await page.getByRole('button', { name: 'Открыть Вторая фабрика', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Название плана', exact: true })).toHaveValue('Вторая фабрика');
  const exportEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт рабочего пространства в JSON', exact: true }).click();
  const exported = await exportEvent;
  const raw = await readFile((await exported.path())!, 'utf8');
  expect(JSON.parse(raw)).toEqual(after);
  await page.getByLabel('Файл рабочего пространства JSON', { exact: true }).setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
  await expect.poll(async () => (await workspace(page)).factories.length).toBe(4);
  const merged = await workspace(page);
  expect(merged.factories.slice(0, 2)).toEqual(after.factories);
  expect(merged.worlds).toHaveLength(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!))).toEqual(legacy);
});

test('реальные HUB/MAM, дочерние схемы и частично выбранный уровень попадают только в черновик', async ({ page }) => {
  await page.goto('/'); await openWorlds(page);
  await page.getByRole('textbox', { name: 'Название мира', exact: true }).fill('Прогресс');
  await page.getByRole('button', { name: 'Создать пустой мир', exact: true }).click();
  await page.getByRole('button', { name: 'Изменить прогресс Прогресс', exact: true }).click();
  await page.getByText('HUB / MAM / другие схемы', { exact: true }).click();
  await page.getByText('Подготовить прогресс HUB по уровню', { exact: true }).click();
  await page.getByLabel('Уровень HUB', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Подготовить список до уровня 1', exact: true }).click();
  const omitted = catalog.unlocks!.find(u => u.id === 'Schematic_1-1_C')!;
  await page.getByRole('checkbox', { name: `${omitted.name} · уровень 1`, exact: true }).uncheck();
  await page.getByRole('button', { name: 'Добавить выбранные этапы в черновик', exact: true }).click();
  await page.getByText('HUB: отдельные этапы', { exact: true }).click();
  const oil = catalog.unlocks!.find(u => u.id === 'Schematic_5-1_C')!;
  await page.locator('article').filter({ has: page.getByRole('heading', { name: oil.name, exact: true }) }).getByRole('button', { name: 'Добавить открытия', exact: true }).click();
  await page.getByText('MAM: отдельные исследования', { exact: true }).click();
  const overclock = catalog.unlocks!.find(u => u.id === 'Research_PowerSlugs_2_C')!;
  await page.locator('article').filter({ has: page.getByRole('heading', { name: overclock.name, exact: true }) }).getByRole('button', { name: 'Добавить открытия', exact: true }).click();
  expect((await workspace(page)).worlds[0].unlockedMilestoneIds).toEqual([]);
  await page.getByRole('button', { name: 'Просмотреть изменения мира', exact: true }).click();
  await page.getByRole('button', { name: 'Применить к миру и 0 фабрикам', exact: true }).click();
  await expect.poll(async () => (await workspace(page)).worlds[0].revision).toBe(2);
  const saved = (await workspace(page)).worlds[0];
  expect(saved.unlockedMilestoneIds).not.toContain(omitted.id);
  expect(saved.unlockedMilestoneIds).toEqual(expect.arrayContaining([oil.id, 'Schematic_5-1-1_C', overclock.id]));
  expect(saved.unlockedBuildingIds).toContain('oil-pump');
  expect(saved.overclockUnlocked).toBe(true);
  const child = catalog.unlocks!.find(u => u.id === 'Schematic_5-1-1_C')!;
  expect(saved.unlockedRecipeIds).toEqual(expect.arrayContaining(child.recipeIds));
});

test('миры на ширине 390: русские подписи и отсутствие горизонтального переполнения', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await openWorlds(page);
  const view = page.locator('.worlds-view');
  await expect(view).toBeVisible();
  await expect(view).not.toContainText(/workspace|preview|prerequisites/i);
  const checkWidth = async () => {
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  };
  await checkWidth();
  await page.getByRole('textbox', { name: 'Название мира', exact: true }).fill('Мобильное прохождение');
  await page.getByRole('button', { name: 'Создать пустой мир', exact: true }).click();
  await page.getByRole('button', { name: 'Изменить прогресс Мобильное прохождение', exact: true }).click();
  await page.getByText('HUB / MAM / другие схемы', { exact: true }).click();
  await page.getByText('MAM: отдельные исследования', { exact: true }).click();
  await checkWidth();
  await expect(view).not.toContainText(/workspace|preview|prerequisites/i);
  await expect(page.locator('.research-guide > summary')).toHaveText('Граф исследований MAM и фазы HUB');
  await page.getByRole('button', { name: 'Просмотреть изменения мира', exact: true }).click();
  await checkWidth();
  await page.screenshot({ path: 'output/playwright/worlds-mobile-390.png', fullPage: true });
});
