import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
} from '@jupyterlab/application';
import {
  INotebookModel,
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
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { Menu } from '@lumino/widgets';
import { BatchNotifier } from './batch_notify';
import { createRendererFactory } from './mime';
import { NotificationModeSwitcher } from './notebook-toolbar';

namespace CommandIDs {
  export const setNotificationMode = 'notify:set-notification-mode';
  export const setCustomTimeout = 'notify:set-custom-timeout';
  export const setNotebookCustomTimeout = 'notify:set-notebook-custom-timeout';
  export const setNotebookDefaultThreshold =
    'notify:set-notebook-default-threshold';
}

// Timeout options for the submenu
const TIMEOUT_OPTIONS = [
  { label: 'default', value: 'default' },
  { label: '1 min', value: '1m' },
  { label: '30 min', value: '30m' },
  { label: 'Custom', value: 'custom' },
];

const NOTIFY_METADATA_KEY = 'jupyterlab_notify.notify';
const NOTEBOOK_DEFAULT_THRESHOLD_KEY = 'defaultThreshold';
const NOTEBOOK_CUSTOM_TIMEOUT_KEY = 'customTimeout';

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
  customTimeout: number | null;
}

interface ICellMetadata {
  mode: ModeId;
  threshold?: string;
}

interface IInitialResponse {
  nbmodel_installed: boolean;
  email_configured: boolean;
  slack_configured: boolean;
  smtp_server_running: boolean;
}

interface ICellNotification {
  payload: any;
  timeoutId: number | null;
  notificationIssued: boolean;
}

export interface INotificationData {
  type: string;
  payload: {
    title: string;
    body: string;
    cellId: string;
    notebookId: string;
  };
  isProcessed: boolean;
  id: string;
}

// Constants
const ModeIds = ['default', 'never', 'on-error', 'custom-timeout'] as const;
type ModeId = (typeof ModeIds)[number];
export type NotifyType = 'completed' | 'failed' | 'timeout';

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
  notebookId: string,
): INotificationData => ({
  type: 'NOTIFY',
  payload: {
    title: message,
    body: `Cell id: ${cell_id}`,
    cellId: cell_id,
    notebookId: notebookId,
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
            message: `Add a ${service.toLowerCase()} configuration to directory listed under the config section of jupyter --paths (e.g., ~/.jupyter/jupyter_notify_config.json) to enable ${service.toLowerCase()} notifications. Example: \n{\n  "${configKey}": "${example}"}"\n}. If you've already configured it, there might be an issue. Please check the terminal for errors and review your setup.`,
          }),
      },
    ],
  });
};

