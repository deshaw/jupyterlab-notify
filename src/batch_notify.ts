import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { MimeModel } from '@jupyterlab/rendermime';
import type { INotificationData, NotifyType } from './token';

const MIME_TYPE = 'application/desktop-notify+json';

interface IBatchState {
  buffer: INotificationData[];
  timer: number | null;
}

export class BatchNotifier {
  // States are now per type and per notebookId
  private states: Record<NotifyType, Record<string, IBatchState>> = {
    completed: {},
    failed: {},
    timeout: {},
  };
  private readonly batchWindow = 3000; // ms

  constructor(private rendermime: IRenderMimeRegistry) {}

  notify(type: NotifyType, data: INotificationData) {
    const notebookId = data.payload.notebookId;
    if (!notebookId) {
      // If somehow notebookId is missing.
      return;
    }
    if (!this.states[type][notebookId]) {
      this.states[type][notebookId] = { buffer: [], timer: null };
    }
    const state = this.states[type][notebookId];

    if (state.timer === null) {
      // first of its kind: show immediately
      this.showSingle(data);

      // start window to batch any immediate follow-ups of the same type and notebook
      state.timer = window.setTimeout(
        () => this.flush(type, notebookId),
        this.batchWindow,
      );
    } else {
      // within window: buffer it
      state.buffer.push(data);
    }
  }

  private async flush(type: NotifyType, notebookId: string) {
    const state = this.states[type][notebookId];
    state.timer = null;

    if (state.buffer.length === 0) {
      return;
    }

    if (state.buffer.length === 1) {
      await this.showSingle(state.buffer[0]);
    } else {
      await this.showBatch(state.buffer);
    }

    state.buffer = [];
  }

  /**
   * Render a notification through the desktop-notify mime renderer.
   */
  private async render(data: INotificationData, description: string) {
    const renderer = this.rendermime.createRenderer(MIME_TYPE);
    try {
      const mimeModel = new MimeModel({
        data: { [MIME_TYPE]: JSON.parse(JSON.stringify(data)) },
      });
      await renderer.renderModel(mimeModel);
    } catch (err) {
      console.error(`Error rendering ${description} notification:`, err);
    }
    renderer.dispose();
  }

  private async showSingle(data: INotificationData) {
    await this.render(data, 'single');
  }

  private async showBatch(batch: INotificationData[]) {
    const firstTitle = batch[0].payload.title;
    const body = batch
      .map(notification => notification.payload.executionCount)
      .filter(
        (executionCount): executionCount is number =>
          typeof executionCount === 'number',
      )
      .map(executionCount => executionCount.toString())
      .join(', ');

    // Contains notebookId and cellId of first notification. Notification are batched per notebook
    // So, clicking on this batched notification will take user to first cell that raised notification
    const summary: INotificationData = {
      ...batch[0],
      payload: {
        ...batch[0].payload,
        title: firstTitle.replace(/Cell /, `${batch.length} cells `),
        body,
      },
    };

    await this.render(summary, 'batched');
  }
}
