import React, { useState, useEffect } from 'react';
import { ReactWidget } from '@jupyterlab/ui-components';
import { NotebookPanel } from '@jupyterlab/notebook';
import {
  ITranslator,
  nullTranslator,
  TranslationBundle,
} from '@jupyterlab/translation';
import { HTMLSelect } from '@jupyterlab/ui-components';
import { bellOutlineIcon } from './icons';

const NOTIFY_METADATA_KEY = 'jupyterlab_notify.notify';

// CSS class names
const TOOLBAR_NOTIFICATION_CLASS = 'jp-Toolbar-notification-mode';
const TOOLBAR_NOTIFICATION_DROPDOWN_CLASS =
  'jp-Toolbar-notification-mode-dropdown';
const TOOLBAR_NOTIFICATION_ICON_CLASS = 'jp-Toolbar-notification-icon';

// Interface for notification settings
interface INotifySettings {
  defaultMode: string;
}

// Notification bell SVG icon
const NotificationIcon: React.FC<{ className?: string }> = ({ className }) => (
  <bellOutlineIcon.react className={className} />
);

/**
 * React component for the notification mode dropdown
 */
const NotificationModeDropdown: React.FC<{
  notebook: NotebookPanel;
  notifySettings: INotifySettings;
  trans: TranslationBundle;
}> = ({ notebook, notifySettings, trans }) => {
  /**
   * Get the current notification mode from metadata or default
   */
  const getCurrentMode = (): string => {
    if (!notebook.model) {
      return notifySettings.defaultMode;
    }

    const metadata = notebook.model.getMetadata(NOTIFY_METADATA_KEY);

    if (metadata && metadata.mode) {
      return metadata.mode;
    }
    return notifySettings.defaultMode;
  };

  const [currentMode, setCurrentMode] = useState<string>(getCurrentMode());

  // Update state when metadata changes
  useEffect(() => {
    const onMetadataChanged = () => {
      const newMode = getCurrentMode();
      setCurrentMode(newMode);
    };

    if (notebook.model) {
      notebook.model.metadataChanged.connect(onMetadataChanged);
      return () => {
        notebook.model?.metadataChanged.disconnect(onMetadataChanged);
      };
    }
  }, [notebook.model]);

  /**
   * Handle `change` events for the HTMLSelect component.
   */
  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const selectedValue = event.target.value;

    if (notebook.model) {
      // Update the notebook metadata properly
      const prev = notebook.model.getMetadata(NOTIFY_METADATA_KEY) || {};
      notebook.model.setMetadata(NOTIFY_METADATA_KEY, {
        ...prev,
        mode: selectedValue,
      });

      // Update local state immediately for responsive UI
      setCurrentMode(selectedValue);
    }

    notebook.activate();
  };

  /**
   * Handle `keydown` events for the HTMLSelect component.
   */
  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.keyCode === 13) {
      notebook.activate();
    }
  };

  return (
    <div className={TOOLBAR_NOTIFICATION_CLASS}>
      <NotificationIcon className={TOOLBAR_NOTIFICATION_ICON_CLASS} />
      <HTMLSelect
        className={TOOLBAR_NOTIFICATION_DROPDOWN_CLASS}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        value={currentMode}
        aria-label={trans.__('Notification mode')}
        title={trans.__('Select the notification mode')}
      >
        <option value="default">{trans.__('Default')}</option>
        <option value="never">{trans.__('Never')}</option>
        <option value="on-error">{trans.__('On Error')}</option>
        <option value="custom-timeout">{trans.__('Custom Timeout')}</option>
      </HTMLSelect>
    </div>
  );
};

/**
 * A toolbar widget that switches notification modes.
 */
export class NotificationModeSwitcher extends ReactWidget {
  /**
   * Construct a new notification mode switcher.
   */
  constructor(
    widget: NotebookPanel,
    notifySettings: INotifySettings,
    translator: ITranslator | null,
  ) {
    super();
    this._trans = (translator || nullTranslator).load('jupyterlab');
    this._notebook = widget;
    this._notifySettings = notifySettings;
  }

  render(): JSX.Element {
    return (
      <NotificationModeDropdown
        notebook={this._notebook}
        notifySettings={this._notifySettings}
        trans={this._trans}
      />
    );
  }

  /**
   * Dispose of the resources held by the widget.
   */
  dispose(): void {
    // Cleanup is now handled in the React component's useEffect
    super.dispose();
  }

  private _trans: TranslationBundle;
  private _notebook: NotebookPanel;
  private _notifySettings: INotifySettings;
}
