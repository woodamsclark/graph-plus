import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = join(repositoryRoot, 'packages', 'graph-engine-client');
const artifactSourceRoot = join(artifactRoot, 'src', 'graph-engine');
const legacyArtifactSourceRoot = join(artifactRoot, 'graph-engine');

const publicFiles = [
  'src/graph-engine/public.ts',
  'src/graph-engine/contracts/v1/action.ts',
  'src/graph-engine/contracts/v1/document.ts',
  'src/graph-engine/contracts/v1/experience.ts',
  'src/graph-engine/contracts/v1/filter.ts',
  'src/graph-engine/contracts/v1/layout.ts',
  'src/graph-engine/contracts/v1/index.ts',
  'src/graph-engine/contracts/v1/patch.ts',
  'src/graph-engine/contracts/v1/profile.ts',
  'src/graph-engine/contracts/v1/reaction.ts',
  'src/graph-engine/contracts/v1/service.ts',
  'src/graph-engine/contracts/v1/session.ts',
  'src/graph-engine/contracts/v1/tag.ts',
  'src/graph-engine/contracts/v1/ui.ts',
  'src/graph-engine/contracts/v1/values.ts',
  'src/graph-engine/contracts/v1/view-state.ts',
  'src/graph-engine/contracts/v1/view.ts',
  'src/graph-engine/core/document/GraphTopologyIndex.ts',
  'src/graph-engine/core/filter/GraphFilterEvaluator.ts',
  'src/graph-engine/core/filter/index.ts',
  'src/graph-engine/core/state/GraphViewState.ts',
  'src/graph-engine/core/state/index.ts',
  'src/graph-engine/core/tags/GraphTagProjector.ts',
  'src/graph-engine/core/tags/index.ts',
  'src/graph-engine/core/topology/GraphTopologyLayoutPolicy.ts',
  'src/graph-engine/runtime/consciousness/Association.ts',
  'src/graph-engine/runtime/consciousness/Consciousness.ts',
  'src/graph-engine/runtime/consciousness/EgoInteractionPlan.ts',
  'src/graph-engine/runtime/consciousness/Judgement.ts',
  'src/graph-engine/runtime/consciousness/Memory.ts',
  'src/graph-engine/runtime/consciousness/Reaction.ts',
  'src/graph-engine/runtime/consciousness/index.ts',
  'src/graph-engine/runtime/experience/GraphExperienceContract.ts',
  'src/graph-engine/runtime/experience/GraphExperienceAdjudicator.ts',
  'src/graph-engine/runtime/interaction/GraphViewObjectActivation.ts',
  'src/graph-engine/runtime/interaction/GraphInteractionTypes.ts',
  'src/graph-engine/service/GraphEngineWorkspaceClient.ts',
  'src/graph-engine/service/UnavailableGraphSurface.ts',
];

await rm(artifactSourceRoot, { recursive: true, force: true });
await rm(legacyArtifactSourceRoot, { recursive: true, force: true });
await cp(join(repositoryRoot, 'LICENSE'), join(artifactRoot, 'LICENSE'));

for (const sourcePath of publicFiles) {
  const source = join(repositoryRoot, sourcePath);
  const destination = join(artifactRoot, 'src', relative('src', sourcePath));
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination);
}

const manifestPath = join(artifactRoot, 'package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const contentHash = createHash('sha256');
for (const sourcePath of publicFiles) {
  contentHash.update(sourcePath);
  contentHash.update('\0');
  contentHash.update(await readFile(join(repositoryRoot, sourcePath)));
  contentHash.update('\0');
}
const stamp = {
  artifact: manifest.name,
  artifactVersion: manifest.version,
  protocolVersion: 1,
  contentSha256: contentHash.digest('hex'),
  generatedFrom: 'src/graph-engine/public.ts',
  publicFiles,
};
await writeFile(join(artifactRoot, 'artifact-manifest.json'), `${JSON.stringify(stamp, null, 2)}\n`);
