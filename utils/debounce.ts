export function debounce<T extends (...args: any[]) => void>(fn: T, wait = 300, immediate = false): T {
  let timeout: number | null = null;
  // eslint-disable-next-line @typescript-eslint/ban-types
  return ((...args: any[]) => {
    const later = () => {
      timeout = null;
      if (!immediate) fn(...args);
    };
    const callNow = immediate && timeout === null;
    if (timeout) window.clearTimeout(timeout);
    timeout = window.setTimeout(later, wait) as unknown as number;
    if (callNow) fn(...args);
  }) as unknown as T;
}