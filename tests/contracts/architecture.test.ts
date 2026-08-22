import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deepEqual, test } from '../support/harness.ts';

test('V1 contracts have no Obsidian or implementation imports', () => {
  const root = join(process.cwd(), 'src', 'graph-engine', 'contracts', 'v1');
  const violations: string[] = [];
  for (const path of walk(root)) {
    const source = readFileSync(path, 'utf8');
    if (/from\s+['"]obsidian['"]/.test(source)) violations.push(`${path}: obsidian import`);
    if (/from\s+['"][^'"]*(?:runtime|modules|host|graph-plus)[^'"]*['"]/.test(source)) {
      violations.push(`${path}: implementation import`);
    }
  }
  deepEqual(violations, [], 'contract boundary should remain host-neutral');
});

test('graph engine core has no Obsidian imports', () => {
  const root = join(process.cwd(), 'src', 'graph-engine', 'core');
  const violations = walk(root).filter((path) => /from\s+['"]obsidian['"]/.test(readFileSync(path, 'utf8')));
  deepEqual(violations, [], 'pure core should remain independent of Obsidian');
});

function walk(directory: string): string[] {
  const result: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) result.push(...walk(path));
    else if (path.endsWith('.ts')) result.push(path);
  }
  return result;
}
