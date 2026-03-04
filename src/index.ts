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
import {
  LabIcon,
  ToolbarButton,
  settingsIcon,
} from '@jupyterlab/ui-components';
import {
  IToolbarWidgetRegistry,
  showErrorMessage,
  Notification as JupyterNotification,
} from '@jupyterlab/apputils';
import { TimeInputDialog } from './utils';
import { TimeUnit } from './timeInput';
import {
  bellOutlineIcon,
  bellOffIcon,
  bellAlertIcon,
  bellClockIcon,
} from './icons';
import { requestAPI } from './handler';
import { Cell, ICellModel, ICodeCellModel } from '@jupyterlab/cells';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { MenuSvg } from '@jupyterlab/ui-components';
import { BatchNotifier } from './batch_notify';
import { createRendererFactory } from './mime';
import { caretSVG } from './utils';

namespace CommandIDs {
  export const setNotificationMode = 'notify:set-notification-mode';
  export const setCustomTimeout = 'notify:set-custom-timeout';
  export const setNotebookCustomTimeout = 'notify:set-notebook-custom-timeout';
  export const setNotebookDefaultThreshold =
    'notify:set-notebook-default-threshold';
  export const openNotificationSettings = 'notify:open-notification-settings';
  export const setNotebookNotificationMode =
    'notify:set-notebook-notification-mode';
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
const CELL_DEFAULT_THRESHOLD_KEY = 'defaultThreshold';
const CELL_CUSTOM_TIMEOUT_KEY = 'customTimeout';
const NB_TOOLBAR_NOTIFICATION_CLASS = 'jp-Toolbar-notification-mode';

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
  defaultThreshold?: string;
  customTimeout?: string;
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
  notebookId: string;
  notebookName: string;
}

export interface INotificationData {
  type: string;
  payload: {
    title: string;
    body: string;
    cellId: string;
    notebookId: string;
    notebookName: string;
    executionCount?: number;
  };
  isProcessed: boolean;
  id: string;
}

// Constants
const ModeIds = ['default', 'never', 'on-error', 'custom-timeout'] as const;
type ModeId = (typeof ModeIds)[number];
export type NotifyType = 'completed' | 'failed' | 'timeout';

const MODES: Record<ModeId, IMode & { info: string }> = {
  default: {
    label: 'Default',
    icon: bellOutlineIcon,
    info: 'Notify after cell finishes execution if it exceeds the default threshold.',
  },
  never: {
    label: 'Never',
    icon: bellOffIcon,
    info: 'Never send notifications for this cell.',
  },
  'on-error': {
    label: 'On error',
    icon: bellAlertIcon,
    info: 'Notify only if cell execution fails.',
  },
  'custom-timeout': {
    label: 'Custom Timeout',
    icon: bellClockIcon,
    info: 'Notify after a custom timeout, regardless of execution result.',
  },
};

// Regular expression for validating timeout input
const TIMEOUT_PATTERN = /^(\d+(\.\d+)?)([smh])$/;
const NOTEBOOK_FILE_EXTENSION = '.ipynb';

const stripNotebookExtension = (pathOrName: string): string => {
  const notebookName = pathOrName.split('/').pop() ?? pathOrName;
  return notebookName.endsWith(NOTEBOOK_FILE_EXTENSION)
    ? notebookName.slice(0, -NOTEBOOK_FILE_EXTENSION.length)
    : notebookName;
};

const buildNotificationTitle = (
  notebookName: string,
  message: string,
): string => {
  return `[${notebookName}] ${message}`;
};

/**
 * Generates notification data for desktop alerts.
 */
