import { InputManagerCallbacks } from '../types/interfaces.ts';

// This class manages user input (mouse events) on the graph canvas
// and reports mouse positions and actions back to the GraphManager via callbacks.
export class InputManager {
    private canvas              : HTMLCanvasElement;
    private callbacks           : InputManagerCallbacks;
    private isOrbiting          : boolean           = false;
    private isPanning           : boolean           = false;
    private isDraggingNode      : boolean           = false;
    private draggedNodeId       : string | null     = null;
    private lastMouseX          : number            = 0;
    private lastMouseY          : number            = 0;
    private downScreenX         : number            = 0;         // Initial screenX (canvas relative)
    private downScreenY         : number            = 0;         // Initial screenY (canvas relative)
    private isMouseClicking     : boolean           = false;    // True if LMB is down
    private dragThreshold       : number            = 5;         // Drag starts after 5 pixels of movement

    constructor(canvas: HTMLCanvasElement, callbacks: InputManagerCallbacks) {
        this.canvas     = canvas;
        this.callbacks  = callbacks;
        this.attachListeners();
    }

    private attachListeners() {
        // Use document listeners for mousemove/mouseup to allow dragging outside the canvas
        this.canvas.addEventListener('mousedown'    ,   this.onMouseDown        );
        this.canvas.addEventListener('wheel'        ,   this.onWheel            );
        this.canvas.addEventListener('mousemove'    ,   this.onMouseMove        ); // For hover state
        this.canvas.addEventListener('mouseleave'   ,   this.onMouseLeave       ); 
        document.addEventListener   ('mousemove'    ,   this.onGlobalMouseMove  ); // For drag/orbit
        document.addEventListener   ('mouseup'      ,   this.onGlobalMouseUp    ); // For drag/orbit end
    }

    private onMouseDown = (e: MouseEvent) => {
        e.preventDefault();
        this.lastMouseX         = e.clientX;
        this.lastMouseY         = e.clientY;
        this.isMouseClicking    = true;
        const isLeftClick       = e.button === 0;
        const isDragModifier    = e.button === 0;              // Check for left-click (and no modifier)
        const isOrbitModifier   = e.button === 0 && e.ctrlKey; // Example: Ctrl + Left click for Orbit
        this.downScreenX        = e.offsetX; 
        this.downScreenY        = e.offsetY; 
        this.isDraggingNode     = false;
        this.isPanning          = false;

        const hitNode = this.callbacks.detectClickedNode(e.offsetX, e.offsetY);
        if (isLeftClick) {
            if (hitNode) {
                this.draggedNodeId = hitNode.id; // Store ID for potential drag
            } else {
                // We don't start panning until movement threshold is exceeded
                this.draggedNodeId = null; // No node hit, potential pan
            }
        }
    }
    
    // Use this for calculating orbit/drag delta
    private onGlobalMouseMove = (e: MouseEvent) => {
        // 1. Compute deltas in *client* space (used for orbit & pan speed)
        const dx        = e.clientX - this.lastMouseX;
        const dy        = e.clientY - this.lastMouseY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        // 2. Compute current screen position relative to the canvas once
        const rect      = this.canvas.getBoundingClientRect();
        const screenX   = e.clientX - rect.left;
        const screenY   = e.clientY - rect.top;
        // 3. If we're orbiting, that's the only thing we care about
        if (this.isOrbiting) {
            //this.callbacks.onOrbit(dx, dy);
            return;
        }

        // 4. Decide whether this movement should *promote* to drag or pan
        const distSq        = (screenX - this.downScreenX) ** 2 + (screenY - this.downScreenY) ** 2;
        const thresholdSq   = this.dragThreshold ** 2;
        const overThreshold = distSq > thresholdSq;
        if (this.isMouseClicking && overThreshold && !this.isPanning && !this.isDraggingNode) {
            // A. Promote to node drag (we clicked on a node at mousedown)
            if (this.draggedNodeId !== null && !this.isDraggingNode) {
                this.isDraggingNode = true;
                //this.callbacks.onDragStart(this.draggedNodeId, this.downScreenX, this.downScreenY);
            }
            // B. Or promote to pan (we clicked empty space)
            else if (this.draggedNodeId === null && !this.isPanning) {
                this.isPanning = true;
                this.callbacks.onPanStart(screenX, screenY);
            }
        }

        // 5. States are decided, perform exactly one kind of movement
        if (this.isDraggingNode) {
            // drag uses screen coords so GraphManager can do screen->world
            //this.callbacks.onDragMove(screenX, screenY);
            return;
        }
        if (this.isPanning) {
            this.callbacks.onPanMove(screenX, screenY);
            return;
        }
    }

