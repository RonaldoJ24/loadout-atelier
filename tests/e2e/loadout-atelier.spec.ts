import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('happy path: inspect the seeded build and generate a recommendation', async ({ page }) => {
  await page.goto('./');

  await expect(page.getByRole('heading', { name: 'Aegis Relay' })).toBeVisible();
  await expect(page.getByText('FIXTURE · OFFLINE')).toBeVisible();
  await expect(page.getByText('Build is valid')).toBeVisible();

  await page.getByRole('button', { name: /Generate recommendation/i }).click();
  await expect(page.getByText('RECOMMENDED', { exact: true })).toBeVisible();
  await expect(page.getByText('Changed slots')).toBeVisible();
});

test('workspace has no automatically detectable accessibility violations', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Import public profile' }).click();
  await expect(page.getByLabel('Public player name')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('mobile workspace stays within the viewport and ability controls expose focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport);

  const ability = page.locator('.ability-card input').first();
  await ability.focus();
  await expect(page.locator('.ability-card:has(input:focus-visible)').first()).toBeVisible();
});

test('export action produces a fixture-only JSON download', async ({ page }) => {
  await page.goto('./');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export build summary/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^loadout-atelier-.*\.json$/);
});

test('failure path: missing equipment is surfaced and local evaluation can replay it', async ({
  page,
}) => {
  await page.goto('./');

  await page.getByRole('combobox', { name: 'Weapon item' }).selectOption('');
  await expect(page.getByText('Build needs attention')).toBeVisible();
  await expect(page.getByText('missing item')).toBeVisible();

  await page.getByRole('button', { name: /Evaluation desk/i }).click();
  await expect(page.getByRole('heading', { name: 'Scenario replay' })).toBeVisible();
  await page.getByRole('button', { name: /Missing Equipment/i }).click();
  await page.getByRole('button', { name: /Run selected scenario/i }).click();
  await expect(page.getByRole('heading', { name: /local scenario outcome/i })).toBeVisible();
  await expect(page.getByText('Missing weapon rejected.')).toBeVisible();
  await expect(page.getByText(/not a claim about production accuracy/i)).toBeVisible();

  const scenarioCount = await page.locator('.scenario-card').count();
  await page.getByRole('button', { name: /Run all \d+ release cases/i }).click();
  await expect(page.getByText(`${scenarioCount}/${scenarioCount} scenarios passed`)).toBeVisible();
});

test('production host keeps public profile fixture-only and identity-free', async ({ page }) => {
  const productionBaseUrl = process.env.PLAYWRIGHT_PRODUCTION_BASE_URL;
  test.skip(
    !productionBaseUrl,
    'Set PLAYWRIGHT_PRODUCTION_BASE_URL to exercise the deployed production host.',
  );

  let profileRequests = 0;
  await page.route('**/api/profile', async (route) => {
    profileRequests += 1;
    await route.abort();
  });
  await page.goto(productionBaseUrl!);
  await page.getByRole('button', { name: 'Import public profile' }).click();
  await page.getByLabel('Public player name').fill('Example_1');
  await page.getByRole('form', { name: 'Import public profile' }).evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
  });
  await expect(page.getByText('Fixture-only mode', { exact: true })).toBeVisible();
  expect(profileRequests).toBe(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('Example_1');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export build summary/i }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let exported = '';
  if (stream) {
    for await (const chunk of stream) exported += chunk.toString();
  }
  expect(exported).not.toContain('Example_1');
});
