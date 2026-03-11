import { KernelError } from '@jupyterlab/notebook';
import { LabIcon } from '@jupyterlab/ui-components';

/**
 * Execution timing metadata from cell execution
 */
export interface IExecutionTimingMetadata {
  'iopub.execute_input': string;
  'shell.execute_reply.started': string;
  'shell.execute_reply': string;
  execution_failed: string;
}

/**
 * Represents a notification mode with label and icon
 */
export interface IMode {
  label: string;
  icon: LabIcon;
}

/**
 * Settings for the notify extension
 */
export interface INotifySettings {
  defaultMode: ModeId;
  failureMessage: string;
  mail: boolean;
  slack: boolean;
  successMessage: string;
  defaultThreshold: number | null;
  customTimeout: number | null;
}

/**
 * Metadata associated with a cell
 */
export interface INotifyMetadata {
  mode: ModeId;
  defaultThreshold?: string;
  customTimeout?: string;
}

/**
 * Initial response from the server about configured services
 */
export interface IInitialResponse {
  nbmodel_installed: boolean;
  email_configured: boolean;
  slack_configured: boolean;
  smtp_server_running: boolean;
}

/**
 * Payload sent to the server for notification processing
 */
export interface INotifyPayload {
  cell_id: string;
  mode: ModeId;
  emailEnabled: boolean;
  slackEnabled: boolean;
  successMessage: string;
  failureMessage: string;
  threshold: number | null;
  notebook_name: string;
  notebookId: string;
  execution_count: number | null;
}

/**
 * Tracks notification state for a cell
 */
export interface ICellNotification {
  payload: INotifyPayload;
  timeoutId: number | null;
  notificationIssued: boolean;
  notebookId: string;
}

/**
 * Data structure for notification display
 */
export interface INotificationData {
  type: string;
  payload: {
    title: string;
    body: string;
    cellId: string;
    notebookName: string;
    executionCount?: number;
    notebookId: string;
    kernelError?: KernelError;
  };
  isProcessed: boolean;
  id: string;
}

/**
 * Notification mode identifiers
 */
export const ModeIds = [
  'default',
  'never',
  'on-error',
  'custom-timeout',
] as const;
export type ModeId = (typeof ModeIds)[number];

/**
 * Type of notification
 */
export type NotifyType = 'completed' | 'failed' | 'timeout';

/**
 * Timeout options for the submenu
 */
export const TIMEOUT_OPTIONS = [
  { label: 'default', value: 'default' },
  { label: '1 min', value: '1m' },
  { label: '30 min', value: '30m' },
  { label: 'Custom', value: 'custom' },
];

/**
 * Metadata keys used in notebook and cell metadata
 */
export const NOTIFY_METADATA_KEY = 'jupyterlab_notify.notify';
export const NOTEBOOK_DEFAULT_THRESHOLD_KEY = 'defaultThreshold';
export const NOTEBOOK_CUSTOM_TIMEOUT_KEY = 'customTimeout';
export const CELL_DEFAULT_THRESHOLD_KEY = 'defaultThreshold';
export const CELL_CUSTOM_TIMEOUT_KEY = 'customTimeout';
export const NB_TOOLBAR_NOTIFICATION_CLASS = 'jp-Toolbar-notification-mode';

/**
 * Regular expression for validating timeout input (e.g., '2s', '5m', '1.5h')
 */
export const TIMEOUT_PATTERN = /^(\d+(\.\d+)?)([smh])$/;

/**
 * Notebook file extension
 */
export const NOTEBOOK_FILE_EXTENSION = '.ipynb';
