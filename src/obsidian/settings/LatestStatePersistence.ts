/** Serialize writes, replacing intermediate pending snapshots with the latest. */
export class LatestStatePersistenceV1<T> {
  private pending?: { value: T };
  private running?: Promise<void>;

  constructor(private readonly write: (value: T) => Promise<void>) {}

  save(value: T): Promise<void> {
    this.pending = { value };
    return this.drain();
  }

  drain(): Promise<void> {
    if (this.running) return this.running;
    if (!this.pending) return Promise.resolve();
    const completion = Promise.resolve().then(async () => {
      while (this.pending) {
        const snapshot = this.pending;
        this.pending = undefined;
        try { await this.write(snapshot.value); }
        catch (error) {
          // Retry the newest pending value on the next save or shutdown drain.
          this.pending ??= snapshot;
          throw error;
        }
      }
    });
    this.running = completion;
    const finish = () => { if (this.running === completion) this.running = undefined; };
    void completion.then(finish, finish);
    return completion;
  }
}
