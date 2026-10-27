export function keyboardFocusBlocksShortcut(code: string, editing: boolean, interactive: boolean): boolean {
  return editing || code === 'Space' && interactive;
}
