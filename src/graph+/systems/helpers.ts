import type { PointerKind } from "../types/domain/ui.ts";


export type PointerRec = {
  id: number;
  kind: PointerKind;
  x: number;
  y: number;
};

export function distSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function wrapAngleDelta(d: number): number {
  const pi = Math.PI;
  while (d > pi) d -= 2 * pi;
  while (d < -pi) d += 2 * pi;
  return d;
}

export function twoFingerRead(a: PointerRec, b: PointerRec) {
  const cx = (a.x + b.x) * 0.5;
  const cy = (a.y + b.y) * 0.5;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  return { centroid: { x: cx, y: cy }, dist, angle };
}