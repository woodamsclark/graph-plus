import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { deepEqual, equal, test } from '../support/harness.ts';

interface ArtifactManifest {
  artifact: string;
  artifactVersion: string;
  protocolVersion: number;
  contentSha256: string;
  publicFiles: string[];
}

const repositoryRoot = process.cwd();
const artifactRoot = join(repositoryRoot, 'packages', 'graph-engine-client');

test('external client artifact is synchronized with its reviewed public sources', () => {
  const manifest = JSON.parse(
    readFileSync(join(artifactRoot, 'artifact-manifest.json'), 'utf8'),
  ) as ArtifactManifest;
  equal(manifest.artifact, '@graph-plus/graph-engine-client', 'artifact name');
  equal(manifest.artifactVersion, '2.0.1', 'artifact version');
  equal(manifest.protocolVersion, 1, 'artifact protocol');

  const drift: string[] = [];
  const contentHash = createHash('sha256');
  for (const sourcePath of manifest.publicFiles) {
    contentHash.update(sourcePath);
    contentHash.update('\0');
    contentHash.update(readFileSync(join(repositoryRoot, sourcePath)));
    contentHash.update('\0');
    const artifactPath = join(artifactRoot, 'src', relative('src', sourcePath));
    if (!existsSync(artifactPath)) {
      drift.push(`${sourcePath}: missing from artifact`);
      continue;
    }
    if (readFileSync(join(repositoryRoot, sourcePath), 'utf8') !== readFileSync(artifactPath, 'utf8')) {
      drift.push(`${sourcePath}: artifact differs from source`);
    }
  }
  deepEqual(drift, [], 'generated client files should be current');
  equal(contentHash.digest('hex'), manifest.contentSha256, 'artifact content hash');
});

test('Graph+ registers its internal graph-engine provider and aligns provider and client release versions', () => {
  const pluginManifest = JSON.parse(readFileSync(join(repositoryRoot, 'manifest.json'), 'utf8')) as {
    id: string; name: string; version: string;
  };
  const rootPackage = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as {
    name: string; version: string;
  };
  const clientPackage = JSON.parse(readFileSync(join(artifactRoot, 'package.json'), 'utf8')) as {
    version: string;
  };
  equal(pluginManifest.id, 'graph-plus', 'Obsidian plugin ID');
  equal(pluginManifest.name, 'Graph+', 'Obsidian plugin name');
  equal(rootPackage.name, 'graph-plus', 'root package name');
  equal(pluginManifest.version, '2.0.1', 'Obsidian stable release version');
  equal((pluginManifest as { minAppVersion?: string }).minAppVersion, '1.13.7', 'minimum compatible Obsidian version');
  equal(rootPackage.version, pluginManifest.version, 'root package release version');
  equal(clientPackage.version, pluginManifest.version, 'public client release version matches the plugin release');
});

test('external client includes the source license and declares MPL-2.0', () => {
  const manifest = JSON.parse(readFileSync(join(artifactRoot, 'package.json'), 'utf8'));
  equal(manifest.license, 'MPL-2.0', 'client source license');
  equal(manifest.files.includes('LICENSE'), true, 'packed client includes license');
  equal(readFileSync(join(artifactRoot, 'LICENSE'), 'utf8'), readFileSync(join(repositoryRoot, 'LICENSE'), 'utf8'),
    'client license must match source license');
});

test('external client artifact resolves internally and excludes provider implementation', () => {
  const sourceRoot = join(artifactRoot, 'src');
  const violations: string[] = [];
  for (const path of walk(sourceRoot)) {
    const source = readFileSync(path, 'utf8');
    if (/from\s+['"](?:obsidian|electron)['"]/.test(source)) {
      violations.push(`${relative(artifactRoot, path)}: host import`);
    }
    if (/graph-engine\/(?:runtime|modules|obsidian|graph-plus)/.test(source)) {
      violations.push(`${relative(artifactRoot, path)}: provider implementation reference`);
    }
    for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const resolved = resolve(dirname(path), match[1]);
      if (!existsSync(resolved)) {
        violations.push(`${relative(artifactRoot, path)}: unresolved import ${match[1]}`);
      }
    }
  }
  deepEqual(violations, [], 'client artifact should be portable and provider-free');
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
