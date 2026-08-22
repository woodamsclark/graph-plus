import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deepEqual, test } from '../support/harness.ts';

test('V1 contracts have no Obsidian or implementation imports', () => {
  const root = join(process.cwd(), 'src', 'graph-engine', 'contracts', 'v1');
  const violations: string[] = [];
  for (const path of walk(root)) {
    const source = readFileSync(path, 'utf8');
    if (/from\s+['"][^'"]*obsidian[^'"]*['"]/.test(source)) violations.push(`${path}: Obsidian host import`);
    if (/from\s+['"][^'"]*(?:runtime|modules|host|graph-plus)[^'"]*['"]/.test(source)) {
      violations.push(`${path}: implementation import`);
    }
  }
  deepEqual(violations, [], 'contract boundary should remain host-neutral');
});

test('graph engine core and neutral runtime have no host or legacy imports', () => {
  const roots = ['core', 'runtime'].map((directory) => join(process.cwd(), 'src', 'graph-engine', directory));
  const violations: string[] = [];
  for (const path of roots.flatMap(walk)) {
    const source = readFileSync(path, 'utf8');
    if (/from\s+['"]obsidian['"]/.test(source)) violations.push(`${path}: obsidian import`);
    if (/from\s+['"][^'"]*graph\+[^'"]*['"]/.test(source)) violations.push(`${path}: legacy Graph+ import`);
  }
  deepEqual(violations, [], 'core and neutral runtime should remain independent of Obsidian and legacy Graph+');
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
