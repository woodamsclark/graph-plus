import type { Disposable } from '../graph-engine/contracts/v1/index.ts';

export function mountGraphPlusCheckpointRecoverySurfaceV1(container: HTMLElement, options: {
  readonly message: string;
  readonly onRetry: () => Promise<void>;
  readonly onRestorePrevious?: () => Promise<void>;
  readonly onReset: () => Promise<void>;
  readonly onError: (error: unknown) => void;
}): Disposable {
  const document = container.ownerDocument;
  const surface = document.createElement('div');
  surface.className = 'graphplus-recovery';
  surface.setAttribute('role', 'alert');
  const heading = document.createElement('h3');
  heading.textContent = 'Saved graph layout could not be recovered';
  const message = document.createElement('p');
  message.textContent = options.message;
  const actions = document.createElement('div');
  actions.className = 'modal-button-container';
  surface.append(heading, message, actions);
  const buttons: HTMLButtonElement[] = [];
  let busy = false;
  const addAction = (text: string, operation: () => Promise<void>) => {
    const button = document.createElement('button');
    button.textContent = text;
    buttons.push(button);
    actions.appendChild(button);
    button.addEventListener('click', () => {
      if (busy) return;
      busy = true;
      buttons.forEach(action => { action.disabled = true; });
      void Promise.resolve().then(operation).catch(options.onError).finally(() => {
        busy = false;
        buttons.forEach(action => { action.disabled = false; });
      });
    });
  };
  addAction('Retry', options.onRetry);
  if (options.onRestorePrevious) addAction('Restore previous layout', options.onRestorePrevious);
  addAction('Reset saved layout…', options.onReset);
  container.appendChild(surface);
  return { dispose: () => surface.remove() };
}
