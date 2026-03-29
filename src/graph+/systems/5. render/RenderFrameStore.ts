import type {RenderFrame} from "../../grammar/interfaces.ts";

export class RenderFrameStore {
  private frame: RenderFrame | null = null;

  public get(): RenderFrame | null {
    return this.frame;
  }

  public set(frame: RenderFrame | null): void {
    this.frame = frame;
  }
}