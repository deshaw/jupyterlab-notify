import { test, expect } from '@jupyterlab/galata';
import {
  setupNotificationMock,
  createNewNotebook,
  selectCellNotificationMode,
} from './helpers';

test('Toggle notification mode updates icon and metadata', async ({ page }) => {
  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  await page.notebook.enterCellEditingMode(0);

  const firstCell = await page.notebook.getCellLocator(0);
  const toolbarButton = firstCell!.locator(
    '[data-jp-item-name="cellNotifyMenu"]',
  );
  expect(await toolbarButton.isVisible()).toBe(true);

  await page.sidebar.open('right');
  await page.locator('.jp-Collapse-header:has-text("ADVANCED TOOLS")').click();
  const metadata = page.locator('.jp-JSONEditor-host').first();

  // Check initial icon and metadata (default mode: 'default')
  let icon = await toolbarButton.locator('svg').getAttribute('data-icon');
  expect(icon).toBe('notify:bell-outline');
  await expect(metadata).toContainText('"mode": "default"');

  // Toggle to 'default'
  await selectCellNotificationMode(page, 0, 'Default');
  icon = await toolbarButton.locator('svg').getAttribute('data-icon');
  expect(icon).toBe('notify:bell-outline'); // bellOutlineIcon
  await expect(metadata).toContainText('"mode": "default"');
  await expect(metadata).toContainText('"defaultThreshold": "30s"');

  // Toggle to 'on-error'
  await selectCellNotificationMode(page, 0, 'On error');
  icon = await toolbarButton.locator('svg').getAttribute('data-icon');
  expect(icon).toBe('notify:bell-alert'); // bellAlertIcon
  await expect(metadata).toContainText('"mode": "on-error"');

  // Toggle to 'never'
  await selectCellNotificationMode(page, 0, 'Never');
  icon = await toolbarButton.locator('svg').getAttribute('data-icon');
  expect(icon).toBe('notify:bell-off'); // bellClockIcon
  await expect(metadata).toContainText('"mode": "never"');

  // Toggle to 'custom-timeout' with 1 min option
  await selectCellNotificationMode(page, 0, 'Custom Timeout', '1 min');
  icon = await toolbarButton.locator('svg').getAttribute('data-icon');
  expect(icon).toBe('notify:bell-clock'); // bellClockIcon for custom timeout
  await expect(metadata).toContainText('"mode": "custom-timeout"');
  await expect(metadata).toContainText('"customTimeout": "1m"');

  // Toggle to 'custom-timeout' with 30 min option
  await selectCellNotificationMode(page, 0, 'Custom Timeout', '30 min');
  await expect(metadata).toContainText('"mode": "custom-timeout"');
  await expect(metadata).toContainText('"customTimeout": "30m"');

  // Test valid custom input
  await selectCellNotificationMode(
    page,
    0,
    'Custom Timeout',
    'Custom',
    '4',
    'seconds',
  );
  await expect(metadata).toContainText('"mode": "custom-timeout"');
  await expect(metadata).toContainText('"customTimeout": "4s"');

  // Test valid custom input
  await selectCellNotificationMode(
    page,
    0,
    'Custom Timeout',
    'Custom',
    '4',
    'hours',
  );
  await expect(metadata).toContainText('"mode": "custom-timeout"');
  await expect(metadata).toContainText('"customTimeout": "4h"');
});

