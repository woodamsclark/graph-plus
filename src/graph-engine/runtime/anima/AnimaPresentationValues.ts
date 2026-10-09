import type { AnimaPresentationPhaseV1 } from './AnimaAwareness.ts';
import { multiplyGraphColorAlphaV2 } from '../theme/index.ts';

/** Shared visual policy for both module dressing and standalone scene compilation. */
export function animaPhaseOpacity(phase: AnimaPresentationPhaseV1, kind: 'node' | 'edge'): number {
  return phase === 'void' ? 0 : phase === 'dimmed' ? kind === 'node' ? 0.24 : 0.6 : 1;
}

export const animaMemoryColor = multiplyGraphColorAlphaV2;
