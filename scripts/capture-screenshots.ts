import { mkdir, copyFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch();
const docsDirectory = new URL('../docs/screenshots/', import.meta.url);
const outputDirectory = new URL('../outputs/screenshots/', import.meta.url);
await mkdir(docsDirectory, { recursive: true });
await mkdir(outputDirectory, { recursive: true });

const desktop = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await desktop.goto(baseUrl, { waitUntil: 'networkidle' });
await desktop.screenshot({
  path: new URL('workspace.png', docsDirectory).pathname,
  fullPage: false,
});
await desktop.getByRole('button', { name: /Generate recommendation/i }).click();
await desktop.getByText('RECOMMENDED', { exact: true }).waitFor();
await desktop.locator('.recommendation-zone').screenshot({
  path: new URL('comparison.png', docsDirectory).pathname,
});
await desktop.getByRole('button', { name: /Evaluation desk/i }).click();
await desktop.getByRole('button', { name: /Run all 34 release cases/i }).click();
await desktop.getByText('34/34 scenarios passed').waitFor();
await desktop.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
await desktop.screenshot({
  path: new URL('evaluations.png', docsDirectory).pathname,
  fullPage: false,
});

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(baseUrl, { waitUntil: 'networkidle' });
await mobile.screenshot({ path: new URL('mobile.png', docsDirectory).pathname, fullPage: false });
await browser.close();

for (const filename of ['workspace.png', 'comparison.png', 'evaluations.png', 'mobile.png']) {
  await copyFile(new URL(filename, docsDirectory), new URL(filename, outputDirectory));
}

console.log('Captured four sanitized fixture-only screenshots.');
