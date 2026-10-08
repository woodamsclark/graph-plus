interface GraphPlusShutdownStepsV1 {
  readonly stopActivity: () => void;
  readonly closePresentations: () => Promise<void>;
  readonly drainPersistence: () => Promise<void>;
  readonly releaseLease: () => Promise<void>;
  readonly stopProvider: () => Promise<void>;
  readonly clearReferences: () => void;
}

// The Obsidian hook is synchronous. Keep its completion barrier across bundle
// reloads so a new plugin instance cannot read/write while the old one is saving.
const barrierKey = Symbol.for('graph-plus.shutdown-barriers.v1');
const scope = globalThis as typeof globalThis & { [barrierKey]?: Map<string, Promise<void>> };
const barriers = scope[barrierKey] ??= new Map<string, Promise<void>>();

export async function waitForGraphPlusShutdownV1(key: string): Promise<void> {
  await barriers.get(key)?.catch(() => undefined);
}

export function startGraphPlusShutdownV1(key: string, steps: GraphPlusShutdownStepsV1): Promise<void> {
  const existing = barriers.get(key);
  if (existing) return existing;
  const completion = runShutdown(steps);
  barriers.set(key, completion);
  const finish = () => { if (barriers.get(key) === completion) barriers.delete(key); };
  void completion.then(finish, finish);
  return completion;
}

async function runShutdown(steps: GraphPlusShutdownStepsV1): Promise<void> {
  const errors: unknown[] = [];
  try { steps.stopActivity(); } catch (error) { errors.push(error); }
  for (const step of [steps.closePresentations, steps.drainPersistence, steps.releaseLease, steps.stopProvider]) {
    try { await step(); } catch (error) { errors.push(error); }
  }
  try { steps.clearReferences(); } catch (error) { errors.push(error); }
  if (errors.length) throw new Error(`Graph+ shutdown failed: ${errors.map(error => error instanceof Error ? error.message : String(error)).join('; ')}`);
}
