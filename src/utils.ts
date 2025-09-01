import { Dialog } from '@jupyterlab/apputils';
import {
  TimeInputWidget,
  ITimeInputDialogOptions,
  ITimeInputResult,
  TimeUnit,
} from './timeInput';
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
