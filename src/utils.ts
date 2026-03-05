import { Dialog, showErrorMessage, Notification as JupyterNotification } from '@jupyterlab/apputils';
import {
  TimeInputWidget,
  ITimeInputDialogOptions,
  ITimeInputResult,
  TimeUnit,
} from './timeInput';
import {
  INotificationData,
  TIMEOUT_PATTERN,
  NOTEBOOK_FILE_EXTENSION,
} from './token';
/**
 * Custom Time Input Dialog class
 */
export class TimeInputDialog {
  /**
   * Show a time input dialog and return the result
   *
   * @param options - Configuration options for the dialog
   * @returns Promise that resolves to the time input result or null if cancelled
   */
  static async getText(
    options: ITimeInputDialogOptions = {},
  ): Promise<ITimeInputResult | null> {
    let widget: TimeInputWidget;

    // Keep showing dialog until valid input or user cancels
    let keepPrompting = false;
    do {
      widget = new TimeInputWidget({
        ...options,
        initialInputValid: !keepPrompting,
      });

      const dialog = new Dialog({
        title: options.title || 'Set Time Input',
        body: widget,
        buttons: [
          Dialog.cancelButton({ label: options.cancelLabel || 'Cancel' }),
          Dialog.okButton({ label: options.okLabel || 'OK' }),
        ],
        host: options.host,
        focusNodeSelector: '.jp-notify-time-input-field',
      });

      const result = await dialog.launch();

      // If cancelled, return null
      if (!result.button.accept) {
        return null;
      }

      // If accepted and valid, return result
      if (widget.isValid()) {
        return widget.getResult();
      }

      // If accepted but invalid, show again with error message
      // The validation styling will already be showing the error
      // Set keepPrompting to true to continue the loop
      keepPrompting = true;
    } while (keepPrompting);
    return null;
  }

  /**
   * Convenience method that returns just the total seconds value
   * This maintains compatibility with existing code expecting a simple number
   *
   * @param options - Configuration options for the dialog
   * @returns Promise that resolves to total seconds or null if cancelled
   */
  static async getSeconds(
    options: ITimeInputDialogOptions = {},
  ): Promise<number | null> {
    const result = await TimeInputDialog.getText(options);
    return result ? result.totalSeconds : null;
  }

  /**
   * Convenience method that formats the result as a string
   *
   * @param options - Configuration options for the dialog
   * @returns Promise that resolves to formatted string like "30 seconds" or null if cancelled
   */
  static async getFormattedText(
    options: ITimeInputDialogOptions = {},
  ): Promise<string | null> {
    const result = await TimeInputDialog.getText(options);
    if (!result) {
      return null;
    }

    const unitLabels = {
      [TimeUnit.SECONDS]: result.value === 1 ? 'second' : 'seconds',
      [TimeUnit.MINUTES]: result.value === 1 ? 'minute' : 'minutes',
      [TimeUnit.HOURS]: result.value === 1 ? 'hour' : 'hours',
    };

    return `${result.value} ${unitLabels[result.unit]}`;
  }
}

// CARET SVG

export const caretSVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="1em" viewBox="0 0 18 18" style="display:inline-block;vertical-align:middle;" data-icon="ui-components:caret-down-empty" data-icon-id="31edaf78-86e6-49d2-9be1-7ae77cfeaa83"><path fill="#616161" d="M5.2 5.9 9 9.7l3.8-3.8L14 7.1l-4.9 5-4.9-5z" class="jp-icon3" shape-rendering="geometricPrecision"></path></svg>';

/**
 * Strips the notebook extension from a path or filename
 * @param pathOrName - The path or name of the notebook file
 * @returns The name without the .ipynb extension
 */
export const stripNotebookExtension = (pathOrName: string): string => {
  const notebookName = pathOrName.split('/').pop() ?? pathOrName;
  return notebookName.endsWith(NOTEBOOK_FILE_EXTENSION)
    ? notebookName.slice(0, -NOTEBOOK_FILE_EXTENSION.length)
    : notebookName;
};

/**
 * Builds a notification title with the notebook name prefix
 * @param notebookName - The name of the notebook
 * @param message - The notification message
 * @returns The formatted title
 */
export const buildNotificationTitle = (
  notebookName: string,
  message: string,
): string => {
  return `[${stripNotebookExtension(notebookName)}] ${message}`;
};

/**
 * Generates notification data for desktop alerts
 * @param message - The notification message
 * @param cell_id - The cell ID
 * @param notebookName - The notebook name
 * @param notebookId - The notebook ID
 * @param executionCount - The execution count of the cell
 * @returns The notification data object
 */
export const generateNotificationData = (
  message: string,
  cell_id: string,
  notebookName: string,
  notebookId: string,
  executionCount: number | null,
): INotificationData => ({
  type: 'NOTIFY',
  payload: {
    title: buildNotificationTitle(notebookName, message),
    body: typeof executionCount === 'number' ? `Cell: ${executionCount}` : '',
    cellId: cell_id,
    notebookName: stripNotebookExtension(notebookName),
    notebookId,
    ...(typeof executionCount === 'number' ? { executionCount } : {}),
  },
  isProcessed: false,
  id: `notify-${Math.random().toString(36).substring(2)}`,
});

/**
 * Displays configuration warning for unconfigured services
 * @param service - The service name ('Email' or 'Slack')
 * @param configKey - The configuration key
 * @param example - An example configuration value
 */
export const displayConfigWarning = (
  service: 'Email' | 'Slack',
  configKey: string,
  example: string,
): void => {
  JupyterNotification.emit(`${service} Not Configured`, 'error', {
    autoClose: 3000,
    actions: [
      {
        label: 'Help',
        callback: () =>
          showErrorMessage(`${service} Not Configured`, {
            message: `Add a ${service.toLowerCase()} configuration to directory listed under the config section of jupyter --paths (e.g., ~/.jupyter/jupyter_notify_config.json) to enable ${service.toLowerCase()} notifications. Example: \n{\n  "${configKey}": "${example}"}"\n}. If you've already configured it, there might be an issue. Please check the terminal for errors and review your setup.`,
          }),
      },
    ],
  });
};

/**
 * Decodes a threshold string or number to seconds
 * @param threshold - The threshold string (e.g., '2s', '5m', '1.5h') or number in seconds
 * @returns The threshold in seconds, or null if invalid
 */
export function decodeThresholdToSeconds(threshold: string | number) {
  if (typeof threshold === 'number') {
    return threshold;
  }
  const match = threshold.match(TIMEOUT_PATTERN);
  if (!match) {
    return null;
  }
  const value = parseFloat(match[1]);
  const unit = match[3];
  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    default:
      return null;
  }
}

/**
 * Parses a threshold string like '2s', '5m', '1.5h' and returns value and TimeUnit
 * @param threshold - The threshold string or number
 * @returns An object with value and unit, or null if invalid
 */
export function parseThreshold(
  threshold?: string | number,
): { value: number; unit: TimeUnit } | null {
  if (!threshold) {
    return null;
  }
  if (typeof threshold === 'number') {
    return { value: threshold, unit: TimeUnit.SECONDS };
  }
  const match = threshold.match(/^(\d+(\.\d+)?)([smh])$/);
  if (!match) {
    return null;
  }
  const value = parseFloat(match[1]);
  const unitChar = match[3];
  let unit: TimeUnit;
  switch (unitChar) {
    case 's':
      unit = TimeUnit.SECONDS;
      break;
    case 'm':
      unit = TimeUnit.MINUTES;
      break;
    case 'h':
      unit = TimeUnit.HOURS;
      break;
    default:
      return null;
  }
  return { value, unit };
}
