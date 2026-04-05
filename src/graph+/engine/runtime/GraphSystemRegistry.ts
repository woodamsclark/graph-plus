import { SpaceTime            } from "../../systems/SpaceTime.ts";
import { UIInterpreter        } from "../../systems/2. UI Interpretation + State/UIInterpreter.ts";
import { Commander            } from "../../systems/3. Module Commander/Commander.ts";
import { Anima                } from "../../systems/4. Modules/Anima.ts";
import { Physics              } from "../../systems/4. Modules/Physics.ts";
import { FrameComposer        } from "../../systems/5. Render/FrameComposer.ts";
import { Renderer             } from "../../systems/5. Render/Renderer.ts";

export class GraphSystemRegistry {
  register(deps: {
    spaceTime:            SpaceTime;
    uiInterpreter:        UIInterpreter       | null;
    commandSystem:        Commander           | null;
    anima:                Anima               | null;
    physics:              Physics             | null;
    frameComposer:        FrameComposer       | null;
    renderer:             Renderer            | null;
    cursorTick: () => void;
  }): void {
    const {
      spaceTime,
      uiInterpreter,
      commandSystem,
      anima,
      physics,
      frameComposer: frameComposer,
      renderer,
      cursorTick,
    } = deps;

    if (uiInterpreter) {
      spaceTime.register("translate", uiInterpreter, 10);
    }

    if (commandSystem) {
      spaceTime.register("commands", commandSystem, 20);
    }

    if (anima) {
      spaceTime.register("anima", anima, 25);
    }

    if (physics) {
      spaceTime.register("physics", physics, 30);
    }

    if (frameComposer) {
      spaceTime.register("render-state-composer", frameComposer, 90);
    }

    spaceTime.register("cursor", {
      tick: cursorTick,
    }, 95);

    if (renderer) {
      spaceTime.register("render", renderer, 100);
    }
  }
}