import { expect, test } from '@playwright/test';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });

test('регистрация объясняет HTTP-ошибки и оставляет форму доступной для исправления', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Профили', exact: true }).click();
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await page.getByLabel('Логин', { exact: true }).fill('factory-user');
  await page.getByLabel('Пароль', { exact: true }).fill('Factory-test-12345');
  for (const [status, explanation] of [
    [400, /3–40.*8–128/],
    [403, /адрес.*HTTP\/HTTPS/],
    [409, /занят.*другой логин/],
    [429, /минут/],
    [502, /сервер.*позже/i],
  ] as const) {
    await page.route('**/api/auth/register', route => route.fulfill({
      status, contentType: status === 502 ? 'text/html' : 'application/json',
      body: status === 502 ? '<html>Bad gateway</html>' : JSON.stringify({ error: 'Ошибка' }),
    }));
    await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(`HTTP ${status}`);
    await expect(page.getByRole('alert')).toContainText(explanation);
    await expect(page.getByLabel('Логин', { exact: true })).toHaveValue('factory-user');
    await expect(page.getByRole('button', { name: 'Зарегистрироваться', exact: true })).toBeEnabled();
    await page.unroute('**/api/auth/register');
  }
});

test('вход различает неверные данные и обрыв соединения, повторная попытка доступна', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Профили', exact: true }).click();
  await page.getByLabel('Логин', { exact: true }).fill('factory-user');
  await page.getByLabel('Пароль', { exact: true }).fill('Factory-test-12345');
  await page.route('**/api/auth/login', route => route.fulfill({ status: 401, json: { error: 'Неверный логин или пароль.' } }));
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/HTTP 401/);
  await expect(page.getByRole('alert')).toContainText(/раскладку/);
  await page.unroute('**/api/auth/login');
  await page.route('**/api/auth/login', route => route.abort('connectionfailed'));
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/соединение/);
  await expect(page.getByRole('alert')).not.toContainText('HTTP');
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeEnabled();
});

test('требования доступны до отправки, конфликт профиля не становится ошибкой занятого логина', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Профили', exact: true }).click();
  await expect(page.getByLabel('Логин', { exact: true })).toHaveAccessibleDescription(/@/);
  await expect(page.getByLabel('Пароль', { exact: true })).toHaveAccessibleDescription(/8–128/);
  await page.route('**/api/session', route => route.fulfill({ json: { user: { id: 'test-user', username: 'factory-user' } } }));
  await page.route('**/api/profiles', route => route.fulfill({
    status: route.request().method() === 'POST' ? 409 : 200,
    json: route.request().method() === 'POST' ? { error: 'Запись изменена в другой вкладке.' } : { profiles: [] },
  }));
  await page.reload();
  await page.getByRole('button', { name: 'Профили', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название сохраняемого плана' }).fill('План');
  await page.getByRole('button', { name: 'Сохранить текущий' }).click();
  await expect(page.getByRole('alert')).toContainText('Запись изменена в другой вкладке.');
  await expect(page.getByRole('alert')).not.toContainText('логин');
});
