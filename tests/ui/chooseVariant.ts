import { expect, type Page } from '@playwright/test';

/** Existing detail tests explicitly accept the first (maximum/compact) proposal.
 * A lone solved variant is shown on its own once the search ends, so its card can vanish before the click. */
export async function chooseMaximum(page: Page) {
  const choice = page.getByRole('button', { name: 'Использовать вариант', exact: true }).first();
  const accept = page.getByRole('button', { name: 'Принять вариант', exact: true });
  await expect(choice.or(accept).or(page.locator('.result-board')).or(page.locator('.result-problem')).or(page.locator('.results-column .alert.error')).first()).toBeVisible({ timeout: 30000 });
  if (await accept.isVisible()) await accept.click();
  else if (await choice.isVisible()) await choice.click({ timeout: 5000 }).catch(async () => { if (await accept.isVisible()) await accept.click(); });
}
