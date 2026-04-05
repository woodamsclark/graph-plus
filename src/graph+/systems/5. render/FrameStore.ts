import type { RenderFrame } from "../../types/domain/render.ts";

export class FrameStore {
  private frame: RenderFrame | null = null;

  public get(): RenderFrame | null {
    return this.frame;
  }

  public set(frame: RenderFrame | null): void {
    this.frame = frame;
  }
}