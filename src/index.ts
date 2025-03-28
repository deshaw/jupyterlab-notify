import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
} from '@jupyterlab/application';
import {
  INotebookTracker,
  NotebookActions,
  NotebookPanel,
} from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { LabIcon, ToolbarButton } from '@jupyterlab/ui-components';
import {
  IToolbarWidgetRegistry,
  showErrorMessage,
  Notification as JupyterNotification,
  InputDialog,
} from '@jupyterlab/apputils';
import {
  bellOutlineIcon,
  bellOffIcon,
  bellAlertIcon,
  bellClockIcon,
} from './icons';
import { requestAPI } from './handler';
import { Cell, ICellModel } from '@jupyterlab/cells';
import { IRenderMimeRegistry, MimeModel } from '@jupyterlab/rendermime';
import { Menu } from '@lumino/widgets';

namespace CommandIDs {
  export const setNotificationMode = 'notify:set-notification-mode';
  export const setCustomTimeout = 'notify:set-custom-timeout';
}

// Timeout options for the submenu
const TIMEOUT_OPTIONS = [
  { label: '1 min', value: '1m' },
  { label: '30 min', value: '30m' },
  { label: '1 hour', value: '1h' },
  { label: 'Custom', value: 'custom' },
];

const CELL_METADATA_KEY = 'jupyterlab_notify.notify';
const MIME_TYPE = 'application/desktop-notify+json';

interface IExecutionTimingMetadata {
  'shell.execute_reply.started': string;
  'shell.execute_reply': string;
  execution_failed: string;
}

// Interfaces
interface IMode {
  label: string;
  icon: LabIcon;
}

interface INotifySettings {
  defaultMode: ModeId;
  failureMessage: string;
  mail: boolean;
  slack: boolean;
  successMessage: string;
  defaultThreshold: number | null;
}

interface ICellMetadata {
  mode: ModeId;
  threshold?: string;
}

interface IInitialResponse {
  nbmodel_installed: boolean;
  email_configured: boolean;
  slack_configured: boolean;
}

interface ICellNotification {
  payload: any;
  timeoutId: number | null;
  notificationIssued: boolean;
}

// Constants
const ModeIds = ['default', 'never', 'on-error', 'custom-timeout'] as const;
type ModeId = (typeof ModeIds)[number];

const MODES: Record<ModeId, IMode> = {
  default: { label: 'Default', icon: bellOutlineIcon },
  never: { label: 'Never', icon: bellOffIcon },
  'on-error': { label: 'On error', icon: bellAlertIcon },
  'custom-timeout': { label: 'Custom Timeout', icon: bellClockIcon },
};

// Regular expression for validating timeout input
const TIMEOUT_PATTERN = /^(\d+(\.\d+)?)([smh])$/;

/**
 * Generates notification data with a custom message
 */
const generateNotificationData = (
  message: string,
  cell_id: string,
): Record<string, any> => ({
  type: 'NOTIFY',
  payload: {
    title: message,
    body: `Cell id: ${cell_id}`,
  },
  isProcessed: false,
  id: `notify-${Math.random().toString(36).substring(2)}`,
});

/**
 * Displays configuration warning for unconfigured services
 */
const displayConfigWarning = (
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
            message: `Add a ${service.toLowerCase()} configuration to directory listed under the config section of jupyter --paths (e.g., ~/.jupyter/jupyter_notify_config.json) to enable ${service.toLowerCase()} notifications. Example: \n{\n  "${configKey}": "${example}"}-config"\n}. If you've already configured it, there might be an issue. Please check the terminal for errors and review your setup.`,
          }),
      },
    ],
  });
};

