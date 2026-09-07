import { expect, test } from '@playwright/test';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });

test('выбор предмета закрывается с возвратом фокуса и позволяет уйти Tab', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Продукт 1', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Поиск: Продукт 1', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Поиск: Продукт 1', exact: true }).fill('Несуществующий предмет');
  await expect(page.getByRole('status').filter({ hasText: 'Предметы не найдены' })).toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('textbox', { name: 'Минимум продукта 1', exact: true })).toBeFocused();
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Поиск: Продукт 1', exact: true }).fill('Медный слиток');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAccessibleDescription('Медный слиток');
});

test('редактор мира и просмотр изменений получают фокус, отмена возвращает к миру', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Миры и фабрики', exact: true }).click();
  await page.getByRole('button', { name: 'Создать пустой мир', exact: true }).click();
  const edit = page.getByRole('button', { name: 'Изменить прогресс Новое прохождение', exact: true });
  await edit.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Черновик прогресса мира' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Имя прохождения' })).toBeFocused();
  await page.getByRole('button', { name: 'Просмотреть изменения мира', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Просмотр изменений мира' })).toBeFocused();
  await page.getByRole('button', { name: 'Отменить черновик мира', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(edit).toBeFocused();
});

test('сброс удерживает фокус внутри диалога и возвращает его после Escape и отмены', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Сбросить план', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Начать с исходного плана?' });
  await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Сбросить', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(trigger).toBeFocused();
});

test('числовое поле объясняет неверный ввод и объявляет восстановленное значение', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Технологии', exact: true }).click();
  const frequency = page.getByRole('textbox', { name: 'Частота производства', exact: true });
  await frequency.fill('251');
  await expect(frequency).toHaveAttribute('aria-invalid', 'true');
  await expect(frequency).toHaveAccessibleDescription(/от 1 до 250/);
  await page.keyboard.press('Tab');
  await expect(frequency).toHaveValue('100');
  await expect(page.getByRole('status').filter({ hasText: 'Восстановлено: 100' })).toBeVisible();
  await frequency.fill('99,5');
  await expect(frequency).toHaveAttribute('aria-invalid', 'false');
  await page.keyboard.press('Tab');
  await expect(frequency).toHaveValue('99.5');
});

test('профиль: подтверждение удаления получает фокус и возвращает его после отмены', async ({ page }) => {
  await page.goto('/');
  const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('ficsit-plan-v1')!));
  await page.route('**/api/session', route => route.fulfill({ json: { user: { id: 'a11y-user', username: 'Проверка' } } }));
  await page.route('**/api/profiles', route => route.fulfill({ json: { profiles: [{ id: 'a11y-profile', name: 'Проверка фокуса', revision: 1, updatedAt: '2026-09-06T00:00:00Z', data: plan }] } }));
  await page.getByRole('button', { name: 'Профили', exact: true }).click();
  const remove = page.getByRole('button', { name: 'Удалить профиль Проверка фокуса', exact: true });
  await remove.focus();
  await page.keyboard.press('Enter');
  const confirmation = page.getByRole('group', { name: 'Удаление профиля Проверка фокуса', exact: true });
  await expect(confirmation.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(remove).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(remove).toBeFocused();
});

test('рецепты и расчёт объявляют краткий статус, переключатели работают с клавиатуры', async ({ page }) => {
  await page.goto('/');
  const target = page.getByRole('button', { name: 'Заданный выпуск Выполнить производственный заказ', exact: true });
  await target.focus();
  await page.keyboard.press('Enter');
  await expect(target).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Рецепты', exact: true }).click();
  await page.getByRole('textbox', { name: 'Поиск рецептов' }).fill('Железный слиток');
  await expect(page.locator('.catalog-summary').getByRole('status')).toContainText('Найдено');
  const toggle = page.getByRole('checkbox', { name: 'Включить рецепт Железный слиток', exact: true });
  await toggle.focus();
  const enabled = await toggle.isChecked();
  await page.keyboard.press('Space');
  await expect(toggle).toBeChecked({ checked: !enabled });
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.results-column').getByRole('status')).toHaveText('Допустимое приближение', { timeout: 35_000 });
  await expect(page.locator('.results-column')).not.toHaveAttribute('aria-live');
  await page.getByRole('textbox', { name: 'Минимум продукта 1', exact: true }).fill('1');
  await expect(page.locator('.results-column').getByRole('status')).toContainText('Требуется пересчёт');
});

test('основная навигация доступна клавиатурой, экраны помещаются в 390px', async ({ page }) => {
  await page.goto('/');
  const names = ['Планировщик', 'Рецепты', 'Технологии', 'Миры и фабрики', 'Профили'];
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Перейти к содержимому' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await skip.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'FICSIT — планировщик' })).toBeFocused();
  for (const name of names) {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name, exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [index, name] of names.entries()) {
    await page.getByRole('button', { name, exact: true }).click();
    const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(width.content, name).toBeLessThanOrEqual(width.viewport + 1);
    await page.screenshot({ path: `output/playwright/p1-mobile-${index}.png` });
  }
});

test('мобильная навигация и переход к содержимому не прячут заголовок под меню', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('link', { name: 'Перейти к содержимому' }).focus();
  await page.keyboard.press('Enter');
  const heading = page.getByRole('heading', { level: 1 });
  const menu = page.locator('.sidebar');
  let top = (await heading.boundingBox())!.y;
  let bottom = (await menu.boundingBox())!.y + (await menu.boundingBox())!.height;
  expect(top).toBeGreaterThanOrEqual(bottom);
  await page.getByRole('button', { name: 'Рецепты', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 1600));
  await page.getByRole('button', { name: 'Технологии', exact: true }).click();
  top = (await heading.boundingBox())!.y;
  bottom = (await menu.boundingBox())!.y + (await menu.boundingBox())!.height;
  expect(top).toBeGreaterThanOrEqual(bottom);
  expect(top).toBeLessThan(844);
});

test('контраст и размер основных второстепенных подписей', async ({ page }) => {
  await page.goto('/');
  for (const name of ['Планировщик', 'Рецепты', 'Технологии', 'Миры и фабрики']) {
    await page.getByRole('button', { name, exact: true }).click();
    const samples = await page.locator('.constraint-summary, .field-label, .source-preview, .hint, .recipe-title small, .building-card small').evaluateAll(elements => {
      const rgb = (text: string) => text.match(/[\d.]+/g)?.map(Number) ?? [];
      const luminance = (color: number[]) => color.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
      return elements.filter(el => el.getClientRects().length && el.textContent?.trim()).map(el => {
        let ancestor: Element | null = el, background: number[] = [17, 20, 22];
        let gradient = false;
        while (ancestor) {
          const style = getComputedStyle(ancestor);
          gradient ||= style.backgroundImage !== 'none';
          const bg = rgb(style.backgroundColor);
          if (bg.length === 3 || (bg.length === 4 && bg[3] === 1)) { background = bg; break; }
          ancestor = ancestor.parentElement;
        }
        const style = getComputedStyle(el), foreground = luminance(rgb(style.color)), back = luminance(background);
        return { label: el.textContent!.trim().slice(0, 70), ratio: (Math.max(foreground, back) + .05) / (Math.min(foreground, back) + .05), size: parseFloat(style.fontSize), gradient };
      }).filter(sample => !sample.gradient);
    });
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(sample.size, `${name}: ${sample.label}`).toBeGreaterThanOrEqual(12);
      expect(sample.ratio, `${name}: ${sample.label}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
