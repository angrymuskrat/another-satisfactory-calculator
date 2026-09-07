import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });

test('расчёт, русский поиск, политики и невыполнимый заказ', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Спланируйте следующую фабрику' })).toBeVisible();
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await expect(page.locator('.results-heading').getByText('Оптимум найден', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Готовая продукция' })).toBeVisible();
  await page.screenshot({ path: 'output/playwright/planner-result.png', fullPage: true });
  await page.getByRole('button', { name: 'Добавить продукт' }).click();
  await page.getByLabel('Распределение между продуктами').selectOption('weighted');
  await expect(page.getByRole('textbox', { name: 'Вес продукта 2', exact: true })).toBeVisible();
  await page.getByLabel('Распределение между продуктами').selectOption('priority');
  await page.getByRole('button', { name: 'Повысить приоритет продукта 2' }).click();
  await expect(page.getByText('Требуется пересчёт', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Рецепты', exact: true }).click();
  await page.getByRole('textbox', { name: 'Поиск рецептов' }).fill('желез');
  await expect(page.locator('.recipe-card').first()).toBeVisible();
  const firstRecipe = page.locator('.recipe-card').first();
  const toggle = firstRecipe.getByRole('checkbox', { name: /^Включить рецепт / });
  const wasChecked = await toggle.isChecked();
  await toggle.setChecked(!wasChecked);
  await expect(toggle).toBeChecked({ checked: !wasChecked });
  await toggle.setChecked(wasChecked);
  await page.getByRole('button', { name: 'Планировщик', exact: true }).click();
  await page.getByRole('button', { name: 'Заданный выпуск Выполнить производственный заказ' }).click();
  await page.getByRole('textbox', { name: 'Количество продукта 1', exact: true }).fill('1');
  await page.getByRole('textbox', { name: 'Количество продукта 2', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await expect(page.locator('.results-heading').getByText('Оптимум найден', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('textbox', { name: 'Количество продукта 1', exact: true }).fill('1000000');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Заказ невыполним' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Достижимый выпуск' })).toBeVisible();
  await expect(page.locator('.feasible-alternative')).toContainText('% заказа');
  await expect(page.locator('.feasible-alternative')).toContainText('Исходный заказ остаётся невыполнимым');
  await expect(page.getByRole('textbox', { name: 'Количество продукта 1', exact: true })).toHaveValue('1000000');
});

test('профиль хранит и восстанавливает план пользователя', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Профили', exact: true }).click();
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await page.getByLabel('Логин', { exact: true }).fill(`ui-${Date.now()}`);
  await page.getByLabel('Пароль', { exact: true }).fill('Factory-test-12345');
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Название сохраняемого плана' }).fill('Проверка сохранения');
  await page.getByRole('button', { name: 'Сохранить текущий' }).click();
  await expect(page.getByRole('heading', { name: 'Проверка сохранения' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Название плана', exact: true }).fill('Изменённый черновик');
  await page.getByRole('button', { name: 'Открыть', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Название плана', exact: true })).toHaveValue('Проверка сохранения');
  await page.getByRole('textbox', { name: 'Название сохраняемого плана' }).fill('Имя новой копии');
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByText('Профиль обновлён текущими настройками.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Проверка сохранения' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Имя новой копии' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Удалить профиль Проверка сохранения' }).click();
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проверка сохранения' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
});

test('мобильная ширина и клавиатура', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Рассчитать', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Продукт 1', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Поиск: Продукт 1', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Поиск: Продукт 1', exact: true })).toHaveCount(0);
});

test('черновик, экспорт и безопасный импорт JSON', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Название плана', exact: true }).fill('Импорт и экспорт');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1') ?? '{}').name)).toBe('Импорт и экспорт');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Название плана', exact: true })).toHaveValue('Импорт и экспорт');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспортировать JSON' }).click();
  const filePath = await (await downloading).path();
  const exported = JSON.parse(await readFile(filePath!, 'utf8'));
  expect(exported.name).toBe('Импорт и экспорт');
  await page.getByLabel('Файл плана JSON').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"bad":true}') });
  await expect(page.locator('.toast[role="status"]')).toContainText('Некорректный план');
  await expect(page.getByRole('textbox', { name: 'Название плана', exact: true })).toHaveValue('Импорт и экспорт');
  await page.getByRole('textbox', { name: 'Название плана', exact: true }).fill('Другой план');
  await page.getByLabel('Файл плана JSON').setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await expect(page.getByRole('textbox', { name: 'Название плана', exact: true })).toHaveValue('Импорт и экспорт');
});
