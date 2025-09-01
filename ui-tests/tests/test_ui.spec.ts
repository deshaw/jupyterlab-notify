declare global {
  interface Window {
    mockNotifications: Array<{ title: string; body?: string }>;
  }
}

import { test, expect, IJupyterLabPageFixture } from '@jupyterlab/galata';

// Not same as ModeId of index.ts, these are UI labels
type ModeId = 'Default' | 'Never' | 'On error' | 'Custom Timeout';

async function setupNotificationMock(
  page: IJupyterLabPageFixture,
): Promise<void> {
  await page.evaluate(() => {
    window.mockNotifications = [];

    // Mock the Notification constructor
    const MockNotification = function (
      title: string,
      options?: NotificationOptions,
    ) {
      window.mockNotifications.push({ title, body: options?.body });
    } as any;

    window.Notification = MockNotification;

    // Override the read-only 'permission' property
    Object.defineProperty(window.Notification, 'permission', {
      value: 'granted',
      writable: true,
      configurable: true,
    });

    // Mock requestPermission
    window.Notification.requestPermission = async () => 'granted';
  });
}

// Helper function to select notification mode
async function selectNotificationMode(
  page: IJupyterLabPageFixture,
  cellIdx: number,
  mode: ModeId,
  submode: string | null = null,
  value: string | null = null,
  unit: string | null = null,
) {
  await page.notebook.selectCells(cellIdx);
  const cell = await page.notebook.getCellLocator(cellIdx);
  const cellToolbarButton = cell!.locator(
    '[data-jp-item-name="cellNotifyMenu"]',
  );
  await cellToolbarButton.click();

  const cellNotifyMenu = page.locator('.lm-Menu');
  await expect(cellNotifyMenu).toBeVisible();
  await cellNotifyMenu.locator(`.lm-Menu-item:has-text("${mode}")`).click();

  // Handle submenu for custom timeout options
  if (submode) {
    const notifySubMenu = page.locator('.lm-Menu').last();
    await expect(notifySubMenu).toBeVisible();
    await cellNotifyMenu
      .locator(`.lm-Menu-item:has-text('${submode}')`)
      .last()
      .click();

    // Handle custom value input
    if (value) {
      await page.locator('.jp-notify-time-input-field ').fill(value);
      if (unit) {
        await page
          .locator('select.jp-notify-time-unit-select')
          .selectOption({ value: unit });
      }
      await page.keyboard.press('Enter');
    }
  }
}

// Helper function to modify settings #TODO doesn't work!
// async function setNotifySettings(page: IJupyterLabPageFixture, settings: any) {
//   await page.evaluate(async () => {
//     await window.jupyterapp.serviceManager.settings.save(
//       'jupyterlab-notify:plugin',
//       JSON.stringify(settings),
//     );
//   });

//   // Reload so that new settings are applied
//   await page.reload();
// }

async function createNewNotebook(page: IJupyterLabPageFixture, name: string) {
  // Create a new notebook
  await page.notebook.createNew(name);

  // Select default kernel if dialog appears
  const selectButton = page.locator('.jp-mod-accept:has-text("Select")');
  if (await selectButton.isVisible()) {
    await selectButton.click();
  }
}

/**
 * Test for the jupyterlab-notify extension to verify that
 * toggling notification modes correctly updates both the toolbar
 * icon and cell metadata.
 */
