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

test('Graph+ consumer imports only the public Graph Engine boundary', () => {
  const root = join(process.cwd(), 'src', 'graph-plus');
  const violations: string[] = [];
  for (const path of walk(root)) {
    const source = readFileSync(path, 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    for (const value of imports.filter((entry) => entry.includes('graph-engine'))) {
      if (!value.includes('/contracts/') && !value.endsWith('/public.ts')) {
        violations.push(`${path}: private Graph Engine import ${value}`);
      }
    }
  }
  deepEqual(violations, [], 'Graph+ should consume only contracts and the public client artifact');
});

test('global and Local Graph+ keep distinct active-note ownership', () => {
  const obsidianRoot = join(process.cwd(), 'src', 'obsidian');
  const globalView = readFileSync(join(obsidianRoot, 'GraphView.ts'), 'utf8');
  const localView = readFileSync(join(obsidianRoot, 'LocalGraphView.ts'), 'utf8');
  const globalConsumer = readFileSync(
    join(process.cwd(), 'src', 'graph-plus', 'consumer', 'GraphPlusConsumer.ts'),
    'utf8',
  );
  const localConsumer = readFileSync(
    join(process.cwd(), 'src', 'graph-plus', 'consumer', 'LocalGraphPlusConsumer.ts'),
    'utf8',
  );
  const violations: string[] = [];
  if (/requestActiveFileFollow|followActiveNode|workspace\.on\(['"]file-open['"]/.test(globalView)) {
    violations.push('global Graph+ automatically follows the active note');
  }
  if (/followActiveNode\s*\(/.test(globalConsumer)) {
    violations.push('global Graph+ consumer exposes automatic active-note following');
  }
  if (!/requestActiveFileFollow/.test(localView) || !/workspace\.on\(['"]file-open['"]/.test(localView)) {
    violations.push('Local Graph+ does not subscribe to active-note changes');
  }
  if (!/followActiveNode\s*\(/.test(localConsumer)) {
    violations.push('Local Graph+ consumer does not expose active-note following');
  }
  deepEqual(violations, [], 'only Local Graph+ should follow the active note automatically');
});

test('Animus emits graph facts while Anima alone resolves visual presentation', () => {
  const runtime = join(process.cwd(), 'src', 'graph-engine', 'runtime');
  const violations: string[] = [];
  for (const path of walk(join(runtime, 'animus'))) {
    const source = readFileSync(path, 'utf8');
    if (/from\s+['"][^'"]*(?:anima|render|theme)[^'"]*['"]/.test(source)) {
      violations.push(`${path}: Animus imported presentation code`);
    }
  }
  for (const name of ['FormModule.ts', 'NodeRegionsModule.ts']) {
    const path = join(runtime, 'modules', 'shipped', name);
    const source = readFileSync(path, 'utf8');
    if (/from\s+['"][^'"]*(?:render|theme)[^'"]*['"]/.test(source)) {
      violations.push(`${path}: semantic module imported visual types`);
    }
    if (/\b(?:color|opacity|stroke|fill|dashed|thicknessScale|radiusScale)\s*:/.test(source)) {
      violations.push(`${path}: semantic module emitted visual properties`);
    }
  }
  const rendererPath = join(runtime, 'render', 'CanvasGraphRenderer.ts');
  const renderer = readFileSync(rendererPath, 'utf8');
  if (/node\.(?:selected|focused|hovered)\b/.test(renderer)) {
    violations.push(`${rendererPath}: renderer interpreted semantic interaction state`);
  }
  if (/frame\.theme\b/.test(renderer)) {
    violations.push(`${rendererPath}: renderer interpreted semantic theme roles`);
  }
  deepEqual(violations, [], 'Animus, Anima, and renderer ownership must remain one-way');
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
