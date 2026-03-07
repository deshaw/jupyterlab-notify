import { MenuSvg, checkIcon } from '@jupyterlab/ui-components';
import { Message } from '@lumino/messaging';

/**
 * A MenuSvg subclass that supports setting tooltips on menu items
 * via a `tooltip` property in item args.
 */
export class TooltipMenuSvg extends MenuSvg {
  protected onUpdateRequest(msg: Message): void {
    super.onUpdateRequest(msg);
    this._applyItemAttributes();
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this._applyItemAttributes();
  }

  private _applyItemAttributes(): void {
    const items = this.items;

    this.node
      .querySelectorAll('ul.lm-Menu-content > li.lm-Menu-item')
      .forEach((li, index) => {
        const item = items[index];
        if (!item) {
          return;
        }

        const args = item.args as Record<string, unknown> | undefined;
        const tooltip = args?.tooltip as string | undefined;
        if (tooltip) {
          li.setAttribute('title', tooltip);
        }

        const checked = args?.checked as boolean | undefined;
        const iconNode = li.querySelector('.lm-Menu-itemShortcut');
        if (iconNode) {
          if (checked) {
            iconNode.innerHTML = checkIcon.svgstr;
            (iconNode.childNodes[0] as Element).classList.add(
              'jp-notify-check-icon',
            );
          } else {
            iconNode.innerHTML = '';
          }
        }
      });
  }
}
