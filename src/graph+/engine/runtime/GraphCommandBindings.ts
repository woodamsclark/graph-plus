

import { CommandRegistry        }    from "../../systems/3. Module Commander/Commander.ts";
import { NavigationController   }    from "../controllers/NavigationController.ts";
import { InteractionController  }    from "../controllers/InteractionController.ts";

export class GraphCommandBindings {
  constructor(private deps: {
    registry:       CommandRegistry;
    navigation:     NavigationController;
    interaction:    InteractionController;
  }) {}

  register(): void {
    const { registry, navigation, interaction } = this.deps;

    registry.register("OpenNode", (command) => {
      navigation.openNode(command.nodeId);
    });

    registry.register("SetMouseGravity", (command) => {
      interaction.setMouseGravity(command.on);
    });

    registry.register("PinNode", (command) => {
      interaction.pinNode(command.nodeId);
    });

    registry.register("UnpinNode", (command) => {
      interaction.unpinNode(command.nodeId);
    });

    registry.register("BeginDrag", (command) => {
      interaction.beginDrag(command.nodeId, command.targetWorld);
    });

    registry.register("UpdateDragTarget", (command) => {
      interaction.updateDragTarget(command.targetWorld);
    });

    registry.register("EndDrag", () => {
      interaction.endDrag();
    });

    registry.register("ResetCamera", () => {
      interaction.resetCamera();
    });

    registry.register("StartPanCamera", (command) => {
      interaction.startPan(command.screen);
    });

    registry.register("UpdatePanCamera", (command) => {
      interaction.updatePan(command.screen);
    });

    registry.register("EndPanCamera", () => {
      interaction.endPan();
    });

    registry.register("StartRotateCamera", (command) => {
      interaction.startRotate(command.screen);
    });

    registry.register("UpdateRotateCamera", (command) => {
      interaction.updateRotate(command.screen);
    });

    registry.register("EndRotateCamera", () => {
      interaction.endRotate();
    });

    registry.register("ZoomCamera", (command) => {
      interaction.zoomCamera(command.screen, command.delta);
    });

    registry.register("SetGravityCenter", (command) => {
      interaction.setGravityCenter(command.point);
    });

    registry.register("SetHoveredNode", (command) => {
      interaction.setHoveredNode(command.nodeId);
    });

    registry.register("SetFollowedNode", (command) => {
      interaction.setFollowedNode(command.nodeId);
    });

    registry.register("SetDraggedNode", (command) => {
      interaction.setDraggedNode(command.nodeId);
    });

    registry.register("SetPanning", (command) => {
      interaction.setPanning(command.on);
    });

    registry.register("SetRotating", (command) => {
      interaction.setRotating(command.on);
    });

    registry.register("SetCameraTarget", (command) => {
      interaction.setCameraTarget(command.target);
    });
  }
}