const TAB_NAVIGATION_TARGETS = [
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="slider"]',
  '[role="combobox"]',
].join(',');

export function isQuickSettingsToggleKeyV1(event: KeyboardEvent): boolean {
  if (event.key !== 'Tab'
    || event.defaultPrevented
    || event.repeat
    || event.isComposing
    || event.ctrlKey
    || event.metaKey
    || event.altKey
    || event.shiftKey) return false;
  const target = event.target as { closest?: (selectors: string) => Element | null } | null;
  return target?.closest?.(TAB_NAVIGATION_TARGETS) === null || target?.closest === undefined;
}
