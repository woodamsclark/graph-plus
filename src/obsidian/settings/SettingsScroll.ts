export function preserveSettingsScrollV1(root: HTMLElement, render: () => void): void {
  const positions: Array<{ readonly element: HTMLElement; readonly top: number; readonly left: number }> = [];
  let element: HTMLElement | null = root;
  while (element && element !== root.ownerDocument.body) {
    if (element === root || element.scrollTop !== 0 || element.scrollLeft !== 0) {
      positions.push({ element, top: element.scrollTop, left: element.scrollLeft });
    }
    element = element.parentElement;
  }
  render();
  for (const position of positions) {
    position.element.scrollTop = position.top;
    position.element.scrollLeft = position.left;
  }
}
