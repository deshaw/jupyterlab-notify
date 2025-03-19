import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
} from '@jupyterlab/application';
import {
  INotebookTracker,
  NotebookActions,
  NotebookPanel,
  // NotebookPanel,
} from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { LabIcon, ToolbarButton } from '@jupyterlab/ui-components';
import {
  // createDefaultFactory,
  IToolbarWidgetRegistry,
  showErrorMessage,
} from '@jupyterlab/apputils';
import {
  bellOutlineIcon,
  // bellFilledIcon,
  bellOffIcon,
  bellAlertIcon,
  bellClockIcon,
} from './icons';
import { requestAPI } from './handler';
import { Notification as JupyterNotification } from '@jupyterlab/apputils';
import { Cell, ICellModel } from '@jupyterlab/cells';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { MimeModel } from '@jupyterlab/rendermime';
import { Menu } from '@lumino/widgets';

namespace CommandIDs {
  export const setNotificationMode = 'notify:set-notification-mode';
}

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
  customThreshold: number | null;
}

interface ICellMetadata {
  mode: ModeId;
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
            message: `Add a ${service.toLowerCase()} configuration to ~/.jupyter/jupyterlab_notify_config.json to enable ${service.toLowerCase()} notifications. Example: \n{\n  "${configKey}": "${example}"}-config"\n}`,
          }),
      },
    ],
  });
};

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
      customThreshold: null,
    };

    // Settings management
    const updateSettings = (settings: ISettingRegistry.ISettings): void => {
      notifySettings = { ...notifySettings, ...settings.composite };
    };

    if (settingRegistry) {
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
        Notification.requestPermission().catch(err => {
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
      if (
        mode === 'custom-timeout' &&
        (!(typeof notifySettings.customThreshold === 'number') ||
          !Number.isFinite(notifySettings.customThreshold))
      ) {
        JupyterNotification.emit(
          `Invalid custom threshold value: Expected a finite number, but received ${notifySettings.customThreshold}`,
          'error',
          {
            autoClose: 3000,
          },
        );
        return;
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
            ? notifySettings.customThreshold
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

    app.commands.addCommand(CommandIDs.setNotificationMode, {
      label: args => MODES[args.modeId as ModeId].label,
      icon: args => MODES[args.modeId as ModeId].icon,
      execute: args => {
        const modeId = args.modeId as string;
        const current = tracker.currentWidget;
        if (!current) {
          console.warn('No notebook selected');
          return;
        }
        const cell = current.content.activeCell;
        if (cell) {
          cell.model.setMetadata(CELL_METADATA_KEY, { mode: modeId });
        }
      },
      isEnabled: () =>
        !!tracker.currentWidget && !!tracker.currentWidget.content.activeCell,
    });

    // Menu for Notification modes
    const notifyMenu = new Menu({ commands: app.commands });
    notifyMenu.title.label = trans.__('Cell Notification');

    Object.entries(MODES).forEach(([modeId, mode]) => {
      notifyMenu.addItem({
        command: CommandIDs.setNotificationMode,
        args: { modeId },
      });
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
          tooltip: trans.__('Change Cell Notification Settings'),
          icon: MODES[modeId].icon, // Set initial icon based on current metadata
          onClick: () => {
            // Not working!
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
