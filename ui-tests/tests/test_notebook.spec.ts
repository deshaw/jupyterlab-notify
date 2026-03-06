import { test, expect } from '@jupyterlab/galata';
import {
  createNewNotebook,
  openNotebookMetadata,
  setNotebookDefaultThreshold,
  setNotebookCustomTimeout,
  setNotebookNotifyType,
  openCellMetadata,
  selectCellNotificationMode,
} from './helpers';


test('New Notebook metadata contains all required notify properties', async ({
  page,
}) => {
  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  const metadata = await openNotebookMetadata(page);

  await expect(metadata).toContainText('jupyterlab_notify.notify');
  await expect(metadata).toContainText('"mode": "default"');
  await expect(metadata).toContainText('"customTimeout":');
  await expect(metadata).toContainText('"defaultThreshold":');
});

test('setNotebookDefaultThreshold toolbar button updates notebook metadata', async ({
  page,
}) => {
  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  await setNotebookDefaultThreshold(page, '10', 'seconds');
  let metadata = await openNotebookMetadata(page);
  await expect(metadata).toContainText('"defaultThreshold": "10s"');

  await setNotebookDefaultThreshold(page, '2', 'minutes');
  await expect(metadata).toContainText('"defaultThreshold": "2m"');

  await setNotebookDefaultThreshold(page, '1', 'hours');
  await expect(metadata).toContainText('"defaultThreshold": "1h"');
});

test('setNotebookCustomTimeout toolbar button updates notebook metadata', async ({
  page,
}) => {
  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  await setNotebookCustomTimeout(page, '15', 'seconds');
  let metadata = await openNotebookMetadata(page);
  await expect(metadata).toContainText('"customTimeout": "15s"');

  await setNotebookCustomTimeout(page, '5', 'minutes');
  await expect(metadata).toContainText('"customTimeout": "5m"');

  await setNotebookCustomTimeout(page, '2', 'hours');
  await expect(metadata).toContainText('"customTimeout": "2h"');
});

test('Changing notebook threshold does not modify existing cell thresholds', async ({
  page,
}) => {
  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  // Set a custom threshold for the first cell
  await selectCellNotificationMode(
    page,
    0,
    'Custom Timeout',
    'Custom',
    '10',
    'seconds',
  );

  // Add a second cell and set its threshold
  await page.notebook.addCell('code', '# cell 2');
  await selectCellNotificationMode(
    page,
    1,
    'Custom Timeout',
    'Custom',
    '20',
    'seconds',
  );

  await setNotebookDefaultThreshold(page, '45', 'seconds');

  // Verify notebook metadata changed
  const notebookMetadata = await openNotebookMetadata(page);
  await expect(notebookMetadata).toContainText('"defaultThreshold": "45s"');

  // Verify cell threshold did not change
  const cellMetadata0 = await openCellMetadata(page, 0);
  await expect(cellMetadata0).toContainText('"customTimeout": "10s"');
  const cellMetadata1 = await openCellMetadata(page, 1);
  await expect(cellMetadata1).toContainText('"customTimeout": "20s"');
});

test('"Apply to all cells" checkbox applies custom timeout to existing cells', async ({
  page,
}) => {
  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  // Set different timeout values on cells
  await selectCellNotificationMode(
    page,
    0,
    'Custom Timeout',
    'Custom',
    '8',
    'seconds',
  );

  await page.notebook.addCell('code', '# cell 2');
  await selectCellNotificationMode(
    page,
    1,
    'Custom Timeout',
    'Custom',
    '12',
    'seconds',
  );

  // Set new timeout with "Apply to all cells" checked
  await setNotebookCustomTimeout(page, '30', 'minutes', true);

  // Verify all cells got updated
  let cellMetadata = await openCellMetadata(page, 0);
  await expect(cellMetadata).toContainText('"customTimeout": "30m"');

  cellMetadata = await openCellMetadata(page, 1);
  await expect(cellMetadata).toContainText('"customTimeout": "30m"');
});

test('Changing notifyType does not affect existing cell configurations', async ({
  page,
}) => {
  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  await selectCellNotificationMode(page, 0, 'On error');
  await setNotebookNotifyType(page, 'Never');

  const cellMetadata = await openCellMetadata(page, 0);
  await expect(cellMetadata).toContainText('"mode": "on-error"');
});

test('New cells inherit notebook notifyType setting', async ({ page }) => {
  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  await setNotebookNotifyType(page, 'Never');

  const notebookMetadata = await openNotebookMetadata(page);
  await page.waitForTimeout(10000);
  await expect(notebookMetadata).toContainText('"mode": "never"');

  await page.notebook.addCell('code', '# New cell');

  const cellMetadata = await openCellMetadata(page, 1);
  await expect(cellMetadata).toContainText('jupyterlab_notify');
});

test('Multiple sequential timeout changes update correctly', async ({
  page,
}) => {
  // Create a new notebook
  await createNewNotebook(page, 'test.ipynb');
  await page.sidebar.close('left');

  // Make multiple changes
  await setNotebookCustomTimeout(page, '10', 'seconds');
  let metadata = await openNotebookMetadata(page);
  await expect(metadata).toContainText('"customTimeout": "10s"');

  await setNotebookCustomTimeout(page, '20', 'seconds');
  metadata = await openNotebookMetadata(page);
  await expect(metadata).toContainText('"customTimeout": "20s"');

  await setNotebookDefaultThreshold(page, '3', 'minutes');
  metadata = await openNotebookMetadata(page);
  await expect(metadata).toContainText('"defaultThreshold": "3m"');

  await setNotebookDefaultThreshold(page, '1', 'hours');
  metadata = await openNotebookMetadata(page);
  await expect(metadata).toContainText('"defaultThreshold": "1h"');
});
