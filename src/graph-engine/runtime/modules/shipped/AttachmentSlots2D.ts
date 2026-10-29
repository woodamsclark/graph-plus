import { AttachmentSlots } from './AttachmentSlots.ts';
export { wrapAttachmentAngle2D } from './AttachmentSlots.ts';
export type { AttachmentEndpoint as AttachmentEndpoint2D, AttachmentSpring as AttachmentSpring2D } from './AttachmentSlots.ts';

/** Compatibility entry point; 2D behavior is implemented by the shared slot lifecycle. */
export class AttachmentSlots2D extends AttachmentSlots {
  constructor() { super('2d'); }
}
