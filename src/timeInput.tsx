import { ReactWidget } from '@jupyterlab/ui-components';
import React, { useEffect, useRef, useState } from 'react';

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
  initialInputValid?: boolean;
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
 * Props for the TimeInput React component
 */
interface ITimeInputProps {
  label?: string;
  placeholder?: string;
  defaultValue?: number;
  defaultUnit?: TimeUnit;
  initialInputValid?: boolean;
  onValidationChange?: (isValid: boolean) => void;
  onResultChange?: (result: ITimeInputResult) => void;
}

/**
 * React component for time input with numeric field and unit dropdown
 */
const TimeInput: React.FC<ITimeInputProps> = ({
  label = 'Enter time and select units',
  placeholder = '30',
  defaultValue,
  defaultUnit = TimeUnit.SECONDS,
  initialInputValid = true,
  onValidationChange,
  onResultChange,
}) => {
  useEffect(() => {
    if (!initialInputValid) {
      onValidationChange?.(false);
    }
  }, []);
  const [value, setValue] = useState<string>(
    initialInputValid ? defaultValue?.toString() || '' : '',
  );
  const [unit, setUnit] = useState<TimeUnit>(defaultUnit);
  const [isValid, setIsValid] = useState<boolean>(initialInputValid);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Validate the numeric input
   */
  const validateInput = (inputValue: string): boolean => {
    const numValue = parseFloat(inputValue);
    const valid = !isNaN(numValue) && numValue >= 0;
    setIsValid(valid);
    onValidationChange?.(valid);
    return valid;
  };

  /**
   * Calculate total seconds from current inputs
   */
  const calculateTotalSeconds = (
    inputValue: string,
    selectedUnit: TimeUnit,
  ): number => {
    const numValue = parseFloat(inputValue) || 0;
    switch (selectedUnit) {
      case TimeUnit.MINUTES:
        return numValue * 60;
      case TimeUnit.HOURS:
        return numValue * 3600;
      default:
        return numValue;
    }
  };

  /**
   * Handle input value changes
   */
  const handleValueChange = (newValue: string) => {
    setValue(newValue);
    const valid = validateInput(newValue);

    if (valid && onResultChange) {
      const numValue = parseFloat(newValue) || 0;
      const totalSeconds = calculateTotalSeconds(newValue, unit);
      onResultChange({
        value: numValue,
        unit,
        totalSeconds,
      });
    }
  };

  /**
   * Handle unit selection changes
   */
  const handleUnitChange = (newUnit: TimeUnit) => {
    setUnit(newUnit);

    if (isValid && onResultChange) {
      const numValue = parseFloat(value) || 0;
      const totalSeconds = calculateTotalSeconds(value, newUnit);
      onResultChange({
        value: numValue,
        unit: newUnit,
        totalSeconds,
      });
    }
  };

  /**
   * Handle Enter key press
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && isValid) {
      // Trigger OK button click when Enter is pressed
      const okButton = document.querySelector(
        '.jp-Dialog-button.jp-mod-accept',
      ) as HTMLButtonElement;
      if (okButton) {
        okButton.click();
      }
    }
  };

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  return (
    <div className="jp-notify-time-input-dialog-body">
      <label className="jp-notify-time-input-label">{label}</label>
      <div className="jp-notify-time-input-container">
        <input
          ref={inputRef}
          type="number"
          className={`jp-notify-time-input-field ${
            !isValid ? 'jp-mod-error' : ''
          }`}
          placeholder={placeholder}
          min="0"
          step="any"
          value={value}
          onChange={e => handleValueChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <select
          className="jp-notify-time-unit-select"
          value={unit}
          onChange={e => handleUnitChange(e.target.value as TimeUnit)}
        >
          <option value={TimeUnit.SECONDS}>Seconds (s)</option>
          <option value={TimeUnit.MINUTES}>Minutes (m)</option>
          <option value={TimeUnit.HOURS}>Hours (h)</option>
        </select>
      </div>
      {!isValid && (
        <div className="jp-notify-time-input-error" role="alert">
          Please enter a valid positive number
        </div>
      )}
    </div>
  );
};

/**
 * React Widget wrapper for the TimeInput component
 */
export class TimeInputWidget extends ReactWidget {
  constructor(options: ITimeInputDialogOptions = {}) {
    super();
    this._options = options;
    this.addClass('jp-notify-time-input-widget');
  }

  /**
   * Check if the current input is valid
   */
  isValid(): boolean {
    return this._isValid;
  }

  /**
   * Get the current result from the inputs
   */
  getResult(): ITimeInputResult {
    if (this._currentResult) {
      return this._currentResult;
    }

    // Fallback to default values
    const defaultValue = this._options.defaultValue || 0;
    const defaultUnit = this._options.defaultUnit || TimeUnit.SECONDS;

    let totalSeconds = defaultValue;
    switch (defaultUnit) {
      case TimeUnit.MINUTES:
        totalSeconds = defaultValue * 60;
        break;
      case TimeUnit.HOURS:
        totalSeconds = defaultValue * 3600;
        break;
      default:
        totalSeconds = defaultValue;
    }

    return {
      value: defaultValue,
      unit: defaultUnit,
      totalSeconds,
    };
  }

  /**
   * Handle validation state changes from the React component
   */
  private _handleValidationChange = (isValid: boolean): void => {
    this._isValid = isValid;
  };

  /**
   * Handle result changes from the React component
   */
  private _handleResultChange = (result: ITimeInputResult): void => {
    this._currentResult = result;
  };

  /**
   * Render the React component
   */
  render(): JSX.Element {
    return (
      <TimeInput
        label={this._options.label}
        placeholder={this._options.placeholder}
        defaultValue={this._options.defaultValue}
        defaultUnit={this._options.defaultUnit}
        initialInputValid={this._options.initialInputValid}
        onValidationChange={this._handleValidationChange}
        onResultChange={this._handleResultChange}
      />
    );
  }

  private _options: ITimeInputDialogOptions;
  private _isValid = true;
  private _currentResult: ITimeInputResult | null = null;
}
