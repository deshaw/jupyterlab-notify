import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { MimeModel } from '@jupyterlab/rendermime';
import type { INotificationData, NotifyType } from './index';

const MIME_TYPE = 'application/desktop-notify+json';

interface IBatchState {
  buffer: INotificationData[];
  timer: number | null;
}

export class BatchNotifier {
  private states: Record<NotifyType, IBatchState> = {
    completed: { buffer: [], timer: null },
    failed: { buffer: [], timer: null },
    timeout: { buffer: [], timer: null },
  };
  private readonly batchWindow = 3000; // ms

  constructor(private rendermime: IRenderMimeRegistry) {}

  notify(type: NotifyType, data: INotificationData) {
    const state = this.states[type];

    if (state.timer === null) {
      // first of its kind: show immediately
      this.showSingle(data);

      // start window to batch any immediate follow-ups of the same type
      state.timer = window.setTimeout(() => this.flush(type), this.batchWindow);
    } else {
      // within window: buffer it
      state.buffer.push(data);
    }
  }

  private async flush(type: NotifyType) {
    const state = this.states[type];
    state.timer = null;

    if (state.buffer.length === 0) {
      return;
    }

    if (state.buffer.length === 1) {
      await this.showSingle(state.buffer[0]);
    } else {
      // Show one summary of this kind
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