    // Use this for ending orbit/drag
    private onGlobalMouseUp = (e: MouseEvent) => {
        const isLeftClick       = e.button === 0;
        const wasDragging       = this.isDraggingNode;
        const wasPanning        = this.isPanning;
        this.isPanning          = false;
        //this.isOrbiting = false; // we don't want to leave orbit on mouseup
        this.isDraggingNode     = false;
        this.isMouseClicking    = false; 
        this.draggedNodeId      = null; // Clear the potential/confirmed target

        if (wasDragging) {
            this.callbacks.onDragEnd(); 
            return; // Suppresses click
        }
        if (wasPanning) {
            this.callbacks.onPanEnd();
            return; // Suppresses click
        }  
        // 4. Handle clean Click (if NO movement passed the threshold)
        if (isLeftClick) {
            const rect      = this.canvas.getBoundingClientRect();
            const screenX   = e.clientX - rect.left;
            const screenY   = e.clientY - rect.top;
            this.callbacks.onOpenNode(screenX, screenY); 
        }
    }

    private onMouseMove = (e: MouseEvent) => {
        // If we're already dragging or orbiting, the global handler takes precedence
        if (this.isDraggingNode || this.isOrbiting) return;
        
        // Handle Hover and Preview logic
        //this.callbacks.onHover(e.offsetX, e.offsetY);
    }
    
    private onWheel = (e: WheelEvent) => {
        e.preventDefault();
        this.callbacks.onZoom(e.offsetX, e.offsetY, Math.sign(e.deltaY));
    }

    private onMouseLeave = () => {
        // Clear hover state when leaving the canvas
        // This prevents the graph from thinking the mouse is still over it
        this.callbacks.onHover(-Infinity, -Infinity); 
    }

    public destroy() {
        this.canvas.removeEventListener('mousemove' ,   this.onMouseMove        );
        this.canvas.removeEventListener('mousedown' ,   this.onMouseDown        );
        this.canvas.removeEventListener('wheel'     ,   this.onWheel            );
        this.canvas.removeEventListener('mouseleave',   this.onMouseLeave       );
        document.removeEventListener   ('mousemove' ,   this.onGlobalMouseMove  );
        document.removeEventListener   ('mouseup'   ,   this.onGlobalMouseUp    );
    }
}

// The below is the logic pulled from GraphController. 
// It belongs in there, but I've pulled it out just to make the other file saner to skim through
// I need to work through this and pull out the logic I want into the respective callbacks above.

