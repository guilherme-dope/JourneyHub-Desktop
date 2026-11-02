import { _electron as electron, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { preparePortugueseProfile } from './test-environment.mjs';

const profile = resolve('outputs/qa/responsive-' + Date.now());
await preparePortugueseProfile(profile);
const env = { ...process.env, JOURNEY_PROFILE: profile };
delete env.ELECTRON_RUN_AS_NODE; delete env.JOURNEY_ENV_FILE;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  await expect(page.locator('.sidebar-footer')).toContainText('Armazenamento local pronto');
  const fit = await app.evaluate(({ BrowserWindow, screen }) => {
    const bounds = BrowserWindow.getAllWindows()[0].getBounds(), area = screen.getPrimaryDisplay().workArea;
    return bounds.width <= area.width && bounds.height <= area.height;
  });
  expect(fit).toBe(true);
  for (const viewport of [{ width: 1366, height: 600 }, { width: 1024, height: 480 }, { width: 960, height: 400 }]) {
    await page.setViewportSize(viewport);
    const sidebar = page.locator('.sidebar');
    await sidebar.evaluate(element => { element.scrollTop = 0; });
    expect(await sidebar.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
    const notifications = page.getByRole('button', { name: 'Notificações', exact: true });
    await notifications.scrollIntoViewIfNeeded();
    await notifications.click();
    await expect(page.getByRole('heading', { name: 'Notificações', exact: true })).toBeVisible();
    await sidebar.evaluate(element => { element.scrollTop = 0; });
    const settings = page.getByRole('button', { name: 'Configurações', exact: true });
    await settings.focus();
    const box = await settings.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Configurações' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings).toBeFocused();
    await sidebar.hover();
    await page.mouse.wheel(0, 1000);
    await expect.poll(() => sidebar.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.screenshot({ path: resolve(profile, 'sidebar-' + viewport.height + '.png') });
  }
  console.log('Responsive sidebar: initial work area, wheel scrolling, notifications, keyboard settings and focus passed at 600/480/400 px.');
} finally { await app.close(); }
