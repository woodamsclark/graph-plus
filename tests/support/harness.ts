type TestBody = () => void | Promise<void>;

const tests: Array<{ name: string; run: TestBody }> = [];

export function test(name: string, run: TestBody): void {
  tests.push({ name, run });
}

export function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

export function deepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

export async function runTests(): Promise<void> {
  let failures = 0;
  for (const entry of tests) {
    try {
      await entry.run();
      console.log(`✓ ${entry.name}`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${entry.name}`);
      console.error(error);
    }
  }

  if (failures) {
    process.exitCode = 1;
  } else {
    console.log(`\n${tests.length} tests passed.`);
  }
}
