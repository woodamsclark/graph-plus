export interface SessionActivitySnapshotV1 {
  readonly manuallySuspended: boolean;
  readonly documentSuspended: boolean;
  readonly disposed: boolean;
  readonly suspended: boolean;
}

/** Single source of truth for whether a session is permitted to perform runtime work. */
export class SessionActivityControllerV1 {
  private manuallySuspended = false;
  private documentSuspended = false;
  private disposed = false;

  setManualSuspension(suspended: boolean): boolean {
    if (this.manuallySuspended === suspended) return false;
    this.manuallySuspended = suspended;
    return true;
  }

  setDocumentSuspension(suspended: boolean): boolean {
    if (this.documentSuspended === suspended) return false;
    this.documentSuspended = suspended;
    return true;
  }

  dispose(): boolean {
    if (this.disposed) return false;
    this.disposed = true;
    return true;
  }

  isDisposed(): boolean { return this.disposed; }

  isSuspended(hasFatalError = false): boolean {
    return this.disposed || this.manuallySuspended || this.documentSuspended || hasFatalError;
  }

  snapshot(hasFatalError = false): SessionActivitySnapshotV1 {
    return {
      manuallySuspended: this.manuallySuspended,
      documentSuspended: this.documentSuspended,
      disposed: this.disposed,
      suspended: this.isSuspended(hasFatalError),
    };
  }
}