test('Notification triggers on cell execution with "default" mode', async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.jupyterapp.serviceManager.settings.save(
      'jupyterlab-notify:plugin',
      JSON.stringify({ defaultThreshold: 0.5 }),
    );
  });

  // Reload so that new settings are applied
  await page.reload();

  // To Capture notifications in MockNotifications array
  await setupNotificationMock(page);

  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  await selectCellNotificationMode(page, 0, 'Default');

  await page.notebook.enterCellEditingMode(0);
  await page.keyboard.type('1');
  await page.notebook.runCell(0);
  await page.waitForTimeout(500); // Wait for notification

  // Verify no notification as defaultThreshold was 0.5 and cell took less than that to finish executing
  const noNotifications = await page.evaluate(() => {
    return window.mockNotifications;
  });
  expect(noNotifications.length).toBe(0);

  // Execute a cell with execution time above threshold time
  await page.notebook.enterCellEditingMode(0);
  await page.keyboard.press('Shift+Backspace');
  await page.keyboard.type('from time import sleep;sleep(0.6)');
  await page.notebook.runCell(0);
  await page.waitForTimeout(500); // Wait for notification

  // Verify successful notification
  const successNotifications = await page.evaluate(() => {
    return window.mockNotifications;
  });
  expect(successNotifications.length).toBeGreaterThan(0);

  expect(successNotifications[0].title).toBe(
    'test: Cell execution completed successfully',
  );
  expect(successNotifications[0].body).toMatch(/Cell \[\d+\]/);

  // Execute a failing cell
  await selectCellNotificationMode(page, 1, 'Default');
  await page.notebook.enterCellEditingMode(1);
  await page.keyboard.type('sleep(0.5);raise Exception("Error")');
  await page.notebook.runCell(1);
  await page.waitForTimeout(500); // Wait for notification

  // Verify error notification
  const allNotifications = await page.evaluate(() => {
    return window.mockNotifications;
  });
  expect(allNotifications.length).toBeGreaterThan(1);
  expect(allNotifications[1].title).toBe('test: Cell execution failed');
});

test('Error notifications trigger for default mode when alwaysNotifyOnError is enabled', async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.jupyterapp.serviceManager.settings.save(
      'jupyterlab-notify:plugin',
      JSON.stringify({
        defaultThreshold: 1,
        alwaysNotifyOnError: true,
      }),
    );
  });

  await page.reload();

  await setupNotificationMock(page);
  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  // In default mode, failure should notify even if execution is below threshold.
  await selectCellNotificationMode(page, 0, 'Default');
  await page.notebook.enterCellEditingMode(0);
  await page.keyboard.type('raise Exception("Default mode failure")');
  await page.notebook.runCell(0);
  await page.waitForTimeout(500);

  const notifications = await page.evaluate(() => window.mockNotifications);
  expect(notifications.length).toBe(1);
  expect(notifications[0].title).toBe('test: Cell execution failed');
  expect(notifications[0].body).toContain('Default mode failure');
});

test('Error notifications trigger for custom-timeout mode when alwaysNotifyOnError is enabled', async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.jupyterapp.serviceManager.settings.save(
      'jupyterlab-notify:plugin',
      JSON.stringify({
        defaultThreshold: 1,
        alwaysNotifyOnError: true,
      }),
    );
  });

  await page.reload();

  await setupNotificationMock(page);
  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  // In custom-timeout mode, failure should notify immediately.
  await selectCellNotificationMode(page, 0, 'Custom Timeout', '1 min');
  await page.notebook.enterCellEditingMode(0);
  await page.keyboard.type('raise Exception("Custom-timeout mode failure")');
  await page.notebook.runCell(0);
  await page.waitForTimeout(500);

  const notifications = await page.evaluate(() => window.mockNotifications);
  expect(notifications.length).toBe(1);
  expect(notifications[0].title).toBe('test: Cell execution failed');
  expect(notifications[0].body).toContain('Custom-timeout mode failure');
});

test('Error notifications do not trigger for default and custom-timeout when alwaysNotifyOnError is disabled', async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.jupyterapp.serviceManager.settings.save(
      'jupyterlab-notify:plugin',
      JSON.stringify({
        defaultThreshold: 1,
        alwaysNotifyOnError: false,
      }),
    );
  });

  await page.reload();

  await setupNotificationMock(page);
  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  await selectCellNotificationMode(page, 0, 'Default');
  await page.notebook.enterCellEditingMode(0);
  await page.keyboard.type('raise Exception("Default mode failure")');
  await page.notebook.runCell(0);
  await page.waitForTimeout(500);

  let notifications = await page.evaluate(() => window.mockNotifications);
  expect(notifications.length).toBe(0);

  await selectCellNotificationMode(page, 1, 'Custom Timeout', '1 min');
  await page.notebook.enterCellEditingMode(1);
  await page.keyboard.type('raise Exception("Custom-timeout mode failure")');
  await page.notebook.runCell(1);
  await page.waitForTimeout(500);

  notifications = await page.evaluate(() => window.mockNotifications);
  expect(notifications.length).toBe(0);
});

