import type { EngineModuleDescriptorV1 } from '../../contracts/v1/index.ts';
import type { EffectiveConsumerProfileV1 } from '../../core/profile/index.ts';
import type { GraphModuleDefinitionV1 } from './GraphModuleTypes.ts';

export class GraphModuleRegistry {
  private readonly definitions = new Map<string, GraphModuleDefinitionV1>();

  register(definition: GraphModuleDefinitionV1): void {
    const id = definition.descriptor.id;
    if (this.definitions.has(id)) throw new Error(`Graph module "${id}" is already registered.`);
    if (!Number.isFinite(definition.order)) throw new Error(`Graph module "${id}" needs a finite order.`);
    this.definitions.set(id, { ...definition, descriptor: cloneDescriptor(definition.descriptor) });
  }

  get(id: string): GraphModuleDefinitionV1 | undefined {
    return this.definitions.get(id);
  }

  descriptors(): readonly EngineModuleDescriptorV1[] {
    return [...this.definitions.values()]
      .sort(compareDefinitions)
      .map(({ descriptor }) => cloneDescriptor(descriptor));
  }

  resolve(profile: EffectiveConsumerProfileV1): readonly GraphModuleDefinitionV1[] {
    const enabled = Object.values(profile.modules).filter((module) => module.enabled);
    const pending = new Map(enabled.map((module) => [module.id, module]));
    const resolved: GraphModuleDefinitionV1[] = [];
    const resolvedIds = new Set<string>();

    while (pending.size) {
      const ready = [...pending.values()]
        .filter((module) => {
          const definition = this.definitions.get(module.id);
          return (definition?.descriptor.dependencies ?? []).every((dependency) => resolvedIds.has(dependency));
        })
        .map((module) => this.definitions.get(module.id))
        .filter((definition): definition is GraphModuleDefinitionV1 => definition !== undefined)
        .sort(compareDefinitions);
      if (!ready.length) {
        return [
          ...resolved,
          ...[...pending.keys()]
            .map((id) => this.definitions.get(id))
            .filter((definition): definition is GraphModuleDefinitionV1 => definition !== undefined)
            .sort(compareDefinitions),
        ];
      }
      for (const definition of ready) {
        pending.delete(definition.descriptor.id);
        resolvedIds.add(definition.descriptor.id);
        resolved.push(definition);
      }
    }
    return resolved;
  }
}

function compareDefinitions(a: GraphModuleDefinitionV1, b: GraphModuleDefinitionV1): number {
  return a.order - b.order || a.descriptor.id.localeCompare(b.descriptor.id);
}

function cloneDescriptor(descriptor: EngineModuleDescriptorV1): EngineModuleDescriptorV1 {
  return JSON.parse(JSON.stringify(descriptor)) as EngineModuleDescriptorV1;
}
