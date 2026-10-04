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

test('global and Local Graph+ are policies of one application', () => {
  const obsidianRoot = join(process.cwd(), 'src', 'obsidian');
  const globalView = readFileSync(join(obsidianRoot, 'GraphView.ts'), 'utf8');
  const localView = readFileSync(join(obsidianRoot, 'LocalGraphView.ts'), 'utf8');
  const sharedView = readFileSync(join(obsidianRoot, 'GraphPlusObsidianView.ts'), 'utf8');
  const bridge = readFileSync(join(obsidianRoot, 'ObsidianGraphBridge.ts'), 'utf8');
  const plugin = readFileSync(join(obsidianRoot, 'main.ts'), 'utf8');
  const application = readFileSync(
    join(process.cwd(), 'src', 'graph-plus', 'application', 'GraphPlusApplication.ts'),
    'utf8',
  );
  const policy = readFileSync(
    join(process.cwd(), 'src', 'graph-plus', 'application', 'GraphPlusExperiencePolicy.ts'),
    'utf8',
  );
  const violations: string[] = [];
  if (!/super\(leaf, plugin, ['"]global['"]\)/.test(globalView)) {
    violations.push('global surface does not configure the shared Graph+ application');
  }
  if (!/super\(leaf, plugin, ['"]local['"]\)/.test(localView)) {
    violations.push('Local surface does not configure the shared Graph+ application');
  }
  if (!/graphPlusApplication\.createPresentation/.test(sharedView)
    || /(?:vault|metadataCache|workspace)\.on\(/.test(sharedView)) {
    violations.push('presentation host bypasses the shared application or subscribes to Obsidian independently');
  }
  if (!/new ObsidianGraphBridgeV1\(this\.app\)/.test(plugin)
    || !/new GraphPlusApplicationV1/.test(plugin)
    || !/graphBridge\.start/.test(plugin)) {
    violations.push('plugin does not own one shared Graph+ application and Obsidian bridge');
  }
  if (!/vault\.on\(['"]create['"]/.test(bridge)
    || !/metadataCache\.on\(['"]changed['"]/.test(bridge)
    || !/workspace\.on\(['"]file-open['"]/.test(bridge)
    || !/openNote\s*\(/.test(bridge)) {
    violations.push('ObsidianGraphBridge does not own inbound subscriptions and outbound host operations');
  }
  if (!/followActiveNode\s*\(/.test(application)) {
    violations.push('shared Graph+ application does not expose policy-governed active-note following');
  }
  if (!/options\.model\.reconcile\(\)/.test(application)
    || !/presentation\.applyCanonicalSnapshot\(snapshot\)/.test(application)) {
    violations.push('shared Graph+ application does not reconcile once and fan canonical truth to presentations');
  }
  if (!/projectGraphPlusExperienceDocumentV1/.test(application)) {
    violations.push('shared Graph+ application bypasses the experience projection boundary');
  }
  if (!/documentScope:\s*['"]vault['"]/.test(policy)
    || !/allowedInteractionStates:\s*\[['"]overview['"],\s*['"]explore['"],\s*['"]focus['"]\]/.test(policy)
    || !/canonicalRootState:\s*['"]session-constellation-focused-root['"]/.test(policy)
    || !/graphPlusEngineExperienceContractV1/.test(policy)
    || !/maximumNodeCount:\s*1/.test(policy)) {
    violations.push('Local policy does not reuse the full graph while starting from rooted Focus');
  }
  if (!/adoptSharedWorldState/.test(application)
    || !/applyWorldState/.test(application)
    || !/initialLayoutAuthority:\s*false/.test(application)) {
    violations.push('Graph+ presentations do not share one geometry world with pane-local viewport state');
  }
  if (!/experience:\s*graphPlusEngineExperienceContractV1\(this\.policy\)/.test(application)) {
    violations.push('Graph+ does not translate product policy into the neutral engine experience contract');
  }
  if (!/session\.applyExternalInfluence\s*\(/.test(application)) {
    violations.push('Graph+ canonical subject changes bypass the external influence boundary');
  }
  if (/queueEndogenousRoot\s*\(/.test(application)) {
    violations.push('Local endogenous Attention still rewrites the canonical projection root');
  }
  if (!/options\.navigator\.openNote\(/.test(application)
    || !/options\.navigator\.openTag\(/.test(application)) {
    violations.push('Graph+ activation does not remain an outbound host operation');
  }
  deepEqual(violations, [], 'Global and Local must be policy modes of one Graph+ application');
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
  const animaModulePath = join(runtime, 'modules', 'shipped', 'AnimaModule.ts');
  const animaModule = readFileSync(animaModulePath, 'utf8');
  const sceneCompilerPath = join(runtime, 'anima', 'AnimaSceneCompiler.ts');
  const sceneCompiler = readFileSync(sceneCompilerPath, 'utf8');
  const moduleTypesPath = join(runtime, 'modules', 'GraphModuleTypes.ts');
  const moduleTypes = readFileSync(moduleTypesPath, 'utf8');
  if (!/const consciousness = state\.consciousness/.test(animaModule)
    || /state\.viewState\.selectedNodeIds/.test(animaModule)) {
    violations.push(`${animaModulePath}: Anima inferred Consciousness from compatibility selection`);
  }
  if (!/readonly consciousness: ConsciousnessSnapshot/.test(sceneCompiler)
    || /interaction\.selectedNodeIds/.test(sceneCompiler)) {
    violations.push(`${sceneCompilerPath}: scene compiler inferred Attention from compatibility selection`);
  }
  const projectionPatch = moduleTypes.match(
    /interface GraphModuleProjectionPatchV1[\s\S]*?\n}/,
  )?.[0] ?? '';
  const presentationPatch = moduleTypes.match(
    /interface GraphModulePresentationPatchV1[\s\S]*?\n}/,
  )?.[0] ?? '';
  if (/Contributions|theme|presentationPolicy/.test(projectionPatch)) {
    violations.push(`${moduleTypesPath}: projection patch can emit downstream presentation`);
  }
  if (/document|projectionSelection|renderSelection|nodeRoles|edgeRoles/.test(presentationPatch)) {
    violations.push(`${moduleTypesPath}: presentation patch can mutate upstream projection`);
  }
  deepEqual(violations, [], 'Animus, Anima, and renderer ownership must remain one-way');
});

test('Consciousness owns Ego, Attention, and geometry-free Awareness per session', () => {
  const runtime = join(process.cwd(), 'src', 'graph-engine', 'runtime');
  const consciousnessPath = join(runtime, 'consciousness', 'Consciousness.ts');
  const consciousness = readFileSync(consciousnessPath, 'utf8');
  const session = readFileSync(join(runtime, 'GraphSessionRuntime.ts'), 'utf8');
  const commander = readFileSync(join(runtime, 'interaction', 'GraphCommander.ts'), 'utf8');
  const interactionTypes = readFileSync(join(runtime, 'interaction', 'GraphInteractionTypes.ts'), 'utf8');
  const vision = readFileSync(join(runtime, 'vision', 'Vision.ts'), 'utf8');
  const projectionCoordinatorPath = join(runtime, 'session', 'SessionProjectionCoordinator.ts');
  const projectionCoordinator = readFileSync(projectionCoordinatorPath, 'utf8');
  const violations: string[] = [];
  if (!/class Consciousness/.test(consciousness)
    || !/readonly ego = new Ego\(\)/.test(consciousness)
    || !/get attention\(\): Attention/.test(consciousness)
    || !/get awareness\(\): Awareness/.test(consciousness)
    || !/receiveExogenous\s*\(/.test(consciousness)) {
    violations.push(`${consciousnessPath}: incomplete Consciousness aggregate`);
  }
  const exogenousBody = consciousness.match(/receiveExogenous\s*\([\s\S]*?\n  }/)?.[0] ?? '';
  if (/\.ego\b/.test(exogenousBody)) {
    violations.push(`${consciousnessPath}: exogenous influence is incorrectly routed through Ego`);
  }
  if (!/this\.consciousness = new Consciousness\(\s*this\.experience/.test(session)) {
    violations.push('GraphSessionRuntime does not own one Consciousness aggregate');
  }
  const experienceContract = readFileSync(join(
    process.cwd(), 'src', 'graph-engine', 'contracts', 'v1', 'experience.ts',
  ), 'utf8');
  if (!/interface GraphExperienceContractV1/.test(experienceContract)
    || /(?:obsidian|global|local)/i.test(experienceContract)) {
    violations.push('Graph Engine experience contract is missing or contains host/product concepts');
  }
  if (!/deriveCentroid\s*\(/.test(vision)) {
    violations.push('Vision does not own derived centroid geometry');
  }
  if (!/const topology = this\.topology\(options\.projectionView\.document\)/.test(projectionCoordinator)
    || !/availableNodeIds:\s*topology\.nodeIds/.test(projectionCoordinator)
    || /availableNodeIds:\s*new Set\(Object\.keys\(options\.projectionView\.positions\)\)/.test(projectionCoordinator)) {
    violations.push(`${projectionCoordinatorPath}: Consciousness is not bounded by projected graph membership`);
  }
  if (!/this\.route\(command\)/.test(commander)
    || !/outcome\.status !== ['"]rejected['"]/.test(commander)) {
    violations.push('GraphCommander bypasses Ego intent adjudication');
  }
  if (!/type: ['"]direct-attention['"]/.test(interactionTypes)
    || /type: ['"]set-selection['"]/.test(interactionTypes)) {
    violations.push('endogenous interaction commands do not express Attention semantics');
  }
  for (const path of walk(runtime)) {
    const source = readFileSync(path, 'utf8');
    if (path.includes(`${join('runtime', 'ego')}`)) violations.push(`${path}: legacy Ego ownership path`);
    if (/awareness\.centroid\b/.test(source)) violations.push(`${path}: Awareness retained centroid geometry`);
  }
  deepEqual(violations, [], 'Consciousness ownership must remain explicit and geometry-free');
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
