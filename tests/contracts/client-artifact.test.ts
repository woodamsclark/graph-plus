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
  equal(manifest.artifactVersion, '1.7.1', 'artifact version');
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

test('V1.7.2 registers graph-engine and exposes independent provider and client versions', () => {
  const pluginManifest = JSON.parse(readFileSync(join(repositoryRoot, 'manifest.json'), 'utf8')) as {
    id: string; name: string; version: string;
  };
  const rootPackage = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as {
    name: string; version: string;
  };
  const clientPackage = JSON.parse(readFileSync(join(artifactRoot, 'package.json'), 'utf8')) as {
    version: string;
  };
  equal(pluginManifest.id, 'graph-engine', 'Obsidian plugin ID');
  equal(pluginManifest.name, 'graph-engine', 'Obsidian plugin name');
  equal(rootPackage.name, 'graph-engine', 'root package name');
  equal(pluginManifest.version, '1.7.2', 'Obsidian release version');
  equal((pluginManifest as { minAppVersion?: string }).minAppVersion, '1.7.2', 'minimum compatible Obsidian version');
  equal(rootPackage.version, pluginManifest.version, 'root package release version');
  equal(clientPackage.version, '1.7.1', 'public client release version is independently declared');
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
