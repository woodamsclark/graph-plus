export type CursorCss = "default" | "pointer" | "grabbing";

export function cursor_selector(canvas: HTMLCanvasElement) {
  let applied: CursorCss = "default";

  function apply(css: CursorCss) {
    if (css === applied) return;

    applied = css;
    canvas.style.cursor = css;
  }

  function reset() {
    apply("default");
  }

  return {
    apply,
    reset,
  };
}
