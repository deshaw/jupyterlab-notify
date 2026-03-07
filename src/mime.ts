import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { IRenderMime } from '@jupyterlab/rendermime-interfaces';
import { ILabShell } from '@jupyterlab/application';
import { JSONObject } from '@lumino/coreutils';
import type { Cell, ICellModel } from '@jupyterlab/cells';

import { Widget } from '@lumino/widgets';

/**
 * The default mime type for the extension.
 */
const MIME_TYPE = 'application/desktop-notify+json';
const PROCESSED_KEY = 'isProcessed';
// The below can be used to customize notifications
const NOTIFICATION_OPTIONS = {
  icon: '/static/favicons/favicon.ico',
};

interface INotifyMimeData {
  type: 'INIT' | 'NOTIFY';
  payload: Record<string, unknown>;
  isProcessed: boolean;
  id: string;
}

/**
 * A widget for rendering desktop-notify.
 */
class OutputWidget extends Widget implements IRenderMime.IRenderer {
  constructor(
    options: IRenderMime.IRendererOptions,
    notebookTracker: INotebookTracker,
    shell: ILabShell,
  ) {
    super();
    this._mimeType = options.mimeType;
    this._notebookTracker = notebookTracker;
    this._shell = shell;
  }

  renderModel(model: IRenderMime.IMimeModel): Promise<void> {
    const mimeData = model.data[this._mimeType] as unknown as INotifyMimeData;

    const payload = mimeData.payload as JSONObject;

    // If the PROCESSED_KEY is available - do not take any action
    // This is done so that notifications are not repeated on page refresh
    if (mimeData[PROCESSED_KEY]) {
      return Promise.resolve();
    }

    // For first-time users, check for necessary permissions and prompt if needed
    if (
      (mimeData.type === 'INIT' && Notification.permission === 'default') ||
      Notification.permission !== 'granted'
    ) {
      // We do not have any actions to perform upon acquiring permission and so
      // handle only the errors (if any)
      Notification.requestPermission().catch(err => {
        alert(
          `Encountered error - ${err} while requesting permissions for notebook notifications`,
        );
      });
    }

    if (mimeData.type === 'NOTIFY') {
      // Notify only if there's sufficient permissions and this has not been processed previously
      if (Notification.permission === 'granted' && !mimeData[PROCESSED_KEY]) {
        const body =
          typeof payload.body === 'string' ? (payload.body as string) : '';
        const options = body
          ? { ...NOTIFICATION_OPTIONS, body }
          : NOTIFICATION_OPTIONS;
        const notification = new Notification(payload.title as string, options);
        // Set up click handler
        notification.onclick = event => {
          event.preventDefault();

          window.focus();

          // Navigate to the cell
          this.navigateToCell(
            payload.cellId as string,
            payload.notebookId as string,
          );

          notification.close();
        };
      } else {
        this.node.innerHTML = `<div id="${mimeData.id}">Missing permissions - update "Notifications" preferences under browser settings to receive notifications</div>`;
      }
    }

    if (!mimeData[PROCESSED_KEY]) {
      // Add isProcessed property to each notification message so that we can avoid repeating notifications on page reloads
      const updatedModel = JSON.parse(JSON.stringify(model));
      // The model sent by IPython magic via display contains a 'data' property,
      // whereas the model sent by the frontend via MimeModel (after JSON serialization)
      // contains only the private property '_data'.
      const dataKey = 'data' in updatedModel ? 'data' : '_data';
      const updatedMimeData = updatedModel[dataKey][
        this._mimeType
      ] as unknown as INotifyMimeData;
      updatedMimeData[PROCESSED_KEY] = true;
      // The below model update is done inside a separate function and added to
      // the event queue - this is done so to avoid re-rendering before the
      // initial render is complete.
      //
      // Without the setTimeout, calling model.setData triggers the callbacks
      // registered on model-updates that re-renders the widget and it again tries
      // to update the model which again causes a re-render and so on.
      setTimeout(() => {
        model.setData(updatedModel);
      }, 0);
    }

    return Promise.resolve();
  }
  private async navigateToCell(
    cellId: string,
    notebookId: string,
  ): Promise<void> {
    try {
      const targetNotebook = this.findNotebookById(notebookId);
      if (!targetNotebook) {
        return;
      }
      targetNotebook.activate();
      this._shell.activateById(targetNotebook.id);
      // Ensure notebook is fully activated
      await new Promise(resolve => setTimeout(resolve, 100));
      this.navigateToCellInNotebook(targetNotebook, cellId);
    } catch (error) {
      // Silently ignore errors
    }
  }

  private findNotebookById(notebookId: string): null | NotebookPanel {
    // Search through all open notebooks
    let found = null;
    this._notebookTracker.forEach(widget => {
      if (widget.content.id === notebookId) {
        found = widget;
      }
    });
    return found;
  }

  private navigateToCellInNotebook(
    notebook: NotebookPanel,
    cellId: string,
  ): boolean {
    const cells = notebook.content.widgets;
    const cellIndex = cells.findIndex(
      (cell: Cell<ICellModel>) => cell.model.id === cellId,
    );

    if (cellIndex >= 0) {
      notebook.content.activeCellIndex = cellIndex;

      const targetCell = cells[cellIndex];

      notebook.content.scrollToCell(targetCell);
      this.highlightCell(targetCell);

      return true;
    }

    return false;
  }

  private highlightCell(cell: Cell<ICellModel>): void {
    const cellNode = cell.node;

    // Add highlight with animation using CSS class
    cellNode.classList.add('jp-notify-highlight');
    cellNode.style.transition = 'background-color 0.5s ease';

    setTimeout(() => {
      cellNode.classList.remove('jp-notify-highlight');
      setTimeout(() => {
        cellNode.style.transition = '';
      }, 300);
    }, 1000);
  }

  private _mimeType: string;
  private _notebookTracker: INotebookTracker;
  private _shell: ILabShell;
}

/**
 * Function for creating a mime renderer factory for desktop-notify data.
 */
export function createRendererFactory(
  notebookTracker: INotebookTracker,
  shell: ILabShell,
): IRenderMime.IRendererFactory {
  return {
    safe: true,
    mimeTypes: [MIME_TYPE],
    createRenderer: options => {
      const widget = new OutputWidget(options, notebookTracker, shell);
      return widget;
    },
  };
}
