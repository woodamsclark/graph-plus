import { ScreenPt, ClientPt } from '../shared/interfaces.ts';
import { ActivePointer } from './PointerTracker.ts';
import { distSq } from '../shared/distSq.ts';

type TwoFingerReading = { centroid: ScreenPt; dist: number; angle: number };


export class TwoFingerGesture {
  constructor(
    private getScreen: (clientX: number, clientY: number) => ScreenPt,
    private dragThresholdPx: number,
  ) {}

  read(pair: [ActivePointer, ActivePointer]): TwoFingerReading {
    const [a, b] = pair;
    const A = this.getScreen(a.clientX, a.clientY);
    const B = this.getScreen(b.clientX, b.clientY);

    const centroid = { x: (A.x + B.x) * 0.5, y: (A.y + B.y) * 0.5 };
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    return { centroid, dist, angle };
  }

  shouldStartPan(prevCentroid: ScreenPt, nextCentroid: ScreenPt) {
    const thresholdSq = this.dragThresholdPx * this.dragThresholdPx;
    return distSq(prevCentroid, nextCentroid) > thresholdSq;
  }
}
