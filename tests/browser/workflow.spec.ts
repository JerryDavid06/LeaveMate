import { expect, test } from '@playwright/test';

test('departure workflow, combined repeating voice, acknowledgement and responsive navigation', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await page.addInitScript({ path: 'tests/browser/speech-mock.js' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to LeaveMate' })).toBeVisible();
  await expect(page.getByText('Live updates connected')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveCount(5);
  await expect(page.getByText('Simulation Mode', { exact: true })).toBeVisible();

  async function add(name: string, category: string, optional = false) {
    await page.getByRole('button', { name: 'Add item', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add a belonging' });
    await dialog.getByRole('textbox', { name: 'Item name' }).fill(name);
    await dialog.getByRole('combobox', { name: 'Category' }).fill(category);
    if (optional) await dialog.getByLabel('Priority').selectOption('optional');
    await dialog.getByRole('button', { name: 'Add belonging' }).click();
    await expect(dialog).toBeHidden();
  }

  await add('Travel wallet', 'Personal Belongings');
  await add('House keys', 'Keys', true);
  await add('Laptop', 'Electronics');
  await page.getByRole('link', { name: 'Item Management' }).click();
  const search = page.getByRole('textbox', { name: 'Search items' });
  await search.fill('wallet');
  await expect(page.getByRole('button', { name: 'View Travel wallet details' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View Laptop details' })).toHaveCount(0);
  await search.clear();
  await page.getByRole('button', { name: 'Edit Travel wallet' }).click();
  await page.getByLabel('Description').fill('Brown leather wallet');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByLabel('Verification timeout').fill('1');
  await settings.getByRole('button', { name: 'Device' }).click();
  await expect(settings.getByText('Not connected', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Save settings' }).click();

  await page.getByRole('link', { name: 'Detection & Verification' }).click();
  await page.getByRole('checkbox', { name: /Travel wallet/ }).uncheck();
  await page.getByRole('checkbox', { name: /House keys/ }).uncheck();
  await page.getByRole('button', { name: 'Run test departure' }).click();
  await expect(page.getByRole('heading', { name: 'Live verification' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
  const speech = () => page.evaluate(() => (window as unknown as { speechTimeline: string[] }).speechTimeline.slice());
  await expect.poll(async () => (await speech()).length, { timeout: 9000 }).toBeGreaterThanOrEqual(2);
  const announcements = await speech();
  expect(announcements[0]).toMatch(/House keys.*Travel wallet|Travel wallet.*House keys/);
  expect(announcements[1]).toBe(announcements[0]);

  await page.getByRole('button', { name: 'Notifications, 1 unread' }).click();
  await page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: /Travel wallet/ }).click();
  const missing = page.getByRole('dialog', { name: 'Missing belongings' });
  await expect(missing.getByText('High priority')).toBeVisible();
  await missing.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await expect(missing.getByRole('button', { name: 'Mark as read', exact: true })).toHaveCount(0);
  await missing.getByRole('button', { name: 'Acknowledge & stop' }).click();
  await expect(missing.getByText('Acknowledged', { exact: true })).toBeVisible();
  const count = (await speech()).length;
  const acknowledgedAt = Date.now();
  await missing.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('link', { name: 'Alerts & History' }).click();
  await page.getByRole('button', { name: 'Verification History' }).click();
  await expect(page.getByRole('cell', { name: 'Incomplete' })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await downloaded).suggestedFilename()).toBe('leavemate-verification-history.csv');

  await page.getByRole('link', { name: 'Analytics & Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Frequently missed items' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Travel wallet, 1 miss/ })).toBeVisible();
  await page.getByLabel('Report source').selectOption('hardware');
  await expect(page.getByText('No verification activity')).toBeVisible();
  await page.getByLabel('Report source').selectOption('simulation');
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Report start date' }).or(page.getByLabel('Report start date'))).toBeVisible();

  await page.getByRole('link', { name: 'Item Management' }).click();
  await page.getByRole('button', { name: 'View Travel wallet details' }).click();
  await expect(page.getByRole('dialog').getByText('Brown leather wallet')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Missing', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Delete Laptop' }).click();
  await page.getByRole('button', { name: 'Delete belonging', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View Laptop details' })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('link', { name: 'Detection & Verification' }).click();
  await page.getByRole('button', { name: 'Run test departure' }).click();
  await expect(page.getByText('Departure verified. All belongings were detected.')).toBeVisible();
  await page.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByText('50%', { exact: true })).toBeVisible();
  if (process.env.LEAVEMATE_SCREENSHOT) {
    await page.getByRole('button', { name: 'Dismiss message' }).click().catch(() => {});
    await expect(page.getByRole('heading', { name: 'Verification outcomes' })).toBeVisible();
    await page.screenshot({ path: process.env.LEAVEMATE_SCREENSHOT, fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to LeaveMate' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  for (const label of ['Item Management', 'Detection & Verification', 'Alerts & History', 'Analytics & Reports']) {
    await page.getByRole('link', { name: label }).click();
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  if (Date.now() - acknowledgedAt < 4300) await page.waitForTimeout(4300 - (Date.now() - acknowledgedAt));
  expect((await speech()).length).toBe(count);
  expect(runtimeErrors).toEqual([]);
});
