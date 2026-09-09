/** Host-neutral preview presentation. Markdown and DOM lifecycle stay in the host. */
export const animaPreviewTiming = { open: 220, handoff: 400, leave: 240 } as const;

export type AnimaPreviewPhase = 'inactive' | 'waiting' | 'node-active' | 'card-active' | 'closing';

export function resolveAnimaPreviewCard(input: {
  readonly anchor: { readonly x: number; readonly y: number };
  readonly viewport: { readonly width: number; readonly height: number };
  readonly measuredHeight: number;
  readonly worldScale?: number;
}) {
  const margin = 12;
  const gap = 18;
  const scale = clamp(Number.isFinite(input.worldScale) ? input.worldScale ?? 1 : 1, 0.2, 2.5);
  const width = Math.min(380, Math.max(1, input.viewport.width - margin * 2));
  const maxHeight = Math.max(1, Math.min(500, (input.viewport.height - margin * 2) / scale));
  const height = Math.min(maxHeight, input.measuredHeight > 0 ? input.measuredHeight : maxHeight);
  const displayedWidth = width * scale;
  const displayedHeight = height * scale;
  const right = input.anchor.x + gap;
  const placement = right + displayedWidth <= input.viewport.width - margin ? 'right' : 'left';
  const left = placement === 'right' ? right : input.anchor.x - gap - displayedWidth;
  return {
    placement,
    left: clamp(left, margin, Math.max(margin, input.viewport.width - displayedWidth - margin)),
    top: clamp(input.anchor.y - Math.min(52 * scale, displayedHeight / 3), margin,
      Math.max(margin, input.viewport.height - displayedHeight - margin)),
    width,
    maxHeight,
    // V1.8 uses immediate presentation, including under reduced motion.
    opacity: 1,
    scale,
  } as const;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
