export class BufferedQueue<T> {
  private values: T[] = [];

  push(value: T): void {
    this.values.push(value);
  }

  drain(): T[] {
    const batch = this.values;
    this.values = [];
    return batch;
  }

  clear(): void {
    this.values = [];
  }
}
