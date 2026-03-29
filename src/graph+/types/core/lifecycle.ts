export interface Initializable {
  initialize?(): void | Promise<void>;
}

export interface Openable {
  open?(): void | Promise<void>;
}

export interface Closable {
  close?(): void | Promise<void>;
}

export interface Destroyable {
  destroy?(): void | Promise<void>;
}

export interface Tickable {
  tick(dt: number): void;
}

export interface Rebuildable {
  rebuild?(): void | Promise<void>;
}

/**
 * Minimal runtime lifecycle.
 * Keep this small and composable.
 */
export interface ModuleLifecycle extends Initializable, Openable, Closable, Destroyable {}