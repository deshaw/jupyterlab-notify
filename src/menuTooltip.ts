import { MenuSvg } from '@jupyterlab/ui-components';
import { Message } from '@lumino/messaging';

/**
 * A MenuSvg subclass that supports setting tooltips on menu items
 * via a `tooltip` property in item args.
 */
export class TooltipMenuSvg extends MenuSvg {
  protected onUpdateRequest(msg: Message): void {
    super.onUpdateRequest(msg);
    this._applyTooltips();
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this._applyTooltips();
  }

  private _applyTooltips(): void {
    const items = this.items;

    this.node
      .querySelectorAll('ul.lm-Menu-content > li.lm-Menu-item')
      .forEach((li, index) => {
        const item = items[index];
        if (!item) {
          return;
        }

        const tooltip = (item.args as any)?.tooltip as string | undefined;
        if (tooltip) {
          li.setAttribute('title', tooltip);
        }
      });
  }
}
