import { Dialog } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
import { Message } from '@lumino/messaging';

/**
 * Time unit options for the dropdown
 */
export enum TimeUnit {
  SECONDS = 'seconds',
  MINUTES = 'minutes',
  HOURS = 'hours',
}

/**
 * Configuration options for the TimeInputDialog
 */
export interface ITimeInputDialogOptions {
  title?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: number;
  defaultUnit?: TimeUnit;
  okLabel?: string;
  cancelLabel?: string;
  host?: HTMLElement;
}

/**
 * Result returned by the TimeInputDialog
 */
export interface ITimeInputResult {
  value: number;
  unit: TimeUnit;
  totalSeconds: number;
}

/**
 * Custom widget for time input with numeric field and unit dropdown
 */
class TimeInputWidget extends Widget {
  private _input: HTMLInputElement;
  private _select: HTMLSelectElement;
  private _defaultValue: number | null;
  private _defaultUnit: TimeUnit;

  constructor(options: ITimeInputDialogOptions = {}) {
    super({ node: TimeInputWidget.createNode(options) });
    this._defaultValue = options.defaultValue ?? null;
    this._defaultUnit = options.defaultUnit ?? TimeUnit.SECONDS;

    this._input = this.node.querySelector(
      '.jp-notify-time-input-field',
    ) as HTMLInputElement;
    this._select = this.node.querySelector(
      '.jp-notify-time-unit-select',
    ) as HTMLSelectElement;

    this._setupInputs();
    this._setupEventListeners();
  }

  /**
   * Create the DOM node for the widget
   */
  private static createNode(options: ITimeInputDialogOptions): HTMLElement {
    const node = document.createElement('div');
    node.className = 'jp-notify-time-input-dialog-body';

    const label =
      options.label || 'Default: seconds, +m for minutes, +h for hours:';

    node.innerHTML = `
      <label class="jp-notify-time-input-label">${label}</label>
      <div class="jp-notify-time-input-container">
        <input
          type="number"
          class="jp-notify-time-input-field"
          placeholder="${options.placeholder || '30'}"
          min="0"
          step="any"
        />
        <select class="jp-notify-time-unit-select">
          <option value="${TimeUnit.SECONDS}">Seconds (s)</option>
          <option value="${TimeUnit.MINUTES}">Minutes (m)</option>
          <option value="${TimeUnit.HOURS}">Hours (h)</option>
        </select>
      </div>
      <div class="jp-notify-time-input-error" role="alert">Please enter a valid positive number</div>
    `;

    return node;
  }

  /**
   * Setup initial input values
   */
  private _setupInputs(): void {
    if (this._defaultValue) {
      this._input.value = this._defaultValue.toString();
    } else {
      this._input.value = '';
    }
    this._select.value = this._defaultUnit;
  }

  /**
   * Setup event listeners for validation
   */
  private _setupEventListeners(): void {
    this._input.addEventListener('input', () => {
      this._validateInput();
    });

    this._input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        // Trigger OK button click when Enter is pressed
        const okButton = document.querySelector(
          '.jp-Dialog-button.jp-mod-accept',
        ) as HTMLButtonElement;
        if (okButton && this.isValid()) {
          okButton.click();
        }
      }
    });
  }

  /**
   * Validate the numeric input
   */
  private _validateInput(): void {
    const errorElement = this.node.querySelector(
      '.jp-notify-time-input-error',
    ) as HTMLElement;
    const value = parseFloat(this._input.value);

    if (isNaN(value) || value < 0) {
      this._input.classList.add('jp-mod-error');
      errorElement.style.display = 'block';
    } else {
      this._input.classList.remove('jp-mod-error');
      errorElement.style.display = 'none';
    }
  }

  /**
   * Check if the current input is valid
   */
  isValid(): boolean {
    const value = parseFloat(this._input.value);
    return !isNaN(value) && value >= 0;
  }

  /**
   * Get the current result from the inputs
   */
  getResult(): ITimeInputResult {
    const value = parseFloat(this._input.value) || 0;
    const unit = this._select.value as TimeUnit;

    // Convert to seconds for convenience
    let totalSeconds = value;
    switch (unit) {
      case TimeUnit.MINUTES:
        totalSeconds = value * 60;
        break;
      case TimeUnit.HOURS:
        totalSeconds = value * 3600;
        break;
      default:
        totalSeconds = value;
    }

    return {
      value,
      unit,
      totalSeconds,
    };
  }

  /**
   * Focus the input field when the widget is attached
   */
  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this._input.focus();
    this._input.select();
  }
}

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
    let keepPrompting = true;
    while (keepPrompting) {
      widget = new TimeInputWidget(options);

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
    }
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
