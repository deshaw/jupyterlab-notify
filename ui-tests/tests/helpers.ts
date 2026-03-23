import { IJupyterLabPageFixture, expect } from '@jupyterlab/galata';

/**
 * Type definition matching UI labels
 */
export type NotifyType = 'Default' | 'Never' | 'On error' | 'Custom Timeout';

/**
 * Declare global Window interface for mock notifications
 */
declare global {
  interface Window {
    mockNotifications: Array<{ title: string; body?: string }>;
  }
}

/**
 * Setup a mock Notification constructor to capture notifications
 * in a window.mockNotifications array for testing purposes
 */
export async function setupNotificationMock(
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

/**
 * Helper function to select a cell-level notification mode
 * @param cellIdx - Index of the cell to configure
 * @param mode - Mode to select (Default, Never, On error, Custom Timeout)
 * @param submode - Optional submode for Custom Timeout (e.g., 'Custom', '1 min', '30 min')
 * @param value - Optional timeout value when submode is specified
 * @param unit - Optional time unit (seconds, minutes, hours)
 */
export async function selectCellNotificationMode(
  page: IJupyterLabPageFixture,
  cellIdx: number,
  mode: NotifyType,
  submode: string | null = null,
  value: string | null = null,
  unit: string | null = null,
): Promise<void> {
  await page.notebook.enterCellEditingMode(cellIdx);
  const cell = await page.notebook.getCellLocator(cellIdx);
  const cellToolbarButton = cell!.locator(
    '[data-jp-item-name="cellNotifyMenu"]',
  );
  await cellToolbarButton.click();

  const cellNotifyMenu = page.locator('.lm-Menu');
  await expect(cellNotifyMenu).toBeVisible();
  await cellNotifyMenu.locator(`.lm-Menu-item:has-text("${mode}")`).click();

  if (submode) {
    const notifySubMenu = page.locator('.lm-Menu').last();
    await expect(notifySubMenu).toBeVisible();
    await cellNotifyMenu
      .locator(`.lm-Menu-item:has-text('${submode}')`)
      .last()
      .click();

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

/**
 * Helper function to create a new notebook and select the kernel
 * @param name - Name of the notebook to create (with .ipynb extension)
 */
export async function createNewNotebook(
  page: IJupyterLabPageFixture,
  name: string,
): Promise<void> {
  await page.notebook.createNew(name);

  // Select default kernel if dialog appears
  const selectButton = page.locator('.jp-mod-accept:has-text("Select")');
  if (await selectButton.isVisible()) {
    await selectButton.click();
  }
}

/**
 * Helper function to open the notebook metadata sidebar and return the metadata locator
 * This allows checking notebook-level metadata via UI string matching
 * @returns Locator for the metadata JSON editor
 */
export async function openNotebookMetadata(
  page: IJupyterLabPageFixture,
): Promise<any> {
  await page.sidebar.open('right');

  // Click on ADVANCED TOOLS to expand it if collapsed
  const advancedTools = page
    .locator('.jp-Collapse-header')
    .filter({ hasText: 'ADVANCED TOOLS' });
  const classList = await advancedTools.getAttribute('class');
  const isCollapsed = classList?.includes('jp-Collapse-header-collapsed');

  if (isCollapsed) {
    await advancedTools.click();
  }

  return page.locator('.jp-JSONEditor-host').last();
}

/**
 * Helper function to interact with the Set Default Threshold menu option
 * Opens a dialog and can set a value with optional "Apply to all cells" checkbox
 * @param value - Threshold value to set
 * @param unit - Time unit (seconds, minutes, hours)
 * @param applyToAllCells - Whether to check "Apply to all cells in this notebook"
 */
export async function setNotebookDefaultThreshold(
  page: IJupyterLabPageFixture,
  value: string,
  unit: string = 'seconds',
  applyToAllCells: boolean = false,
): Promise<void> {
  const toolbar = await page.notebook.getToolbarLocator();
  expect(toolbar).not.toBeNull();
  const notifyTypeButton = toolbar!.locator('[data-jp-item-name="notifyType"]');
  await notifyTypeButton.click();

  const menu = page.locator('.lm-Menu');
  await expect(menu).toBeVisible();

  await menu.locator(`.lm-Menu-item:has-text("Set Default Threshold")`).click();

  const dialog = page.locator('.jp-Dialog');
  await expect(dialog).toBeVisible();

  const input = dialog
    .locator('input[type="text"], input[type="number"]')
    .first();
  await input.fill(value);

  const unitSelect = dialog.locator('select');
  if ((await unitSelect.count()) > 0) {
    await unitSelect.first().selectOption({ value: unit });
  }

  if (applyToAllCells) {
    const checkbox = dialog.locator('input[type="checkbox"]');
    if (await checkbox.isVisible()) {
      await checkbox.check();
    }
  }

  const okButton = dialog.locator('.jp-mod-accept:has-text("OK")');
  await okButton.click();

  await expect(dialog).not.toBeVisible();
}

/**
 * Helper function to interact with the Set Custom Timeout menu option
 * Opens a dialog and can set a value with optional "Apply to all cells" checkbox
 * @param value - Timeout value to set
 * @param unit - Time unit (seconds, minutes, hours)
 * @param applyToAllCells - Whether to check "Apply to all cells in this notebook"
 */
export async function setNotebookCustomTimeout(
  page: IJupyterLabPageFixture,
  value: string,
  unit: string = 'seconds',
  applyToAllCells: boolean = false,
): Promise<void> {
  const toolbar = await page.notebook.getToolbarLocator();
  expect(toolbar).not.toBeNull();
  const notifyTypeButton = toolbar!.locator('[data-jp-item-name="notifyType"]');
  await notifyTypeButton.click();

  const menu = page.locator('.lm-Menu');
  await expect(menu).toBeVisible();

  await menu.locator(`.lm-Menu-item:has-text("Set Custom Timeout")`).click();

  const dialog = page.locator('.jp-Dialog');
  await expect(dialog).toBeVisible();

  const input = dialog
    .locator('input[type="text"], input[type="number"]')
    .first();
  await input.fill(value);

  const unitSelect = dialog.locator('select');
  if ((await unitSelect.count()) > 0) {
    await unitSelect.first().selectOption({ value: unit });
  }

  if (applyToAllCells) {
    const checkbox = dialog.locator('input[type="checkbox"]');
    if (await checkbox.isVisible()) {
      await checkbox.check();
    }
  }

  const okButton = dialog.locator('.jp-mod-accept:has-text("OK")');
  await okButton.click();
  await expect(dialog).not.toBeVisible();
}

/**
 * Helper function to set the notify type via dropdown menu
 * @param notifyType - Type to select (Browser, Email, Both)
 */
export async function setNotebookNotifyType(
  page: IJupyterLabPageFixture,
  notifyType: NotifyType,
): Promise<void> {
  const toolbar = await page.notebook.getToolbarLocator();
  expect(toolbar).not.toBeNull();
  const notifyTypeButton = toolbar!.locator('[data-jp-item-name="notifyType"]');
  await notifyTypeButton.click();

  const menu = page.locator('.lm-Menu');
  await expect(menu).toBeVisible();

  await menu.locator(`.lm-Menu-item:has-text("${notifyType}")`).click();
}

/**
 * Helper function to open a cell's metadata in the sidebar and return the locator
 * This allows checking cell-level metadata via UI string matching
 * @param cellIdx - Index of the cell to inspect
 * @returns Locator for the cell's metadata JSON editor
 */
export async function openCellMetadata(
  page: IJupyterLabPageFixture,
  cellIdx: number,
): Promise<any> {
  await page.sidebar.close('right');
  await page.notebook.selectCells(cellIdx);
  await page.notebook.enterCellEditingMode(cellIdx);

  await page.sidebar.open('right');

  // Click on ADVANCED TOOLS to expand it if collapsed
  const advancedTools = page
    .locator('.jp-Collapse-header')
    .filter({ hasText: 'ADVANCED TOOLS' });
  const classList = await advancedTools.getAttribute('class');
  const isCollapsed = classList?.includes('jp-Collapse-header-collapsed');

  if (isCollapsed) {
    await advancedTools.click();
  }

  return page.locator('.jp-JSONEditor-host').first();
}