test('Toggle notification mode updates icon and metadata', async ({ page }) => {
  // Create a new notebook
  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  // Select the first cell
  await page.notebook.selectCells(0);

  // Find the notify toolbar button
  const firstCell = await page.notebook.getCellLocator(0);
  const toolbarButton = firstCell!.locator(
    '[data-jp-item-name="cellNotifyMenu"]',
  );
  expect(await toolbarButton.isVisible()).toBe(true);

  // Setup to verify cell-metadata
  await page.sidebar.open('right');
  await page.locator('.jp-Collapse-header:has-text("ADVANCED TOOLS")').click();
  const metadata = page.locator('.jp-JSONEditor-host').first();

  // Check initial icon and metadata (default mode: 'default')
  let icon = await toolbarButton.locator('svg').getAttribute('data-icon');
  expect(icon).toBe('notify:bell-outline'); // bellOutlineIcon
  await expect(metadata).toContainText('"mode": "default"');

  // Toggle to 'default'
  await selectNotificationMode(page, 0, 'Default');
  icon = await toolbarButton.locator('svg').getAttribute('data-icon');
  expect(icon).toBe('notify:bell-outline'); // bellOutlineIcon
  await expect(metadata).toContainText('"mode": "default"');

  // Toggle to 'on-error'
  await selectNotificationMode(page, 0, 'On error');
  icon = await toolbarButton.locator('svg').getAttribute('data-icon');
  expect(icon).toBe('notify:bell-alert'); // bellAlertIcon
  await expect(metadata).toContainText('"mode": "on-error"');

  // Toggle to 'never'
  await selectNotificationMode(page, 0, 'Never');
  icon = await toolbarButton.locator('svg').getAttribute('data-icon');
  expect(icon).toBe('notify:bell-off'); // bellClockIcon
  await expect(metadata).toContainText('"mode": "never"');

  // Toggle to 'custom-timeout' with 1 min option
  await selectNotificationMode(page, 0, 'Custom Timeout', '1 min');
  icon = await toolbarButton.locator('svg').getAttribute('data-icon');
  expect(icon).toBe('notify:bell-clock'); // bellClockIcon for custom timeout
  await expect(metadata).toContainText('"mode": "custom-timeout"');
  await expect(metadata).toContainText('"threshold": "1m"');

  // Toggle to 'custom-timeout' with 30 min option
  await selectNotificationMode(page, 0, 'Custom Timeout', '30 min');
  await expect(metadata).toContainText('"mode": "custom-timeout"');
  await expect(metadata).toContainText('"threshold": "30m"');

  // Test valid custom input
  await selectNotificationMode(
    page,
    0,
    'Custom Timeout',
    'Custom',
    '4',
    'seconds',
  );
  await expect(metadata).toContainText('"mode": "custom-timeout"');
  await expect(metadata).toContainText('"threshold": "4s"');

  // Test valid custom input
  await selectNotificationMode(
    page,
    0,
    'Custom Timeout',
    'Custom',
    '4',
    'hours',
  );
  await expect(metadata).toContainText('"mode": "custom-timeout"');
  await expect(metadata).toContainText('"threshold": "4h"');
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

  // To Capture notifications in MockNotifications array (needs to be setup after applying settings)
  await setupNotificationMock(page);

  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  // Toggle to 'always'
  await selectNotificationMode(page, 0, 'Default');

  // Execute a cell with execution time below threshold time
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

  // Verify successful notification
  const successNotifications = await page.evaluate(() => {
    return window.mockNotifications;
  });
  expect(successNotifications.length).toBeGreaterThan(0);

  expect(successNotifications[0].title).toContain(
    'Cell execution completed successfully',
  );

  // Execute a failing cell
  await selectNotificationMode(page, 1, 'Default');
  await page.notebook.enterCellEditingMode(1);
  await page.keyboard.type('sleep(0.5);raise Exception("Error")');
  await page.notebook.runCell(1);
  await page.waitForTimeout(500); // Wait for notification

  // Verify error notification
  const allNotifications = await page.evaluate(() => {
    return window.mockNotifications;
  });
  expect(allNotifications.length).toBeGreaterThan(1);
  expect(allNotifications[1].title).toContain('Cell execution failed');
});

test('Notification triggers only on error with "on-error" mode', async ({
  page,
}) => {
  await setupNotificationMock(page);

  // Create a new notebook
  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  // Toggle to 'on-error'
  await selectNotificationMode(page, 0, 'On error');

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
  expect(errorNotifications[0].title).toContain('Cell execution failed');
});

test('Notification triggers only on timeout with "custom-timeout" mode', async ({
  page,
}) => {
  await setupNotificationMock(page);

  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  // Toggle to 'custom-timeout' with custom timout value
  await selectNotificationMode(
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
  expect(notifications[0].title).toContain('Cell execution timeout reached');
});

test('Displays warning when email is enabled but not configured', async ({
  page,
}) => {
  // Enable email in settings
  await page.evaluate(async () => {
    await window.jupyterapp.serviceManager.settings.save(
      'jupyterlab-notify:plugin',
      JSON.stringify({ mail: true }),
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
  expect(text).toContain('SMTP Server Not Running');
});