const generateNotificationData = (
  message: string,
  cell_id: string,
  notebookId: string,
  notebookName: string,
  executionCount: number | null,
): INotificationData => ({
  type: 'NOTIFY',
  payload: {
    title: buildNotificationTitle(notebookName, message),
    body: typeof executionCount === 'number' ? `Cell: ${executionCount}` : '',
    cellId: cell_id,
    notebookId: notebookId,
    notebookName,
    ...(typeof executionCount === 'number' ? { executionCount } : {}),
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
 * Parses a threshold string like '2s', '5m', '1.5h' and returns value and TimeUnit.
 * Returns null if the input is invalid.
 */
function parseThreshold(
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

    const resolveNotebookName = (notebookId: string): string => {
      let notebookPathOrName: string | null = null;
      tracker.forEach(panel => {
        if (panel.content.id === notebookId) {
          notebookPathOrName = panel.context.path || panel.title.label;
        }
      });

      if (!notebookPathOrName) {
        return 'Unknown Notebook';
      }

      return stripNotebookExtension(notebookPathOrName);
    };

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
        let nbThreshold = nbMetadata?.[NOTEBOOK_DEFAULT_THRESHOLD_KEY];
        if (typeof nbThreshold === 'number') {
          nbThreshold = `${nbThreshold}s`;
        }
        cell.setMetadata(NOTIFY_METADATA_KEY, {
          mode,
          ...(nbThreshold ? { [CELL_DEFAULT_THRESHOLD_KEY]: nbThreshold } : {}),
        });
      } else if (mode === 'custom-timeout') {
        // Use timeout from notebook metadata's NOTEBOOK_CUSTOM_TIMEOUT_KEY if present
        let nbCustomTimeout = nbMetadata?.[NOTEBOOK_CUSTOM_TIMEOUT_KEY];
        if (typeof nbCustomTimeout === 'number') {
          nbCustomTimeout = `${nbCustomTimeout}s`;
        }
        cell.setMetadata(NOTIFY_METADATA_KEY, {
          mode,
          ...(nbCustomTimeout
            ? { [CELL_CUSTOM_TIMEOUT_KEY]: nbCustomTimeout }
            : {}),
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
          [NOTEBOOK_CUSTOM_TIMEOUT_KEY]:
            typeof notifySettings.customTimeout === 'number'
              ? `${notifySettings.customTimeout}s`
              : notifySettings.customTimeout,
          [NOTEBOOK_DEFAULT_THRESHOLD_KEY]:
            typeof notifySettings.defaultThreshold === 'number'
              ? `${notifySettings.defaultThreshold}s`
              : notifySettings.defaultThreshold,
        });
      }
      // Explicitly run addCellMetadata on the first cell as we miss it while waiting above
      if (notebook.widgets.length > 0 && nbModel) {
        const firstCell = notebook.widgets[0].model;
        if (firstCell && firstCell.type === 'code') {
          addCellMetadata(firstCell, nbModel);
        }
      }
      // Track new cells
      nbModel?.cells.changed.connect((_, change) => {
        if (change.type === 'add') {
          change.newValues.forEach(cell => {
            if (cell.type === 'code') {
              if (notebook.model) {
                addCellMetadata(cell, notebook.model);
              }
            }
          });
        }
      });

      // Monitor kernel status changes to detect kernel death and autorestarts
      const handleKernelDeath = async () => {
        const session = notebookPanel.sessionContext.session;
        if (!session) {
          return;
        }
        const kernel = session.kernel;
        if (
          !kernel ||
          (kernel.status !== 'autorestarting' && kernel.status !== 'dead')
        ) {
          return;
        }

        const notebookId = notebook.id;
        for (const [cellId, notification] of cellNotificationMap.entries()) {
          if (
            notification.notebookId === notebookId &&
            notification.payload.mode === 'on-error' &&
            !notification.notificationIssued
          ) {
            const cellWidget = notebook.widgets.find(
              w => w.model.id === cellId,
            );
            if (cellWidget) {
              await handleNotification(cellWidget.model, false, notebookId);
            }
          }
        }
      };

      notebookPanel.sessionContext.statusChanged.connect(handleKernelDeath);

      const onKernelStatusChanged = () => {
        handleKernelDeath().catch(err => {
          console.error('Error handling kernel death:', err);
        });
      };

      notebookPanel.sessionContext.kernelChanged.connect(() => {
        const kernel = notebookPanel.sessionContext.session?.kernel;
        if (kernel) {
          // Connect to kernel status changes
          kernel.statusChanged.disconnect(onKernelStatusChanged);
          kernel.statusChanged.connect(onKernelStatusChanged);
        }
      });

      // Connect to initial kernel if it exists
      const kernel = notebookPanel.sessionContext.session?.kernel;
      if (kernel) {
        kernel.statusChanged.connect(onKernelStatusChanged);
      }
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
      if (cell.type !== 'code') {
        return;
      }
      const cellId = cell.id;
      const notification = cellNotificationMap.get(cellId);
      if (!notification || notification.notificationIssued) {
        return;
      }

      const { payload } = notification;
      if (payload.mode === 'on-error' && success && !threshold) {
        return;
      }
      // Return for custom-timeout if this isn't triggered by reaching threshold or if cell already finished execution
      if (
        payload.mode === 'custom-timeout' &&
        (!threshold || (cell as ICodeCellModel).executionState !== 'running')
      ) {
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

      // Determine notification type based on execution state
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
      const executionCount = (cell as ICodeCellModel).executionCount;

      const notificationData = generateNotificationData(
        message,
        cellId,
        notebookId,
        notification.notebookName || resolveNotebookName(notebookId),
        typeof executionCount === 'number' ? executionCount : null,
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
      const { notebook, cell } = args;
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
        // Get the threshold value: prefer cell, then notebook, then settings
        const thresholdValue =
          cellMetadata[CELL_DEFAULT_THRESHOLD_KEY] ??
          notebook.model?.getMetadata(NOTIFY_METADATA_KEY)?.[
            NOTEBOOK_DEFAULT_THRESHOLD_KEY
          ] ??
          notifySettings.defaultThreshold;
        const thresholdInSeconds = decodeThresholdToSeconds(thresholdValue);

        if (!Number.isFinite(thresholdInSeconds)) {
          JupyterNotification.emit(
            `Invalid default threshold value: Expected a finite number, but received ${
              cellMetadata[CELL_DEFAULT_THRESHOLD_KEY] ?? 'undefined'
            }`,
            'error',
            { autoClose: 3000 },
          );
          return;
        }
      }

      if (mode === 'custom-timeout') {
        const thresholdValue =
          cellMetadata[CELL_CUSTOM_TIMEOUT_KEY] ??
          notebook.model?.getMetadata(NOTIFY_METADATA_KEY)?.[
            NOTEBOOK_CUSTOM_TIMEOUT_KEY
          ] ??
          notifySettings.customTimeout;
        const thresholdInSeconds = decodeThresholdToSeconds(thresholdValue);

        if (!Number.isFinite(thresholdInSeconds)) {
          JupyterNotification.emit(
            `Invalid custom timeout value: Expected a finite number, but received ${
              cellMetadata[CELL_CUSTOM_TIMEOUT_KEY] ?? 'undefined'
            }`,
            'error',
            { autoClose: 3000 },
          );
          return;
        }
      }

      const thresholdValue =
        mode === 'default'
          ? cellMetadata[CELL_DEFAULT_THRESHOLD_KEY] ??
            notebook.model?.getMetadata(NOTIFY_METADATA_KEY)?.[
              NOTEBOOK_DEFAULT_THRESHOLD_KEY
            ] ??
            notifySettings.defaultThreshold
          : mode === 'custom-timeout'
          ? cellMetadata[CELL_CUSTOM_TIMEOUT_KEY] ??
            notebook.model?.getMetadata(NOTIFY_METADATA_KEY)?.[
              NOTEBOOK_CUSTOM_TIMEOUT_KEY
            ] ??
            notifySettings.customTimeout
          : notifySettings.defaultThreshold;

      const payload = {
        cell_id: cell.model.id,
        mode,
        emailEnabled: config.email_configured && notifySettings.mail,
        slackEnabled: config.slack_configured && notifySettings.slack,
        successMessage: notifySettings.successMessage,
        failureMessage: notifySettings.failureMessage,
        threshold: decodeThresholdToSeconds(thresholdValue),
      };

      const notification: ICellNotification = {
        payload,
        timeoutId: null,
        notificationIssued: false,
        notebookId: args.notebook.id,
        notebookName: resolveNotebookName(args.notebook.id),
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
        const timeoutInSeconds = payload.threshold;
        if (
          Number.isFinite(timeoutInSeconds) &&
          timeoutInSeconds !== null &&
          timeoutInSeconds !== undefined
        ) {
          notification.timeoutId = setTimeout(() => {
            if (!notification.notificationIssued) {
              handleNotification(cell.model, true, args.notebook.id, true);
            }
          }, timeoutInSeconds * 1000);
        }
      }
    });
    const trans = (translator ?? nullTranslator).load('jupyterlab-notify');

    // Add command to open Settings
    app.commands.addCommand(CommandIDs.openNotificationSettings, {
      label: trans.__('Settings..'),
      icon: settingsIcon,
      execute: () => {
        app.commands.execute('settingeditor:open', {
          query: 'Execution Notifications',
        });
      },
    });

    // Command to set Notebook notificaion mode
    app.commands.addCommand(CommandIDs.setNotebookNotificationMode, {
      label: args => {
        if (args.label) {
          return args.label as string;
        }
        const modeId = args.modeId as ModeId;
        return MODES[modeId].label;
      },
      icon: args => MODES[args.modeId as ModeId].icon,
      execute: args => {
        const modeId = args.modeId;
        const notebook = tracker.currentWidget;
        if (notebook && notebook.model) {
          // Update the notebook metadata properly
          const prev = notebook.model.getMetadata(NOTIFY_METADATA_KEY) || {};
          notebook.model.setMetadata(NOTIFY_METADATA_KEY, {
            ...prev,
            mode: modeId,
          });
        }
      },
    });

    // Command to set Cell notification mode and threshold
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
        const modeId = args.modeId as ModeId;
        let threshold = args.threshold as string | undefined; // Stored as string, e.g., "120s"
        const current = tracker.currentWidget;
        if (!current) {
          console.warn('No notebook selected');
          return;
        }
        const cell = current.content.activeCell;
        if (!cell) {
          return;
        }

        // Get existing metadata to preserve thresholds
        const existingMetadata = cell.model.getMetadata(NOTIFY_METADATA_KEY) as
          | ICellMetadata
          | undefined;

        const metadata: ICellMetadata = { mode: modeId };

        // Preserve existing thresholds from both modes
        if (existingMetadata?.[CELL_DEFAULT_THRESHOLD_KEY]) {
          metadata[CELL_DEFAULT_THRESHOLD_KEY] =
            existingMetadata[CELL_DEFAULT_THRESHOLD_KEY];
        }
        if (existingMetadata?.[CELL_CUSTOM_TIMEOUT_KEY]) {
          metadata[CELL_CUSTOM_TIMEOUT_KEY] =
            existingMetadata[CELL_CUSTOM_TIMEOUT_KEY];
        }

        // Override threshold if explicitly provided in args
        if (modeId === 'custom-timeout' || modeId === 'default') {
          const nbModel = current?.model;
          if (!threshold) {
            if (modeId === 'default') {
              threshold =
                existingMetadata?.[CELL_DEFAULT_THRESHOLD_KEY] ??
                nbModel?.getMetadata(NOTIFY_METADATA_KEY)?.[
                  NOTEBOOK_DEFAULT_THRESHOLD_KEY
                ];
            } else {
              threshold =
                existingMetadata?.[CELL_CUSTOM_TIMEOUT_KEY] ??
                nbModel?.getMetadata(NOTIFY_METADATA_KEY)?.[
                  NOTEBOOK_CUSTOM_TIMEOUT_KEY
                ];
            }
          }
          if (threshold) {
            if (modeId === 'default') {
              metadata[CELL_DEFAULT_THRESHOLD_KEY] = threshold;
            } else {
              metadata[CELL_CUSTOM_TIMEOUT_KEY] = threshold;
            }
          }
        }

        cell.model.setMetadata(NOTIFY_METADATA_KEY, metadata);
      },
      isEnabled: () =>
        !!tracker.currentWidget && !!tracker.currentWidget.content.activeCell,
    });

    // Helper to prompt for a timeout/threshold value and validate it
    async function promptForTimeout(
      options: {
        title: string;
        label: string;
        placeholder: string;
        errorMessage: string;
        defaultValue?: number;
        defaultUnit?: TimeUnit;
      },
      showCheckbox = false,
    ): Promise<{ value: string | null; applyToAll: boolean }> {
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
        const prev = current.model.getMetadata(NOTIFY_METADATA_KEY) || {};
        let value: number | undefined = undefined;
        let unit: TimeUnit | undefined = undefined;
        if (prev[NOTEBOOK_CUSTOM_TIMEOUT_KEY]) {
          const parsed = parseThreshold(prev[NOTEBOOK_CUSTOM_TIMEOUT_KEY]);
          if (parsed) {
            value = parsed.value;
            unit = parsed.unit;
          }
        }
        const timeoutOptions = {
          title: 'Set Notebook Custom Timeout',
          label: 'Custom timeout value with unit:',
          placeholder: '30',
          errorMessage:
            'Please enter a positive number and select a unit (seconds, minutes, or hours).',
          defaultValue: value,
          defaultUnit: unit,
        };
        const { value: input, applyToAll } = await promptForTimeout(
          timeoutOptions,
          true,
        );
        if (input) {
          current.model.setMetadata(NOTIFY_METADATA_KEY, {
            ...prev,
            [NOTEBOOK_CUSTOM_TIMEOUT_KEY]: input,
          });

          // Apply to all cells if requested
          if (applyToAll && current.content) {
            current.content.widgets.forEach(cellWidget => {
              const cellModel = cellWidget.model;
              const cellMetadata = cellModel.getMetadata(
                NOTIFY_METADATA_KEY,
              ) as ICellMetadata | undefined;

              // Only update cells that have a customTimeout value
              if (cellMetadata?.[CELL_CUSTOM_TIMEOUT_KEY]) {
                cellModel.setMetadata(NOTIFY_METADATA_KEY, {
                  ...cellMetadata,
                  [CELL_CUSTOM_TIMEOUT_KEY]: input,
                });
              }
            });
          }
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
        const prev = current.model.getMetadata(NOTIFY_METADATA_KEY) || {};
        let value: number | undefined = undefined;
        let unit: TimeUnit | undefined = undefined;
        if (prev[NOTEBOOK_DEFAULT_THRESHOLD_KEY]) {
          const parsed = parseThreshold(prev[NOTEBOOK_DEFAULT_THRESHOLD_KEY]);
          if (parsed) {
            value = parsed.value;
            unit = parsed.unit;
          }
        }
        const thresholdOptions = {
          title: 'Set Notebook Default Threshold',
          label: 'Default Threshold value with unit:',
          placeholder: '30',
          errorMessage:
            'Please enter a positive number and select a unit (seconds, minutes, or hours).',
          defaultValue: value,
          defaultUnit: unit,
        };
        const { value: input, applyToAll } = await promptForTimeout(
          thresholdOptions,
          true,
        );
        if (input) {
          const prev = current.model.getMetadata(NOTIFY_METADATA_KEY) || {};
          current.model.setMetadata(NOTIFY_METADATA_KEY, {
            ...prev,
            [NOTEBOOK_DEFAULT_THRESHOLD_KEY]: input,
          });

          // Apply to all cells if requested
          if (applyToAll && current.content) {
            current.content.widgets.forEach(cellWidget => {
              const cellModel = cellWidget.model;
              const cellMetadata = cellModel.getMetadata(
                NOTIFY_METADATA_KEY,
              ) as ICellMetadata | undefined;

              // Only update cells that have a defaultThreshold value
              if (cellMetadata?.[CELL_DEFAULT_THRESHOLD_KEY]) {
                cellModel.setMetadata(NOTIFY_METADATA_KEY, {
                  ...cellMetadata,
                  [CELL_DEFAULT_THRESHOLD_KEY]: input,
                });
              }
            });
          }
        }
      },
    });

    app.commands.addCommand(CommandIDs.setCustomTimeout, {
      caption: 'Set a custom timeout for cell notifications',
      label: trans.__('Custom'),
      execute: async () => {
        const current = tracker.currentWidget;
        let value: number | undefined = undefined;
        let unit: TimeUnit | undefined = undefined;
        if (current && current.content && current.content.activeCell) {
          const cell = current.content.activeCell;
          const prev = cell.model.getMetadata(NOTIFY_METADATA_KEY) || {};
          if (prev[CELL_CUSTOM_TIMEOUT_KEY]) {
            const parsed = parseThreshold(prev[CELL_CUSTOM_TIMEOUT_KEY]);
            if (parsed) {
              value = parsed.value;
              unit = parsed.unit;
            }
          }
        }
        const { value: input } = await promptForTimeout({
          title: 'Set Custom Timeout',
          label: 'Custom timeout value with unit:',
          placeholder: '30',
          errorMessage:
            'Please enter a positive number and select a unit (seconds, minutes, or hours).',
          defaultValue: value,
          defaultUnit: unit,
        });
        if (input) {
          await app.commands.execute(CommandIDs.setNotificationMode, {
            modeId: 'custom-timeout',
            threshold: input,
          });
        }
      },
    });

    // Menu for Cell Notification modes
    const cellNotifyMenu = new MenuSvg({ commands: app.commands });
    cellNotifyMenu.addClass('jp-notify-menu');
    cellNotifyMenu.title.label = trans.__('Cell Notification');

    Object.entries(MODES).forEach(([modeId, mode]) => {
      if (modeId === 'custom-timeout') {
        const subMenu = new MenuSvg({ commands: app.commands });
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
        cellNotifyMenu.addItem({ type: 'submenu', submenu: subMenu });
      } else if (modeId === 'default') {
        cellNotifyMenu.addItem({
          command: CommandIDs.setNotificationMode,
          args: {
            modeId,
            // Not sending threshold as it will be retrieved by the command from notebook's metadata
          },
        });
      } else {
        cellNotifyMenu.addItem({
          command: CommandIDs.setNotificationMode,
          args: { modeId },
        });
      }
    });
    // Add Settings Shortcut
    cellNotifyMenu.addItem({
      type: 'separator',
    });
    cellNotifyMenu.addItem({
      type: 'command',
      command: CommandIDs.openNotificationSettings,
    });

    setTimeout(() => {
      cellNotifyMenu.node
        .querySelectorAll('ul.lm-Menu-content > li.lm-Menu-item')
        .forEach(li => {
          const labelDiv = li.querySelector('.lm-Menu-itemLabel');
          let modeId = '';
          if (labelDiv && labelDiv.textContent) {
            modeId = labelDiv.textContent
              .trim()
              .toLowerCase()
              .replace(/\s+/g, '-');
          }
          if (Object.prototype.hasOwnProperty.call(MODES, modeId)) {
            li.setAttribute('title', MODES[modeId as ModeId].info ?? '');
          } else if (modeId === 'settings..') {
            li.setAttribute('title', 'Go to Notification Settings');
          }
        });
    }, 0);

    // Menu for Cell Notification modes
    const nbNotifyMenu = new MenuSvg({ commands: app.commands });
    nbNotifyMenu.addClass('jp-notify-menu');
    nbNotifyMenu.title.label = trans.__('Notebook Notification');

    // Menu items will be built dynamically when the menu is opened

    // Helper function to update the cell toolbar button on metadata change
    function updateCellToolbarButton(button: ToolbarButton, cell: ICellModel) {
      const metadata = cell.getMetadata(NOTIFY_METADATA_KEY) as
        | ICellMetadata
        | undefined;
      const modeId = metadata?.mode ?? notifySettings.defaultMode;
      const newIcon = MODES[modeId].icon;

      // Replace the tooltip
      let tooltip = MODES[modeId].label;
      let threshold =
        modeId === 'default'
          ? metadata?.[CELL_DEFAULT_THRESHOLD_KEY]
          : modeId === 'custom-timeout'
          ? metadata?.[CELL_CUSTOM_TIMEOUT_KEY]
          : undefined;
      if (!threshold) {
        const nbMetadata = tracker.currentWidget?.model?.getMetadata(
          NOTIFY_METADATA_KEY,
        ) as Record<string, any> | undefined;

        threshold =
          modeId === 'default'
            ? nbMetadata?.[NOTEBOOK_DEFAULT_THRESHOLD_KEY]
            : modeId === 'custom-timeout'
            ? nbMetadata?.[NOTEBOOK_CUSTOM_TIMEOUT_KEY]
            : undefined;
      }

      if ((modeId === 'default' || modeId === 'custom-timeout') && threshold) {
        tooltip += ` (${
          typeof threshold === 'number' ? `${threshold}s` : threshold
        })`;
      }
      tooltip += '\nClick to change';
      const jpButton = button.node.querySelector('jp-button');
      if (jpButton) {
        jpButton.setAttribute('aria-label', trans.__(tooltip));
        jpButton.setAttribute('title', trans.__(tooltip));
      }
      // Replace the SVG in the button
      const svgElement = button.node.querySelector('svg');
      if (svgElement) {
        svgElement.outerHTML = newIcon.svgstr;
      } else {
        // Fallback if no SVG is present
        button.node.innerHTML = newIcon.svgstr;
      }
    }

    // Helper function to update notebook toolbar button on metadata change
    function updateNbToolbarButton(
      button: ToolbarButton,
      notebook: INotebookModel,
    ) {
      const metadata = notebook.getMetadata(NOTIFY_METADATA_KEY) as
        | ICellMetadata
        | undefined;
      const modeId = metadata?.mode ?? notifySettings.defaultMode;
      const newIcon = MODES[modeId].icon;
      const labelElement = button.node.querySelector(
        '.jp-ToolbarButtonComponent-label',
      );
      if (labelElement) {
        labelElement.textContent = trans.__(MODES[modeId].label);
        // Insert caret-down icon after label
        const caretSpan = document.createElement('span');
        caretSpan.className = 'jp-notify-toolbar-caret';
        caretSpan.innerHTML = caretSVG;
        labelElement.appendChild(caretSpan);
      }
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
      // toolbarRegistry.addFactory<NotebookPanel>(
      //   'Notebook',
      //   'notifyType',
      //   args => {
      //     return new NotificationModeSwitcher(args, notifySettings, translator);
      //   },
      // );
      toolbarRegistry.addFactory<NotebookPanel>(
        'Notebook',
        'notifyType',
        args => {
          const notebook = args.model;
          if (!notebook) {
            return new ToolbarButton({});
          }

          const metadata = notebook.getMetadata(NOTIFY_METADATA_KEY) as
            | ICellMetadata
            | undefined;
          const modeId = metadata?.mode ?? notifySettings.defaultMode;
          const icon = MODES[modeId].icon;
          const labelElement = trans.__(MODES[modeId].label);

          const button = new ToolbarButton({
            label: labelElement,
            tooltip: trans.__(
              'Set notification settings for this notebook\nAll newly created cells in this notebook will use this type.',
            ),
            icon,
            onClick: () => {
              if (nbNotifyMenu.isVisible) {
                nbNotifyMenu.close();
              } else {
                // Update menu items with current notebook's threshold values
                const nbMetadata = notebook.getMetadata(
                  NOTIFY_METADATA_KEY,
                ) as any;
                const defaultThreshold =
                  nbMetadata?.[NOTEBOOK_DEFAULT_THRESHOLD_KEY];
                const customThreshold =
                  nbMetadata?.[NOTEBOOK_CUSTOM_TIMEOUT_KEY];

                // Clear and rebuild menu with current values
                nbNotifyMenu.clearItems();
                Object.entries(MODES).forEach(([modeId, mode]) => {
                  if (modeId === 'custom-timeout') {
                    const label = customThreshold
                      ? `${mode.label} (${customThreshold})`
                      : mode.label;
                    nbNotifyMenu.addItem({
                      command: CommandIDs.setNotebookNotificationMode,
                      args: {
                        modeId,
                        label,
                      },
                    });
                  } else if (modeId === 'default') {
                    const label = defaultThreshold
                      ? `${mode.label} (${defaultThreshold})`
                      : mode.label;
                    nbNotifyMenu.addItem({
                      command: CommandIDs.setNotebookNotificationMode,
                      args: {
                        modeId,
                        label,
                      },
                    });
                  } else {
                    nbNotifyMenu.addItem({
                      command: CommandIDs.setNotebookNotificationMode,
                      args: { modeId },
                    });
                  }
                });

                // Add Settings Shortcut
                nbNotifyMenu.addItem({
                  type: 'separator',
                });
                nbNotifyMenu.addItem({
                  type: 'command',
                  command: CommandIDs.setNotebookDefaultThreshold,
                });
                nbNotifyMenu.addItem({
                  type: 'command',
                  command: CommandIDs.setNotebookCustomTimeout,
                });

                // Update tooltips
                setTimeout(() => {
                  nbNotifyMenu.node
                    .querySelectorAll('ul.lm-Menu-content > li.lm-Menu-item')
                    .forEach(li => {
                      const labelDiv = li.querySelector('.lm-Menu-itemLabel');
                      let mode = '';
                      if (labelDiv && labelDiv.textContent) {
                        mode = labelDiv.textContent
                          .trim()
                          .toLowerCase()
                          .replace(/\s+/g, '-')
                          .replace(/\(\d+[smh]\)$/, '')
                          .trim();
                      }
                      if (Object.prototype.hasOwnProperty.call(MODES, mode)) {
                        li.setAttribute(
                          'title',
                          MODES[mode as ModeId].info ?? '',
                        );
                      } else if (mode === 'set-default-threshold') {
                        li.setAttribute(
                          'title',
                          'Set value of default notification threshold for this notebook',
                        );
                      } else if (mode === 'set-custom-timeout') {
                        li.setAttribute(
                          'title',
                          'Set value of custom notification timeout for this notebook',
                        );
                      }
                    });
                }, 0);

                const rect = button.node.getBoundingClientRect();
                nbNotifyMenu.open(rect.right, rect.bottom, {
                  horizontalAlignment: 'right',
                });
              }
            },
          });
          button.addClass(NB_TOOLBAR_NOTIFICATION_CLASS);

          // Connect metadataChanged signal to update the icon dynamically
          notebook.metadataChanged.connect(() => {
            updateNbToolbarButton(button, notebook);
          });

          return button;
        },
      );

      toolbarRegistry.addFactory<Cell>('Cell', 'cellNotifyMenu', args => {
        const cell = args.model;

        const metadata = cell.getMetadata(NOTIFY_METADATA_KEY) as
          | ICellMetadata
          | undefined;
        const modeId = metadata?.mode ?? notifySettings.defaultMode; // Fallback to default if metadata is unset
        let tooltip = MODES[modeId].label;
        let threshold =
          modeId === 'default'
            ? metadata?.[CELL_DEFAULT_THRESHOLD_KEY]
            : modeId === 'custom-timeout'
            ? metadata?.[CELL_CUSTOM_TIMEOUT_KEY]
            : undefined;
        if (!threshold) {
          const nbMetadata = tracker.currentWidget?.model?.getMetadata(
            NOTIFY_METADATA_KEY,
          ) as Record<string, any> | undefined;

          threshold =
            modeId === 'default'
              ? nbMetadata?.[NOTEBOOK_DEFAULT_THRESHOLD_KEY]
              : modeId === 'custom-timeout'
              ? nbMetadata?.[NOTEBOOK_CUSTOM_TIMEOUT_KEY]
              : undefined;
        }
        if (
          (modeId === 'default' || modeId === 'custom-timeout') &&
          threshold
        ) {
          tooltip += ` (${threshold})`;
        }
        tooltip += '\nClick to change';
        // Create the button with the correct initial icon
        const button = new ToolbarButton({
          tooltip: trans.__(tooltip),
          icon: MODES[modeId].icon, // Set initial icon based on current metadata
          onClick: () => {
            if (cellNotifyMenu.isVisible) {
              //TODO: fix closing
              cellNotifyMenu.close();
            } else {
              const rect = button.node.getBoundingClientRect();
              cellNotifyMenu.open(rect.right, rect.bottom, {
                horizontalAlignment: 'right',
              });
            }
          },
        });

        // Connect metadataChanged signal to update the icon dynamically
        cell.metadataChanged.connect(() => {
          updateCellToolbarButton(button, cell);
        });

        return button;
      });
    }
  },
};
export default plugin;
