import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { MimeModel } from '@jupyterlab/rendermime';
import type { INotificationData, NotifyType } from './index';

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
      // If somehow notebookId is missing. Though this won't happen in current implementation.
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
      await this.showBatch(type, state.buffer);
    }

    state.buffer = [];
  }

  private async showSingle(data: INotificationData) {
    try {
      const mimeModel = new MimeModel({
        data: { [MIME_TYPE]: JSON.parse(JSON.stringify(data)) },
      });
      const renderer = this.rendermime.createRenderer(MIME_TYPE);
      await renderer.renderModel(mimeModel);
    } catch (err) {
      console.error('Error rendering single notification:', err);
    }
  }

  private async showBatch(type: NotifyType, batch: INotificationData[]) {
    const count = batch.length;

    const cellIds = batch
      .map(n => {
        const match = n.payload.body.match(/Cell id:\s*(.*)/);
        return match ? match[1] : '';
      })
      .filter(id => id);

    // Contains notebookId and cellId of first notification. Notification are batched per notebook
    // So, clicking on this batched notification will take user to first cell that raised notification
    const summary: INotificationData = {
      ...batch[0],
      payload: {
        ...batch[0].payload,
        title: `${count} ${batch[0].payload.title.replace('Cell', 'cells')}`,
        body: cellIds.map(id => `Cell id: ${id}`).join('\n'),
      },
    };

    try {
      const mimeModel = new MimeModel({
        data: { [MIME_TYPE]: JSON.parse(JSON.stringify(summary)) },
      });
      const renderer = this.rendermime.createRenderer(MIME_TYPE);
      await renderer.renderModel(mimeModel);
    } catch (err) {
      console.error('Error rendering batched notification:', err);
    }
  }
}