// Function to decode threshold to seconds
function decodeThresholdToSeconds(threshold: string) {
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
 * Main plugin definition
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-notify:plugin',
  description: 'Enhanced cell execution notifications for JupyterLab',
  autoStart: true,
  requires: [INotebookTracker, IRenderMimeRegistry],
  optional: [IToolbarWidgetRegistry, ITranslator, ISettingRegistry],
  activate: async (
    app: JupyterFrontEnd,
    tracker: INotebookTracker,
    rendermime: IRenderMimeRegistry,
    toolbarRegistry: IToolbarWidgetRegistry | null,
    translator: ITranslator | null,
    settingRegistry: ISettingRegistry | null,
  ) => {
    console.log('JupyterLab extension jupyterlab-notify is activated!');

    // Default settings
    let notifySettings: INotifySettings = {
      defaultMode: 'default',
      failureMessage: 'Cell execution failed',
      mail: false,
      slack: false,
      successMessage: 'Cell execution completed successfully',
      defaultThreshold: 30,
    };

    // Settings management
    const updateSettings = (settings: ISettingRegistry.ISettings): void => {
      notifySettings = { ...notifySettings, ...settings.composite };
    };

    if (settingRegistry) {
      // Ensure the recordTiming setting is enabled for the extension to function correctly
      const nbPluginId = '@jupyterlab/notebook-extension:tracker';
      const nbSettings = await settingRegistry.load(nbPluginId);
      nbSettings.set('recordTiming', true);

      // Ensure recordTiming remains true if user tries to change it
      nbSettings.changed.connect(async () => {
        const recordTiming = nbSettings.get('recordTiming')
          .composite as boolean;
        if (!recordTiming) {
          await nbSettings.set('recordTiming', true);
        }
      });
      try {
        const settings = await settingRegistry.load(plugin.id);
        updateSettings(settings);
        settings.changed.connect(updateSettings);
      } catch (reason) {
        console.error('Failed to load settings for jupyterlab-notify:', reason);
      }
    }

    const addCellMetadata = (cell: ICellModel): void => {
      if (cell.getMetadata(CELL_METADATA_KEY)) {
        return;
      }
      cell.setMetadata(CELL_METADATA_KEY, { mode: notifySettings.defaultMode });
    };

    // Track new cells
    tracker.widgetAdded.connect((_, notebookPanel: NotebookPanel) => {
      const notebook = notebookPanel.content;
      notebook.model?.cells.changed.connect((_, change) => {
        if (change.type === 'add') {
          change.newValues.forEach(addCellMetadata);
        }
      });
    });

    // Server configuration
    let config: IInitialResponse = {
      nbmodel_installed: false,
      email_configured: false,
      slack_configured: false,
    };

    try {
      config = await requestAPI<IInitialResponse>('notify');
    } catch (e) {
      console.error('Checking server capability failed:', e);
    }

    const cellNotificationMap: Map<string, ICellNotification> = new Map();

    /**
     * Handles notification rendering based on execution status
     */
    const handleNotification = async (
      cell: ICellModel,
      success: boolean,
      threshold = false,
    ): Promise<void> => {
      const cellId = cell.id;
      const notification = cellNotificationMap.get(cellId);
      if (!notification || notification.notificationIssued) {
        return;
      }

      const { payload } = notification;
      if (payload.mode === 'on-error' && success && !threshold) {
        return;
      }

      // Handle case when threshold isn't exceeded in default mode
      if (payload.mode === 'default') {
        const timingData: IExecutionTimingMetadata =
          cell.getMetadata('execution');
        const startTime = timingData['shell.execute_reply.started'];
        const endTime =
          timingData['shell.execute_reply'] ?? timingData['execution_failed'];

        // Skip notification if execution time is below the threshold
        if (
          startTime &&
          endTime &&
          new Date(endTime).getTime() - new Date(startTime).getTime() <
            payload.threshold * 1000
        ) {
          return;
        }
      }

      // Determine appropriate message based on execution state
      const message = threshold
        ? 'Cell execution timeout reached'
        : success
        ? notifySettings.successMessage
        : notifySettings.failureMessage;

      const notificationData = generateNotificationData(message, cellId);

      if (!config.nbmodel_installed) {
        try {
          await requestAPI('notify-trigger', {
            method: 'POST',
            body: JSON.stringify({ ...payload, timer: threshold }),
          });
        } catch (e) {
          console.error('Failed to trigger notification:', e);
        }
      }

      try {
        const mimeModel = new MimeModel({
          data: { [MIME_TYPE]: notificationData },
        });
        const renderer = rendermime.createRenderer(MIME_TYPE);
        await renderer.renderModel(mimeModel);
        notification.notificationIssued = true;
      } catch (err) {
        console.error('Error rendering notification:', err);
      }

      if (notification.timeoutId) {
        clearTimeout(notification.timeoutId);
      }
      cellNotificationMap.delete(cellId);
    };

    // Execution listeners
    NotebookActions.executed.connect((_, args) => {
      handleNotification(args.cell.model, args.success);
    });

    NotebookActions.executionScheduled.connect(async (_, args) => {
      const { cell } = args;
      const cellMetadata = cell.model.getMetadata(
        CELL_METADATA_KEY,
      ) as ICellMetadata;
      const mode = cellMetadata?.mode;
      if (!mode || mode === 'never') {
        return;
      }

      if (Notification.permission !== 'granted') {
        await Notification.requestPermission().catch(err => {
          JupyterNotification.emit('Permission Error', 'error', {
            autoClose: 3000,
            actions: [
              {
                label: 'Show Details',
                callback: () =>
                  showErrorMessage('Permission Error', {
                    message: err,
                  }),
              },
            ],
          });
        });
      }
      // Show configuration warnings
      if (notifySettings.mail && !config.email_configured) {
        displayConfigWarning('Email', 'email', 'youremail@example.com');
      }
      if (notifySettings.slack && !config.slack_configured) {
        displayConfigWarning(
          'Slack',
          'slack_token',
          'xoxb-your-slackbot-token',
        );
      }
      if (
        mode === 'default' &&
        (!(typeof notifySettings.defaultThreshold === 'number') ||
          !Number.isFinite(notifySettings.defaultThreshold))
      ) {
        JupyterNotification.emit(
          `Invalid default threshold value: Expected a finite number, but received ${notifySettings.defaultThreshold}`,
          'error',
          {
            autoClose: 3000,
          },
        );
        return;
      }
      if (mode === 'custom-timeout') {
        const thresholdInSeconds = cellMetadata.threshold
          ? decodeThresholdToSeconds(cellMetadata.threshold)
          : null;

        if (!Number.isFinite(thresholdInSeconds)) {
          JupyterNotification.emit(
            `Invalid custom threshold value: Expected a finite number, but received ${
              cellMetadata.threshold ?? 'undefined'
            }`,
            'error',
            { autoClose: 3000 },
          );
        }
      }

      const payload = {
        cell_id: cell.model.id,
        mode,
        emailEnabled: config.email_configured && notifySettings.mail,
        slackEnabled: config.slack_configured && notifySettings.slack,
        successMessage: notifySettings.successMessage,
        failureMessage: notifySettings.failureMessage,
        threshold:
          mode === 'custom-timeout'
            ? decodeThresholdToSeconds(cellMetadata.threshold!)
            : notifySettings.defaultThreshold,
      };

      const notification: ICellNotification = {
        payload,
        timeoutId: null,
        notificationIssued: false,
      };

      if (config.nbmodel_installed) {
        try {
          await requestAPI('notify', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
        } catch (e) {
          console.error('Failed to notify server:', e);
        }
      }

      cellNotificationMap.set(cell.model.id, notification);

      if (payload.mode === 'custom-timeout') {
        notification.timeoutId = setTimeout(() => {
          if (!notification.notificationIssued) {
            handleNotification(cell.model, true, true);
          }
        }, payload.threshold! * 1000);
      }
    });
    const trans = (translator ?? nullTranslator).load('jupyterlab-notify');

    // Command to set notification mode and threshold
    app.commands.addCommand(CommandIDs.setNotificationMode, {
      label: args => {
        if (args.label) {
          return args.label as string;
        }
        const modeId = args.modeId as ModeId;
        return MODES[modeId].label;
      },
      icon: args =>
        args.threshold ? undefined : MODES[args.modeId as ModeId].icon,
      execute: args => {
        const modeId = args.modeId;
        const threshold = args.threshold; // Stored as string, e.g., "120s"
        const current = tracker.currentWidget;
        if (!current) {
          console.warn('No notebook selected');
          return;
        }
        const cell = current.content.activeCell;
        if (!cell) {
          return;
        }
        const metadata =
          modeId === 'custom-timeout' && threshold
            ? { mode: modeId, threshold }
            : { mode: modeId };
        cell.model.setMetadata(CELL_METADATA_KEY, metadata);
      },
      isEnabled: () =>
        !!tracker.currentWidget && !!tracker.currentWidget.content.activeCell,
    });

    // Command to prompt for custom timeout
    app.commands.addCommand(CommandIDs.setCustomTimeout, {
      label: 'Custom',
      execute: async () => {
        const result = await InputDialog.getText({
          title: 'Set Custom Timeout',
          label: 'Enter timeout (e.g., 120s, 45m, 1h):',
          placeholder: 'e.g., 120s',
        });
        if (result.button.accept && result.value) {
          const input = result.value.trim();
          if (!TIMEOUT_PATTERN.test(input)) {
            await showErrorMessage(
              'Invalid Input',
              'Please enter a positive number followed by s (seconds), m (minutes), or h (hours) — e.g., 120s, 45m, 1h.',
            );
            return;
          }
          await app.commands.execute(CommandIDs.setNotificationMode, {
            modeId: 'custom-timeout',
            threshold: input,
          });
        }
      },
    });

    // Menu for Notification modes
    const notifyMenu = new Menu({ commands: app.commands });
    notifyMenu.addClass('jp-notify-menu');
    notifyMenu.title.label = trans.__('Cell Notification');

    Object.entries(MODES).forEach(([modeId, mode]) => {
      if (modeId === 'custom-timeout') {
        const subMenu = new Menu({ commands: app.commands });
        subMenu.title.label = mode.label;
        subMenu.title.icon = mode.icon;
        TIMEOUT_OPTIONS.forEach(option => {
          if (option.value === 'custom') {
            subMenu.addItem({
              command: CommandIDs.setCustomTimeout,
            });
          } else {
            subMenu.addItem({
              command: CommandIDs.setNotificationMode,
              args: {
                modeId: 'custom-timeout',
                threshold: option.value,
                label: option.label,
              },
            });
          }
        });
        notifyMenu.addItem({ type: 'submenu', submenu: subMenu });
      } else {
        notifyMenu.addItem({
          command: CommandIDs.setNotificationMode,
          args: { modeId },
        });
      }
    });

    // Helper function to update the button's icon
    function updateButtonIcon(button: ToolbarButton, cell: ICellModel) {
      const metadata = cell.getMetadata(CELL_METADATA_KEY) as
        | ICellMetadata
        | undefined;
      const modeId = metadata?.mode ?? notifySettings.defaultMode;
      const newIcon = MODES[modeId].icon;

      // Replace the SVG in the button
      const svgElement = button.node.querySelector('svg');
      if (svgElement) {
        svgElement.outerHTML = newIcon.svgstr;
      } else {
        // Fallback if no SVG is present
        button.node.innerHTML = newIcon.svgstr;
      }
    }

    // Toolbar factory for per-cell toolbar
    if (toolbarRegistry) {
      toolbarRegistry.addFactory('Cell', 'notifyMenu', args => {
        const cell = (args as Cell)?.model as ICellModel;

        const metadata = cell.getMetadata(CELL_METADATA_KEY) as
          | ICellMetadata
          | undefined;
        const modeId = metadata?.mode ?? notifySettings.defaultMode; // Fallback to default if metadata is unset

        // Create the button with the correct initial icon
        const button = new ToolbarButton({
          tooltip: `${MODES[modeId].label} (click to change)`,
          icon: MODES[modeId].icon, // Set initial icon based on current metadata
          onClick: () => {
            if (notifyMenu.isVisible) {
              notifyMenu.close();
            } else {
              const rect = button.node.getBoundingClientRect();
              notifyMenu.open(rect.right, rect.bottom, {
                horizontalAlignment: 'right',
              });
            }
          },
        });

        // Connect metadataChanged signal to update the icon dynamically
        cell.metadataChanged.connect(() => {
          updateButtonIcon(button, cell);
        });

        return button;
      });
    }
  },
};
export default plugin;