/*    this.mouseMoveHandler = (ev: MouseEvent) => {
      if (!this.canvas || !this.renderer) return;
      const r = this.canvas.getBoundingClientRect();
      const screenX = ev.clientX - r.left;
      const screenY = ev.clientY - r.top;
      // track last mouse position in screen space for attractor
      this.lastMouseX = screenX;
      this.lastMouseY = screenY;
      // Re-enable the cursor attractor after any programmatic camera move
      this.suppressAttractorUntilMouseMove = false;

      // If currently dragging a node, move it to the world coords under the cursor
      if (this.draggingNode) {
        const now = performance.now();
        // map screen -> world at the stored camera-space depth so dragging respects yaw/pitch
        let world: any = null;
        try {
          const cam     = (this.renderer as any).getCamera();
          const width   = this.canvas ? this.canvas.width   : (this.containerEl.getBoundingClientRect().width || 300);
          const height  = this.canvas ? this.canvas.height  : (this.containerEl.getBoundingClientRect().height || 200);
          if ((this.renderer as any).screenToWorldAtDepth) {
            world = (this.renderer as any).screenToWorldAtDepth(screenX, screenY, this.dragStartDepth, width, height, cam);
          } else {
            world = (this.renderer as any).screenToWorld(screenX, screenY);
          }
        } catch (e) {
          world = (this.renderer as any).screenToWorld(screenX, screenY);
        }

        // Movement threshold for considering this a drag (in screen pixels)
        if (!this.hasDragged) {
          const dxs = screenX - this.downScreenX;
          const dys = screenY - this.downScreenY;
          if (Math.sqrt(dxs * dxs + dys * dys) > this.dragThreshold) {
            this.hasDragged   = true;
            this.preventClick = true;
          }
        }

        // compute instantaneous velocity in world-space
        const dt = Math.max((now - this.lastDragTime) / 1000, 1e-6);
        this.dragVx = ((world.x + this.dragOffsetWorld.x) - this.lastWorldX) / dt;
        this.dragVy = ((world.y + this.dragOffsetWorld.y) - this.lastWorldY) / dt;

        // override node position and zero velocities so physics doesn't move it
        this.draggingNode.x   = world.x         + this.dragOffsetWorld.x;
        this.draggingNode.y   = world.y         + this.dragOffsetWorld.y;
        this.draggingNode.z   = (world.z || 0)  + this.dragOffsetWorld.z;
        this.draggingNode.vx  = 0;
        this.draggingNode.vy  = 0;
        this.draggingNode.vz  = 0;
        this.lastWorldX       = this.draggingNode.x;
        this.lastWorldY       = this.draggingNode.y;
        this.lastDragTime     = now;

        this.renderer.render();
        // while dragging, disable the mouse attractor so physics doesn't fight the drag
        try { if (this.simulation && (this.simulation as any).setMouseAttractor) (this.simulation as any).setMouseAttractor(null, null, null); } catch (e) {}
        return;
      }

      // If right-button is held and we had a pending focus, treat sufficient movement as orbit start
      try {
        if ((ev.buttons & 2) === 2 && this.pendingFocusNode) {
          const dx = screenX - this.pendingFocusDownX;
          const dy = screenY - this.pendingFocusDownY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const dragThreshold = 8;
          if (dist > dragThreshold) {
            // begin orbiting and cancel the pending focus
            this.isOrbiting = true;
            // set lastOrbit to the original down position so motion is continuous
            this.lastOrbitX = this.pendingFocusDownX;
            this.lastOrbitY = this.pendingFocusDownY;
            // clear pending focus
            this.pendingFocusNode = null;
            // cancel following if active
            if (this.isCameraFollowing) { this.isCameraFollowing = false; this.cameraFollowNode = null; }
          }
        }
      } catch (e) {}

      // Orbit (right mouse button drag)
      if (this.isOrbiting) {
        // keep hover/follow lock while orbiting; only adjust yaw/pitch
        const dx = screenX - this.lastOrbitX;
        const dy = screenY - this.lastOrbitY;
        this.lastOrbitX = screenX;
        this.lastOrbitY = screenY;
        try {
          const cam = (this.renderer as any).getCamera();
          const yawSpeed = 0.005;
          const pitchSpeed = 0.005;
          let newYaw = cam.yaw - dx * yawSpeed;
          let newPitch = cam.pitch - dy * pitchSpeed;
          const maxPitch = Math.PI / 2 - 0.1;
          const minPitch = -maxPitch;
          newPitch = Math.max(minPitch, Math.min(maxPitch, newPitch));
          (this.renderer as any).setCamera({ yaw: newYaw, pitch: newPitch });
          (this.renderer as any).render();
        } catch (e) {}
        return;
      }

      // Middle-button pan: move camera target
      if (this.isMiddlePanning) {
        // user interaction cancels camera following
        if (this.isCameraFollowing) { this.isCameraFollowing = false; this.cameraFollowNode = null; }
        const dx = screenX - this.panStartX;
        const dy = screenY - this.panStartY;
        try {
          const cam = (this.renderer as any).getCamera();
          const panSpeed    = cam.distance * 0.001 / Math.max(0.0001, cam.zoom);
          const newTargetX  = this.panStartTargetX - dx * panSpeed;
          const newTargetY  = this.panStartTargetY + dy * panSpeed;
          (this.renderer as any).setCamera({ targetX: newTargetX, targetY: newTargetY });
          (this.renderer as any).render();
        } catch (e) {}
        return;
      }

      // Legacy 2D panning (left drag on empty) remains
      if (this.isPanning) {
        // user interaction cancels camera following
        this.followLockedNodeId = null; this.previewLockNodeId = null;
        const dx = screenX - this.lastPanX;
        const dy = screenY - this.lastPanY;
        (this.renderer as any).panBy(dx, dy);
        this.lastPanX = screenX;
        this.lastPanY = screenY;
        return;
      }

      // Default: treat as hover; pass the original event for preview modifier detection
      this.updateHoverFromCoords(screenX, screenY, ev);
    };

    this.mouseLeaveHandler = () => { this.clearHover(); this.lastPreviewedNodeId = null; };
    // on leave, clear last mouse
    this.lastMouseX = null; this.lastMouseY = null;

    // ensure any preview poll timer is cleared when leaving the view area
    // (we intentionally don't release previewLockNodeId here; poll determines actual popover state)

    this.mouseClickHandler = (ev: MouseEvent) => {
      if (!this.canvas) return;
      if (ev.button !== 0) return;
      // If a recent drag occurred, suppress this click
      if (this.preventClick) {
        this.preventClick = false;
        return;
      }
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      this.handleClick(x, y);
    };

    this.wheelHandler = (ev: WheelEvent) => {
      if (!this.canvas || !this.renderer) return;
      ev.preventDefault();
      try {
        // any user wheel action cancels camera following but should NOT cancel
        // the preview hover lock so highlighting remains while zooming.
        this.followLockedNodeId = null;
        const cam       = (this.renderer as any).getCamera();
        const zoomSpeed = 0.0015;
        const factor    = Math.exp(ev.deltaY * zoomSpeed);
        let distance    = (cam.distance || 1000) * factor;
        distance        = Math.max(200, Math.min(8000, distance));
        (this.renderer as any).setCamera({ distance });
        (this.renderer as any).render();
      } catch (e) {}
    };

    this.mouseDownHandler = (ev: MouseEvent) => {
      if (!this.canvas || !this.renderer) return;
      const r       = this.canvas.getBoundingClientRect();
      const screenX = ev.clientX - r.left;
      const screenY = ev.clientY - r.top;
      // Right button -> either mark pending focus on node or pending focus on empty (origin)
      // We don't start orbit immediately; if the user drags beyond a threshold we'll begin orbiting.
      if (ev.button === 2) {
        const hitNode = this.hitTestNodeScreen(screenX, screenY);
        if (hitNode) {
          // pending focus on this node
          this.pendingFocusNode   = hitNode;
          this.pendingFocusDownX  = screenX;
          this.pendingFocusDownY  = screenY;
          ev.preventDefault();
          return;
        } else {
          // pending focus to reset to origin (0,0,0) if click (no drag)
          this.pendingFocusNode   = '__origin__';
          this.pendingFocusDownX  = screenX;
          this.pendingFocusDownY  = screenY;
          ev.preventDefault();
          return;
        }
      }
      // Middle button -> start camera target pan
      if (ev.button === 1) {
        try {
          const cam             = (this.renderer as any).getCamera();
          this.isMiddlePanning  = true;
          this.panStartX        = screenX;
          this.panStartY        = screenY;
          this.panStartTargetX  = cam.targetX;
          this.panStartTargetY  = cam.targetY;
          ev.preventDefault();
          return;
        } catch (e) {}
      }
      if (ev.button !== 0) return;
      const world = (this.renderer as any).screenToWorld(screenX, screenY);

      // initialize drag tracking
      this.hasDragged   = false;
      this.preventClick = false;
      this.downScreenX  = screenX;
      this.downScreenY  = screenY;
      this.lastWorldX   = world.x;
      this.lastWorldY   = world.y;
      this.lastDragTime = performance.now();

      // Hit-test in screen coords to see if a node was clicked
      const hit = this.hitTestNodeScreen(screenX, screenY);
      if (hit) {
        // prevent dragging tag nodes for now (projected plane)
        if ((hit as any).type === 'tag') {
          this.isPanning = true;
          this.lastPanX = screenX;
          this.lastPanY = screenY;
          this.canvas.style.cursor = 'grab';
        } else {
          // begin 3D-aware drag: compute camera-space depth and world offset at click
          this.draggingNode = hit;
          try {
            const cam             = (this.renderer as any).getCamera();
            const proj            = (this.renderer as any).getProjectedNode ? (this.renderer as any).getProjectedNode(hit) : null;
            const depth           = proj ? proj.depth : 1000;
            this.dragStartDepth   = depth;
            const width           = this.canvas ? this.canvas.width  : (this.containerEl.getBoundingClientRect().width || 300);
            const height          = this.canvas ? this.canvas.height : (this.containerEl.getBoundingClientRect().height || 200);
            const screenXClient   = proj ? proj.x : screenX;
            const screenYClient   = proj ? proj.y : screenY;
            const worldAtCursor   = (this.renderer as any).screenToWorldAtDepth ? (this.renderer as any).screenToWorldAtDepth(screenXClient, screenYClient, depth, width, height, cam) : (this.renderer as any).screenToWorld(screenXClient, screenYClient);
            this.dragOffsetWorld  = {
              x: (hit.x || 0) - (worldAtCursor.x || 0),
              y: (hit.y || 0) - (worldAtCursor.y || 0),
              z: (hit.z || 0) - (worldAtCursor.z || 0),
            };
            // pin this node in the simulation so physics won't move it while dragging
            try { if (this.simulation && (this.simulation as any).setPinnedNodes) (this.simulation as any).setPinnedNodes(new Set([hit.id])); } catch (e) {}
          } catch (e) {
            this.dragOffsetWorld = { x: 0, y: 0, z: 0 };
          }
          this.canvas.style.cursor = 'grabbing';
        }
      } else {
        // start panning
        this.isPanning = true;
        this.lastPanX = screenX;
        this.lastPanY = screenY;
        this.canvas.style.cursor = 'grab';
      }
    };

    this.mouseUpHandler = (ev: MouseEvent) => {
      if (!this.canvas) return;
      if (ev.button === 2) {
        // consume pending focus click if present
        if (this.pendingFocusNode) {
          const dx = ev.clientX - (this.canvas.getBoundingClientRect().left + this.pendingFocusDownX);
          const dy = ev.clientY - (this.canvas.getBoundingClientRect().top + this.pendingFocusDownY);
          const dist = Math.sqrt(dx * dx + dy * dy);
          const clickThreshold = 8;
          if (dist <= clickThreshold) {
            try {
              if (this.pendingFocusNode === '__origin__') {
                // Animate focus to origin; clear follow/highlight; keep a sane default distance
                try {
                  if (this.renderer) {
                    const cam = (this.renderer as any).getCamera();
                    const from = {
                      targetX: cam.targetX ?? 0,
                      targetY: cam.targetY ?? 0,
                      targetZ: cam.targetZ ?? 0,
                      distance: cam.distance ?? 1000,
                      yaw: cam.yaw ?? 0,
                      pitch: cam.pitch ?? 0,
                    };
                    const to = {
                      targetX: this.viewCenterX ?? 0,
                      targetY: this.viewCenterY ?? 0,
                      targetZ: 0,
                      distance: this.defaultCameraDistance,
                      yaw: from.yaw,
                      pitch: from.pitch,
                    };
                    this.cameraAnimStart = performance.now();
                    this.cameraAnimDuration = 300;
                    this.cameraAnimFrom = from;
                    this.cameraAnimTo = to;
                    // clear any follow locks
                    this.isCameraFollowing = false;
                    this.cameraFollowNode = null;
                  }
                } catch (e) {}
                try { if ((this.renderer as any).resetPanToCenter) (this.renderer as any).resetPanToCenter(); } catch (e) {}
                this.followLockedNodeId = null; this.previewLockNodeId = null;
                try {
                  if ((this.renderer as any).setHoverState ) (this.renderer as any).setHoverState(null, new Set(), 0, 0);
                  if ((this.renderer as any).setHoveredNode) (this.renderer as any).setHoveredNode(null);
                  (this.renderer as any).render?.();
                } catch (e) {}
                // suppress the cursor attractor until user next moves the mouse
                this.suppressAttractorUntilMouseMove = true;
              } else {
                // Center camera onto node using animated focus helper; lock hover + follow until user drags/another right-click
                const n = this.pendingFocusNode;
                try {
                  this.focusCameraOnNode(n);
                } catch (e) {}
                try { if ((this.renderer as any).resetPanToCenter) (this.renderer as any).resetPanToCenter(); } catch (e) {}
                this.followLockedNodeId = n.id;
                this.previewLockNodeId = n.id;
                // suppress the cursor attractor until user next moves the mouse
                this.suppressAttractorUntilMouseMove = true;
              }
            } catch (e) {}
          }
          this.pendingFocusNode = null;
        }
        this.isOrbiting = false;
      }
      if (ev.button === 1) this.isMiddlePanning = false;
      if (ev.button !== 0) return;

      // If we were dragging a node, apply momentum if it was dragged
      if (this.draggingNode) {
        if (this.hasDragged) {
          try {
            this.draggingNode.vx = this.dragVx * this.momentumScale;
            this.draggingNode.vy = this.dragVy * this.momentumScale;
          } catch (e) {}
        }
        // unpin node so physics resumes
        try { if (this.simulation && (this.simulation as any).setPinnedNodes) (this.simulation as any).setPinnedNodes(new Set()); } catch (e) {}
      }

      // reset dragging / panning state
      this.isPanning = false;
      this.draggingNode = null;
      // preventClick remains true if a drag occurred; click handler will clear it
      this.canvas.style.cursor = 'default';
      // save positions after a drag ends (debounced)
      try { if (this.saveNodePositionsDebounced) this.saveNodePositionsDebounced(); } catch (e) {}
    };

    this.canvas.addEventListener('mousemove', this.mouseMoveHandler);
    this.canvas.addEventListener('mouseleave', this.mouseLeaveHandler);
    this.canvas.addEventListener('click', this.mouseClickHandler);
    this.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    this.canvas.addEventListener('mousedown', this.mouseDownHandler);
    window.addEventListener('mouseup', this.mouseUpHandler);
    this.canvas.addEventListener('contextmenu', (e) => { if (this.isOrbiting || this.pendingFocusNode) e.preventDefault(); });
*/