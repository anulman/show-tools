export function dismissOnBackdrop(dialog: HTMLDialogElement, dismiss: () => void) {
  let startedOutside = false;
  function outside(event: MouseEvent) {
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom);
  }
  dialog.addEventListener('pointerdown', event => { startedOutside = outside(event); });
  dialog.addEventListener('click', event => {
    const shouldDismiss = startedOutside && outside(event);
    startedOutside = false;
    if (shouldDismiss) dismiss();
  });
}