// Function to decode threshold to seconds
function decodeThresholdToSeconds(threshold: string | number) {
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

    const batchNotifier = new BatchNotifier(rendermime);
    // Ensure app.shell is an ILabShell
    const labShell = app.shell as any;
    const rendererFactory = createRendererFactory(tracker, labShell);
    // Register the mime extension for the rendermime registry
    rendermime.addFactory(rendererFactory, 0);

    // Default settings
    let notifySettings: INotifySettings = {
      defaultMode: 'default',
      failureMessage: 'Cell execution failed',
      mail: false,
      slack: false,
      successMessage: 'Cell execution completed successfully',
      defaultThreshold: 30,
      customTimeout: 30,
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

    const addCellMetadata = (
      cell: ICellModel,
      nbmodel: INotebookModel,
    ): void => {
      if (cell.getMetadata(NOTIFY_METADATA_KEY)) {
        return;
      }
      // If notebook metadata for NOTIFY_METADATA_KEY exists, use its mode for the cell; otherwise, use defaultMode
      const nbMetadata = nbmodel.getMetadata(NOTIFY_METADATA_KEY);
      const mode = nbMetadata?.mode ?? notifySettings.defaultMode;
      if (mode === 'default') {
        // Use threshold from notebook metadata's NOTEBOOK_DEFAULT_THRESHOLD_KEY if present
        const nbThreshold = nbMetadata?.[NOTEBOOK_DEFAULT_THRESHOLD_KEY];
        cell.setMetadata(NOTIFY_METADATA_KEY, {
          mode,
          ...(nbThreshold ? { threshold: nbThreshold } : {}),
        });
      } else if (mode === 'custom-timeout') {
        // Use threshold from notebook metadata's NOTEBOOK_CUSTOM_TIMEOUT_KEY if present
        const nbCustomTimeout = nbMetadata?.[NOTEBOOK_CUSTOM_TIMEOUT_KEY];
        cell.setMetadata(NOTIFY_METADATA_KEY, {
          mode,
          ...(nbCustomTimeout ? { threshold: nbCustomTimeout } : {}),
        });
      } else {
        cell.setMetadata(NOTIFY_METADATA_KEY, { mode });
      }
    };

    // Track new cells
    tracker.widgetAdded.connect(async (_, notebookPanel: NotebookPanel) => {
      // Wait for the notebook to be fully ready
      await notebookPanel.revealed;
      await notebookPanel.sessionContext.ready;

      const notebook = notebookPanel.content;
      // Set notebook metadata if not present
      const nbModel = notebook.model;
      if (nbModel && !nbModel.getMetadata(NOTIFY_METADATA_KEY)) {
        nbModel.setMetadata(NOTIFY_METADATA_KEY, {
          mode: notifySettings.defaultMode,
          [NOTEBOOK_CUSTOM_TIMEOUT_KEY]: notifySettings.customTimeout,
          [NOTEBOOK_DEFAULT_THRESHOLD_KEY]: notifySettings.defaultThreshold,
        });
      }
      // Explicitly run addCellMetadata on the first cell as we miss it while waiting above
      if (notebook.widgets.length > 0 && nbModel) {
        const firstCell = notebook.widgets[0].model;
        if (firstCell) {
          addCellMetadata(firstCell, nbModel);
        }
      }
      // Track new cells
      nbModel?.cells.changed.connect((_, change) => {
        if (change.type === 'add') {
          change.newValues.forEach(cell =>
            addCellMetadata(cell, notebook.model!),
          );
        }
      });
    });

    // Server configuration
    let config: IInitialResponse = {
      nbmodel_installed: false,
      email_configured: false,
      slack_configured: false,
      smtp_server_running: false,
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
      notebookId: string,
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
      const state: NotifyType = threshold
        ? 'timeout'
        : success
        ? 'completed'
        : 'failed';
      const message =
        state === 'timeout'
          ? 'Cell execution timeout reached'
          : state === 'completed'
          ? notifySettings.successMessage
          : notifySettings.failureMessage;

      const notificationData = generateNotificationData(
        message,
        cellId,
        notebookId,
      );

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
        batchNotifier.notify(state, notificationData);
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
      handleNotification(args.cell.model, args.success, args.notebook.id);
    });

    NotebookActions.executionScheduled.connect(async (_, args) => {
      const { cell } = args;
      const cellMetadata = cell.model.getMetadata(
        NOTIFY_METADATA_KEY,
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
      if (notifySettings.mail) {
        if (!config.email_configured) {
          displayConfigWarning('Email', 'email', 'youremail@example.com');
        } else if (!config.smtp_server_running) {
          JupyterNotification.emit('SMTP Server Not Running', 'error', {
            autoClose: 3000,
            actions: [
              {
                label: 'Help',
                callback: () =>
                  showErrorMessage('SMTP server is not running', {
                    message:
                      'Email notifications require a local SMTP server running.',
                  }),
              },
            ],
          });
        }
      }
      if (notifySettings.slack && !config.slack_configured) {
        displayConfigWarning(
          'Slack',
          'slack_token',
          'xoxb-your-slackbot-token',
        );
      }
      if (mode === 'default') {
        // Prefer cellMetadata.threshold if present, else use notifySettings.defaultThreshold
        const thresholdInSeconds = cellMetadata.threshold
          ? decodeThresholdToSeconds(cellMetadata.threshold)
          : null;

        if (!Number.isFinite(thresholdInSeconds)) {
          JupyterNotification.emit(
            `Invalid default threshold value: Expected a finite number, but received ${
              cellMetadata.threshold ?? 'undefined'
            }`,
            'error',
            { autoClose: 3000 },
          );
          return;
        }
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
          return;
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
          mode === 'custom-timeout' || mode === 'default'
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
            handleNotification(cell.model, true, args.notebook.id, true);
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
        args.noIcon ? undefined : MODES[args.modeId as ModeId].icon,
      execute: args => {
        const modeId = args.modeId;
        let threshold = args.threshold; // Stored as string, e.g., "120s"
        const current = tracker.currentWidget;
        if (!current) {
          console.warn('No notebook selected');
          return;
        }
        const cell = current.content.activeCell;
        if (!cell) {
          return;
        }
        let metadata;
        if (modeId === 'custom-timeout' || modeId === 'default') {
          const nbModel = current?.model;
          if (modeId === 'default') {
            threshold =
              nbModel?.getMetadata(NOTIFY_METADATA_KEY)?.[
                NOTEBOOK_DEFAULT_THRESHOLD_KEY
              ];
          } else if (!threshold) {
            threshold =
              nbModel?.getMetadata(NOTIFY_METADATA_KEY)?.[
                NOTEBOOK_CUSTOM_TIMEOUT_KEY
              ];
          }
          metadata = { mode: modeId, threshold };
        } else {
          metadata = { mode: modeId };
        }
        cell.model.setMetadata(NOTIFY_METADATA_KEY, metadata);
      },
      isEnabled: () =>
        !!tracker.currentWidget && !!tracker.currentWidget.content.activeCell,
    });

    // Helper to prompt for a timeout/threshold value and validate it
    async function promptForTimeout(options: {
      title: string;
      label: string;
      placeholder: string;
      errorMessage: string;
    }): Promise<string | null> {
      const result = await InputDialog.getText({
        title: options.title,
        label: options.label,
        placeholder: options.placeholder,
      });
      if (!result.button.accept || !result.value) {
        return null;
      }
      const rawInput = result.value.trim();
      const lastChar = rawInput.slice(-1);
      const input =
        rawInput === ''
          ? ''
          : ['s', 'm', 'h'].includes(lastChar)
          ? rawInput
          : rawInput + 's';

      if (!rawInput || !TIMEOUT_PATTERN.test(input)) {
        await showErrorMessage('Invalid Input', options.errorMessage);
        return null;
      }
      return input;
    }

    // Command to set custom timeout in notebook metadata
    app.commands.addCommand(CommandIDs.setNotebookCustomTimeout, {
      label: trans.__('Set Custom Timeout'),
      caption: trans.__('Set Notebook Custom Timeout'),
      icon: args => (args.toolbar ? bellClockIcon : undefined),
      execute: async () => {
        const current = tracker.currentWidget;
        if (!current || !current.content || !current.model) {
          return;
        }
        const input = await promptForTimeout({
          title: 'Set Notebook Custom Timeout',
          label: 'Default: seconds, +m for minutes, +h for hours:',
          placeholder: '120 or 45m',
          errorMessage:
            'Please enter a positive number followed by s (seconds), m (minutes), or h (hours) — e.g., 120s, 45m, 1h.',
        });
        if (input) {
          const prev = current.model.getMetadata(NOTIFY_METADATA_KEY) || {};
          current.model.setMetadata(NOTIFY_METADATA_KEY, {
            ...prev,
            [NOTEBOOK_CUSTOM_TIMEOUT_KEY]: input,
          });
        }
      },
    });

    // Command to set default threshold in notebook metadata
    app.commands.addCommand(CommandIDs.setNotebookDefaultThreshold, {
      label: trans.__('Set Default Threshold'),
      caption: trans.__('Set Notebook Default Threshold'),
      icon: args => (args.toolbar ? bellOutlineIcon : undefined),
      execute: async () => {
        const current = tracker.currentWidget;
        if (!current || !current.content || !current.model) {
          return;
        }
        const input = await promptForTimeout({
          title: 'Set Notebook Default Threshold',
          label: 'Default: seconds, +m for minutes, +h for hours:',
          placeholder: '30 or 1m',
          errorMessage:
            'Please enter a positive number followed by s (seconds), m (minutes), or h (hours) — e.g., 30s, 1m, 1h.',
        });
        if (input) {
          const prev = current.model.getMetadata(NOTIFY_METADATA_KEY) || {};
          current.model.setMetadata(NOTIFY_METADATA_KEY, {
            ...prev,
            [NOTEBOOK_DEFAULT_THRESHOLD_KEY]: input,
          });
        }
      },
    });

    app.commands.addCommand(CommandIDs.setCustomTimeout, {
      label: trans.__('Custom'),
      execute: async () => {
        const input = await promptForTimeout({
          title: 'Set Custom Timeout',
          label: 'Default: seconds, +m for minutes, +h for hours:',
          placeholder: '120 or 45m',
          errorMessage:
            'Please enter a positive number followed by s (seconds), m (minutes), or h (hours) — e.g., 120s, 45m, 1h.',
        });
        if (input) {
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
          if (option.value === 'default') {
            subMenu.addItem({
              command: CommandIDs.setNotificationMode,
              // Not sending threshold as it will be retrieved by the command from notebook's metadata
              args: {
                modeId: 'custom-timeout',
                label: option.label,
                noIcon: true,
              },
            });
          } else if (option.value === 'custom') {
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
                noIcon: true,
              },
            });
          }
        });
        notifyMenu.addItem({ type: 'submenu', submenu: subMenu });
      } else if (modeId === 'default') {
        notifyMenu.addItem({
          command: CommandIDs.setNotificationMode,
          args: {
            modeId,
            // Not sending threshold as it will be retrieved by the command from notebook's metadata
          },
        });
      } else {
        notifyMenu.addItem({
          command: CommandIDs.setNotificationMode,
          args: { modeId },
        });
      }
    });

    // Helper function to update the button's icon
    function updateButtonIcon(button: ToolbarButton, cell: ICellModel) {
      const metadata = cell.getMetadata(NOTIFY_METADATA_KEY) as
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
      toolbarRegistry.addFactory<NotebookPanel>(
        'Notebook',
        'notifyType',
        args => {
          return new NotificationModeSwitcher(args, notifySettings, translator);
        },
      );

      toolbarRegistry.addFactory<Cell>('Cell', 'notifyMenu', args => {
        const cell = args.model as ICellModel;

        const metadata = cell.getMetadata(NOTIFY_METADATA_KEY) as
          | ICellMetadata
          | undefined;
        const modeId = metadata?.mode ?? notifySettings.defaultMode; // Fallback to default if metadata is unset

        // Create the button with the correct initial icon
        const button = new ToolbarButton({
          tooltip: trans.__('click to change'),
          icon: MODES[modeId].icon, // Set initial icon based on current metadata
          onClick: () => {
            if (notifyMenu.isVisible) {
              //TODO: fix closing
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
