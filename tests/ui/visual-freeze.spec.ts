import { catalog } from './catalog';
import { chooseMaximum } from './chooseVariant';
import { expect, test, type Page } from '@playwright/test';
import { createDefaultPlan } from '../../packages/domain/defaults';

test.skip(!process.env.VISUAL_FREEZE, 'Попиксельная заморозка запускается явно: VISUAL_FREEZE=1.');

const viewports = [{ width: 1920, height: 1080 }, { width: 390, height: 844 }];

async function seed(page: Page) {
  const plan = createDefaultPlan(catalog); plan.settings.objective = 'smooth-power'; plan.mode = 'target'; plan.targets[0].rate = 7.5;
  await page.addInitScript(value => {
    if (!localStorage.getItem('ficsit-plan-v1')) localStorage.setItem('ficsit-plan-v1', JSON.stringify(value));
  }, plan);
  await page.goto('/');
}

async function open(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name, exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
}

const shot = async (page: Page, name: string) => {
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, maxDiffPixels: 0, threshold: 0, animations: 'disabled', caret: 'hide', timeout: 20000 });
};

for (const viewport of viewports) {
  test.describe(`${viewport.width}`, () => {
    test.use({ viewport });

    test('экраны без расчёта', async ({ page }) => {
      await seed(page);
      await shot(page, `planner-${viewport.width}`);
      await page.getByRole('button', { name: 'Рассчитать по продукту' }).click();
      await shot(page, `quick-order-${viewport.width}`);
      for (const [screen, slug] of [['Рецепты', 'recipes'], ['Схемы разделителей', 'splitters'], ['Технологии', 'technologies'], ['Миры и фабрики', 'worlds'], ['Профили', 'profiles']] as const) {
        await open(page, screen);
        await shot(page, `${slug}-${viewport.width}`);
      }
    });

    test('результат, инструкция и схема', async ({ page }) => {
      await seed(page);
      await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
      await chooseMaximum(page);
      await expect(page.locator('.status-badge.approximate').first()).toHaveText('Допустимое приближение', { timeout: 30000 });
      await expect(page.getByRole('button', { name: 'Рассчитать', exact: true })).toBeVisible({ timeout: 60000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, `results-${viewport.width}`);
      await page.locator('.production-step > summary').first().click();
      await shot(page, `results-step-${viewport.width}`);
      await page.getByRole('button', { name: 'Построить', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Инструкция для строительства', exact: true })).toBeVisible();
      await shot(page, `instruction-${viewport.width}`);
      await page.getByRole('button', { name: 'Схема', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Схема строительства', exact: true }).locator('.schematic-node').first()).toBeVisible({ timeout: 30000 });
      await shot(page, `schematic-${viewport.width}`);
    });
  });
}
