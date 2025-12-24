export type CursorCss = "default" | "pointer" | "grabbing";

export function createCursorController(canvas: HTMLCanvasElement) {
  let applied       : CursorCss         = "default";

  function apply(css: CursorCss) {
    if (css === applied) return;

    applied = css;
    canvas.style.cursor = css;
  }

  function reset() {
    apply("default");
  }

  function grab(){
    apply("grabbing");
  }

  function hover(){
    apply("pointer");
  }

  return {
    apply,
    reset,
  };
}
