import { IRenderMime } from '@jupyterlab/rendermime-interfaces';

import { JSONObject } from '@lumino/coreutils';

import { Widget } from '@lumino/widgets';

/**
 * The default mime type for the extension.
 */
const MIME_TYPE = 'application/desktop-notify+json';
const PROCESSED_KEY = 'isProcessed';
// The below can be used to customize notifications
const NOTIFICATION_OPTIONS = {
  icon: '/static/favicons/favicon.ico'
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
  constructor(options: IRenderMime.IRendererOptions) {
    super();
    this._mimeType = options.mimeType;
  }

  renderModel(model: IRenderMime.IMimeModel): Promise<void> {
    const mimeData = (model.data[this._mimeType] as unknown) as INotifyMimeData;

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
          `Encountered error - ${err} while requesting permissions for notebook notifications`
        );
      });
    }

    if (mimeData.type === 'NOTIFY') {
      // Notify only if there's sufficient permissions and this has not been processed previously
      if (Notification.permission === 'granted' && !mimeData[PROCESSED_KEY]) {
        new Notification(payload.title as string, NOTIFICATION_OPTIONS);
      } else {
        this.node.innerHTML = `<div id="${mimeData.id}">Missing permissions - update "Notifications" preferences under browser settings to receive notifications</div>`;
      }
    }

    if (!mimeData[PROCESSED_KEY]) {
      // Add isProcessed property to each notification message so that we can avoid repeating notifications on page reloads
      const updatedModel: IRenderMime.IMimeModel = JSON.parse(
        JSON.stringify(model)
      );
      const updatedMimeData = (updatedModel.data[
        this._mimeType
      ] as unknown) as INotifyMimeData;
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

  private _mimeType: string;
}

/**
 * A mime renderer factory for desktop-notify data.
 */
const rendererFactory: IRenderMime.IRendererFactory = {
  safe: true,
  mimeTypes: [MIME_TYPE],
  createRenderer: options => new OutputWidget(options)
};

/**
 * Extension definition.
 */
const extension: IRenderMime.IExtension = {
  id: 'desktop-notify:plugin',
  rendererFactory,
  rank: 0,
  dataType: 'json'
};

console.log('jupyterlab-notify render activated');

export default extension;
