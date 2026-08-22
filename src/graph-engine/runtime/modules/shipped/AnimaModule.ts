import type { JsonValue } from '../../../contracts/v1/index.ts';
import type { GraphModuleInstanceV1 } from '../GraphModuleTypes.ts';

export class AnimaModule implements GraphModuleInstanceV1 {
  restoreState(state: JsonValue): void {
    if (state !== null) throw new Error('Anima V1 state must be null.');
  }

  exportState(): JsonValue {
    return null;
  }
}
