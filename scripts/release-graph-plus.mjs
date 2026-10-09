import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RELEASE_ASSETS = ['main.js', 'manifest.json', 'styles.css'];

export function validateReleaseMetadata({ manifest, packageJson, lock, versions }, publicRelease = false) {
  const version = manifest.version;
  if (!/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(version)) throw new Error('Invalid release version.');
  if (publicRelease && !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Community releases require a stable x.y.z version; finish RC validation before promoting it.');
  }
  if (manifest.id !== 'graph-plus' || packageJson.name !== 'graph-plus'
    || packageJson.version !== version || lock.version !== version
    || lock.packages?.['']?.version !== version
    || versions[version] !== manifest.minAppVersion) {
    throw new Error('Release metadata disagree: synchronize manifest, package, lockfile, and versions.json.');
  }
  return version;
}

export async function stageRelease(repositoryRoot, outputDirectory) {
  // Always construct a clean allowlisted artifact. Never archive the live checkout.
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  for (const asset of RELEASE_ASSETS) await copyFile(join(repositoryRoot, asset), join(outputDirectory, asset));
  const files = (await readdir(outputDirectory)).sort();
  if (JSON.stringify(files) !== JSON.stringify([...RELEASE_ASSETS].sort())) throw new Error('Unexpected release assets.');
}

async function main() {
  const repositoryRoot = process.cwd();
  const [manifest, packageJson, lock, versions] = await Promise.all(
    ['manifest.json', 'package.json', 'package-lock.json', 'versions.json'].map(async file =>
      JSON.parse(await readFile(join(repositoryRoot, file), 'utf8'))),
  );
  const version = validateReleaseMetadata({ manifest, packageJson, lock, versions }, process.argv.includes('--public'));
  for (const task of ['typecheck', 'test', 'build']) execFileSync('npm', ['run', task], { cwd: repositoryRoot, stdio: 'inherit' });
  const outputDirectory = join(repositoryRoot, 'releases', version);
  await stageRelease(repositoryRoot, outputDirectory);
  console.log(`Validated ${version}: ${outputDirectory}\nUpload main.js, manifest.json, and styles.css individually to the matching GitHub release.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
