import { Menu, Widget } from '@lumino/widgets';

/**
 * Open `menu` below the right edge of `anchor` (a toolbar button), such that
 * pressing `anchor` again lets the button's click handler close the menu,
 * rather than Lumino closing it on press and the click immediately reopening
 * it (see #28).
 *
 * Lumino closes an open menu when the user presses anywhere outside of it,
 * and the toolbar button counts as outside. Up to `@lumino/widgets` 2.7
 * (JupyterLab < 4.6) this is done by a capture listener for `mousedown` on the
 * document; since jupyterlab/lumino#818 (`@lumino/widgets` 2.8, JupyterLab
 * 4.6) the listener is for `pointerdown`. We guard both events in the capture
 * phase on `window`, which runs before any listener on `document`, so this
 * does not depend on the Lumino version or on listener registration order.
 */
export function openMenuFromButton(menu: Menu, anchor: Widget): void {
  const guard = (event: Event) => {
    if (anchor.node.contains(event.target as Node)) {
      event.stopPropagation();
    }
  };
  const cleanup = () => {
    window.removeEventListener('pointerdown', guard, true);
    window.removeEventListener('mousedown', guard, true);
    menu.aboutToClose.disconnect(cleanup);
  };
  window.addEventListener('pointerdown', guard, true);
  window.addEventListener('mousedown', guard, true);
  menu.aboutToClose.connect(cleanup);

  const rect = anchor.node.getBoundingClientRect();
  menu.open(rect.right, rect.bottom, { horizontalAlignment: 'right' });
}
