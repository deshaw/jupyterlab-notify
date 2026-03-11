import {
  Dialog,
  showErrorMessage,
  Notification as JupyterNotification,
} from '@jupyterlab/apputils';
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
  INotifyMetadata,
  CELL_DEFAULT_THRESHOLD_KEY,
  CELL_CUSTOM_TIMEOUT_KEY,
  NOTEBOOK_DEFAULT_THRESHOLD_KEY,
  NOTEBOOK_CUSTOM_TIMEOUT_KEY,
  ModeId,
  IExecutionTimingMetadata,
  NotifyType,
} from './token';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { KernelError } from '@jupyterlab/notebook';
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
 * Generates notification body for desktop alerts
 */
const _buildNotificationBody = (
  state: NotifyType,
  timingInfo: IExecutionTimingMetadata | null,
  executionCount: number | null,
  kernelError: KernelError | null,
): string => {
  const parts: string[] = [];

  if (kernelError) {
    const errorMessage = kernelError.errorValue
      ? kernelError.errorValue.length > 50
        ? kernelError.errorValue.substring(0, 50) + '...'
        : kernelError.errorValue
      : '';
    const cellPrefix =
      typeof executionCount === 'number' ? `Cell [${executionCount}]: ` : '';
    parts.push(
      `${cellPrefix}${kernelError.errorName}${
        errorMessage ? ': ' + errorMessage : ''
      }`,
    );
  } else if (timingInfo) {
    const startTime =
      state === 'timeout'
        ? timingInfo['iopub.execute_input']
        : timingInfo['shell.execute_reply.started'];
    const endTime =
      state === 'timeout'
        ? new Date().toISOString()
        : timingInfo['shell.execute_reply'];

    if (typeof startTime === 'string' && typeof endTime === 'string') {
      const durationSeconds = (
        (new Date(endTime).getTime() - new Date(startTime).getTime()) /
        1000
      ).toFixed(1);
      const cellPrefix =
        typeof executionCount === 'number' ? `Cell [${executionCount}]: ` : '';
      const action = state === 'timeout' ? 'Timed out after' : 'Completed in';
      const unit = durationSeconds === '1.0' ? 'second' : 'seconds';
      parts.push(`${cellPrefix}${action} ${durationSeconds} ${unit}`);
    }
  } else if (executionCount !== null) {
    parts.push(`Cell [${executionCount}]`);
  }

  return parts.join('\n');
};

export const generateNotificationData = (
  state: NotifyType,
  message: string,
  cell_id: string,
  notebookName: string,
  notebookId: string,
  timingInfo: IExecutionTimingMetadata | null,
  executionCount: number | null,
  kernelError: KernelError | null = null,
): INotificationData => {
  return {
    type: 'NOTIFY',
    payload: {
      title: `${stripNotebookExtension(notebookName)}: ${message}`,
      body: _buildNotificationBody(
        state,
        timingInfo,
        executionCount,
        kernelError,
      ),
      cellId: cell_id,
      notebookName: stripNotebookExtension(notebookName),
      notebookId,
      ...(typeof executionCount === 'number' ? { executionCount } : {}),
      ...(kernelError ? { kernelError } : {}),
    },
    isProcessed: false,
    id: `notify-${Math.random().toString(36).substring(2)}`,
  };
};

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

/**
 * Helper interface for timeout prompt options
 */
export interface ITimeoutPromptOptions {
  title: string;
  label: string;
  placeholder: string;
  errorMessage: string;
  defaultValue?: number;
  defaultUnit?: TimeUnit;
}

/**
 * Retrieves the appropriate threshold value from cell, notebook, or settings
 */
export function getThresholdValue(
  mode: ModeId,
  cellMetadata: INotifyMetadata | undefined,
  notebookMetadata: Record<string, string> | undefined,
  settingsDefaultThreshold: number | null,
  settingsCustomTimeout: number | null,
): string | number | null {
  if (mode === 'default') {
    return (
      cellMetadata?.[CELL_DEFAULT_THRESHOLD_KEY] ??
      notebookMetadata?.[NOTEBOOK_DEFAULT_THRESHOLD_KEY] ??
      settingsDefaultThreshold
    );
  }

  if (mode === 'custom-timeout') {
    return (
      cellMetadata?.[CELL_CUSTOM_TIMEOUT_KEY] ??
      notebookMetadata?.[NOTEBOOK_CUSTOM_TIMEOUT_KEY] ??
      settingsCustomTimeout
    );
  }

  return settingsDefaultThreshold;
}

/**
 * Helper to prompt for a timeout/threshold value and validate it
 */
export async function promptForTimeout(
  options: ITimeoutPromptOptions,
  showCheckbox = false,
  translator?: ITranslator,
): Promise<{ value: string | null; applyToAll: boolean }> {
  translator = translator || nullTranslator;
  const trans = translator.load('jupyterlab');
  const timeResult = await TimeInputDialog.getText({
    title: options.title,
    label: options.label,
    placeholder: options.placeholder,
    defaultValue: options.defaultValue,
    defaultUnit: options.defaultUnit,
    ...(showCheckbox && {
      checkbox: {
        label: trans.__('Apply to all cells in this notebook'),
      },
    }),
  });

  if (!timeResult) {
    return { value: null, applyToAll: false };
  }

  const rawInput =
    String(timeResult.value) + (timeResult.unit ? timeResult.unit[0] : 's');
  const lastChar = rawInput.slice(-1);
  const input =
    rawInput === ''
      ? ''
      : ['s', 'm', 'h'].includes(lastChar)
      ? rawInput
      : rawInput + 's';

  if (!input || !TIMEOUT_PATTERN.test(input)) {
    return { value: null, applyToAll: false };
  }

  const applyToAll = (showCheckbox ? timeResult.isChecked : false) ?? false;
  return { value: input, applyToAll };
}
