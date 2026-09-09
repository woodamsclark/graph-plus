/** Host-neutral preview presentation. Markdown and DOM lifecycle stay in the host. */
export const animaPreviewTiming = { open: 220, handoff: 320, leave: 100 } as const;

export type AnimaPreviewPhase = 'inactive' | 'waiting' | 'node-active' | 'card-active' | 'closing';

export function resolveAnimaPreviewCard(input: {
  readonly anchor: { readonly x: number; readonly y: number };
  readonly viewport: { readonly width: number; readonly height: number };
  readonly measuredHeight: number;
}) {
  const margin = 12;
  const gap = 18;
  const width = Math.min(380, Math.max(1, input.viewport.width - margin * 2));
  const maxHeight = Math.max(1, Math.min(500, input.viewport.height - margin * 2));
  const height = Math.min(maxHeight, input.measuredHeight > 0 ? input.measuredHeight : maxHeight);
  const right = input.anchor.x + gap;
  const placement = right + width <= input.viewport.width - margin ? 'right' : 'left';
  const left = placement === 'right' ? right : input.anchor.x - gap - width;
  return {
    placement,
    left: clamp(left, margin, Math.max(margin, input.viewport.width - width - margin)),
    top: clamp(input.anchor.y - Math.min(52, height / 3), margin,
      Math.max(margin, input.viewport.height - height - margin)),
    width,
    maxHeight,
    // V1.8 uses immediate presentation, including under reduced motion.
    opacity: 1,
    scale: 1,
  } as const;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