test('Notification triggers only on error with "on-error" mode', async ({
  page,
}) => {
  await setupNotificationMock(page);

  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  await selectCellNotificationMode(page, 0, 'On error');

  // Execute a successful cell
  await page.notebook.enterCellEditingMode(0);
  await page.keyboard.type('print("Hello")');
  await page.notebook.runCell(0);
  await page.waitForTimeout(500); // Wait for notification

  // No notification expected for success
  const successNotifications = await page.evaluate(
    () => window.mockNotifications,
  );
  expect(successNotifications.length).toBe(0);

  // Execute a failing cell
  await page.notebook.enterCellEditingMode(0);
  await page.keyboard.type('raise Exception("Error")');
  await page.notebook.runCell(0);
  await page.waitForTimeout(500); // Wait for notification

  // Verify error notification
  const errorNotifications = await page.evaluate(
    () => window.mockNotifications,
  );
  expect(errorNotifications.length).toBe(1);
  expect(errorNotifications[0].title).toBe('test: Cell execution failed');
});

test('Notification triggers on kernel death on "on-error" mode', async ({
  page,
}) => {
  await setupNotificationMock(page);
  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');
  await selectCellNotificationMode(page, 0, 'On error');

  // Execute a cell that kills kernel
  await page.notebook.enterCellEditingMode(0);

  await page.keyboard.type(
    'import os, signal;os.kill(os.getpid(), signal.SIGKILL)',
  );
  const runCellPromise = page.notebook.runCell(0);
  await page
    .locator('.jp-Dialog-header:has-text("Kernel Restarting")')
    .waitFor({ state: 'visible', timeout: 5000 });

  // Verify error notification
  const errorNotifications = await page.evaluate(
    () => window.mockNotifications,
  );
  expect(errorNotifications.length).toBe(1);
  expect(errorNotifications[0].title).toBe('test: Cell execution failed');

  // Don't wait for the promise since kernel was killed
  runCellPromise.catch(() => {});
});

test('Notification triggers only on timeout with "custom-timeout" mode', async ({
  page,
}) => {
  await setupNotificationMock(page);

  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  // Toggle to 'custom-timeout' with custom timout value
  await selectCellNotificationMode(
    page,
    0,
    'Custom Timeout',
    'Custom',
    '1',
    'seconds',
  );

  // Execute a long-running cell (1.5 seconds)
  await page.notebook.enterCellEditingMode(0);
  await page.keyboard.type('import time; time.sleep(1.5)');
  await page.notebook.runCell(0);
  await page.waitForTimeout(500); // Wait for notification

  // Verify timeout notification
  const notifications = await page.evaluate(() => window.mockNotifications);
  expect(notifications.length).toBeGreaterThan(0);
  expect(notifications[0].title).toBe('test: Cell execution timeout reached');
});

test('Notification does not trigger on execution completion with "custom-timeout" mode', async ({
  page,
}) => {
  await setupNotificationMock(page);

  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  // Toggle to 'custom-timeout' with custom timout value
  await selectCellNotificationMode(
    page,
    0,
    'Custom Timeout',
    'Custom',
    '1',
    'seconds',
  );

  // Execute a long-running cell (1.5 seconds)
  await page.notebook.enterCellEditingMode(0);
  await page.keyboard.type('"test"');
  await page.notebook.runCell(0);
  await page.waitForTimeout(1500); // Wait for notification

  // Verify timeout notification
  const notifications = await page.evaluate(() => window.mockNotifications);
  expect(notifications.length).toBe(0);
});

test('Displays warning when email is enabled but not configured', async ({
  page,
}) => {
  // Enable email in settings
  await page.evaluate(async () => {
    await window.jupyterapp.serviceManager.settings.save(
      'jupyterlab-notify:plugin',
      JSON.stringify({ mail: true, defaultMode: 'default' }),
    );
  });

  // Reload so that new settings are applied
  await page.reload();

  // Execute a cell with 'always' mode
  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  await page.notebook.runCell(0);

  // Note: This test assumes that email configuration is not set up in the CI environment.
  // It may fail if run locally where email is configured.
  const warning = await page.waitForSelector('.jp-toast-message', {
    timeout: 2000,
  });
  const text = await warning.textContent();
  expect(text).toContain('Email Not Configured');
});
