import { ScreenPt } from './interfaces.ts';
export function distSq(a: ScreenPt, b: ScreenPt) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}