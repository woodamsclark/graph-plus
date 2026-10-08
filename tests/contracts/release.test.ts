import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assert, deepEqual, equal, test } from '../support/harness.ts';

const releaseModule = () => import(pathToFileURL(join(process.cwd(), 'scripts/release-graph-plus.mjs')).href);

test('release staging copies only plugin assets even from a live checkout with private data', async () => {
  const release = await releaseModule();
  const root = await mkdtemp(join(tmpdir(), 'graph-plus-release-contract-'));
  try {
    const source = join(root, 'source');
    const output = join(root, 'output');
    await mkdir(source); await mkdir(output);
    for (const file of release.RELEASE_ASSETS) await writeFile(join(source, file), `asset ${file}`);
    await writeFile(join(source, 'data.json'), 'private settings');
    for (const directory of ['graph-plus-checkpoints', '.git', 'node_modules']) {
      await mkdir(join(source, directory)); await writeFile(join(source, directory, 'secret.json'), 'private graph');
    }
    await writeFile(join(output, 'leftover-private-data.json'), 'stale previous package');
    await release.stageRelease(source, output);
    deepEqual((await readdir(output)).sort(), [...release.RELEASE_ASSETS].sort(), 'staging is an exact allowlist');
    equal(await readFile(join(output, 'main.js'), 'utf8'), 'asset main.js', 'runtime asset is preserved');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('release metadata validates RC consistency and blocks accidental community publication of an RC', async () => {
  const release = await releaseModule();
  const [manifest, packageJson, lock, versions] = await Promise.all(
    ['manifest.json', 'package.json', 'package-lock.json', 'versions.json'].map(async file =>
      JSON.parse(await readFile(join(process.cwd(), file), 'utf8'))),
  );
  const metadata = { manifest, packageJson, lock, versions };
  equal(release.validateReleaseMetadata(metadata), manifest.version, 'current metadata agree');
  const stableVersion = '2.0.0';
  const stable = {
    manifest: { ...manifest, version: stableVersion }, packageJson: { ...packageJson, version: stableVersion },
    lock: { ...lock, version: stableVersion, packages: { ...lock.packages, '': { ...lock.packages[''], version: stableVersion } } },
    versions: { ...versions, [stableVersion]: manifest.minAppVersion },
  };
  equal(release.validateReleaseMetadata(stable, true), stableVersion, 'a coherent stable release is accepted');
  for (const [value, publicRelease] of [
    [{ ...metadata, manifest: { ...manifest, version: '2.0.0-rc.1' } }, true],
    [{ ...stable, lock: { ...stable.lock, version: '1.0.0' } }, false],
    [{ ...stable, versions: { [stableVersion]: '0.0.0' } }, false],
  ] as const) {
    let rejected = false;
    try { release.validateReleaseMetadata(value, publicRelease); } catch { rejected = true; }
    assert(rejected, 'invalid metadata or public RC must fail before packaging');
  }
});
