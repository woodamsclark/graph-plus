import type {
  GraphCameraStateV1,
  GraphDimensionsV1,
  Vec3,
} from '../../contracts/v1/index.ts';

export interface GraphViewportV1 {
  readonly width: number;
  readonly height: number;
}

export interface ProjectedGraphPointV1 {
  readonly x: number;
  readonly y: number;
  readonly depth: number;
  readonly scale: number;
}

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 40;
const MIN_PERSPECTIVE_DISTANCE = 10;
const MAX_PERSPECTIVE_DISTANCE = 10_000_000;
const DEFAULT_PERSPECTIVE_DISTANCE = 100;
const DEFAULT_PERSPECTIVE_ZOOM = 50 / 24;
const MIN_PROJECTED_SCALE = 0.02;
const MAX_PROJECTED_SCALE = 40;

export class GraphCameraController {
  private state: GraphCameraStateV1;
  private viewport: GraphViewportV1 = { width: 0, height: 0 };

  constructor(state: GraphCameraStateV1, private dimensions: GraphDimensionsV1) {
    this.state = cloneCamera(state);
  }

  getState(): GraphCameraStateV1 {
    return cloneCamera(this.state);
  }

  setState(state: GraphCameraStateV1): void {
    this.state = cloneCamera(state);
  }

  reconfigure(state: GraphCameraStateV1, dimensions: GraphDimensionsV1): void {
    this.state = cloneCamera(state);
    this.dimensions = dimensions;
  }

  setViewport(width: number, height: number): void {
    this.viewport = {
      width: Math.max(0, width),
      height: Math.max(0, height),
    };
  }

  getViewport(): GraphViewportV1 {
    return { ...this.viewport };
  }

  worldToScreen(world: Vec3): ProjectedGraphPointV1 {
    const basis = cameraBasis(this.state);
    const relative = subtract(world, this.state.position);
    const viewX = dot(relative, basis.right);
    const viewY = dot(relative, basis.up);
    const depth = dot(relative, basis.forward);
    const centerX = this.viewport.width / 2;
    const centerY = this.viewport.height / 2;

    if (this.state.projection === 'orthographic') {
      return {
        x: centerX + viewX * this.state.zoom,
        y: centerY + viewY * this.state.zoom,
        depth,
        scale: clamp(this.state.zoom, MIN_PROJECTED_SCALE, MAX_PROJECTED_SCALE),
      };
    }

    const focal = Math.max(1, this.viewport.height) * this.state.zoom;
    const safeDepth = Math.max(0.0001, depth);
    return {
      x: centerX + viewX * focal / safeDepth,
      y: centerY + viewY * focal / safeDepth,
      depth,
      scale: clamp(
        (this.state.zoom / DEFAULT_PERSPECTIVE_ZOOM)
          * (DEFAULT_PERSPECTIVE_DISTANCE / safeDepth),
        MIN_PROJECTED_SCALE,
        MAX_PROJECTED_SCALE,
      ),
    };
  }

  screenToWorld(screenX: number, screenY: number, depth: number): Vec3 {
    const basis = cameraBasis(this.state);
    const centerX = this.viewport.width / 2;
    const centerY = this.viewport.height / 2;
    const safeDepth = Math.max(0.0001, depth);
    const scale = this.state.projection === 'orthographic'
      ? this.state.zoom
      : Math.max(1, this.viewport.height) * this.state.zoom / safeDepth;
    return add(
      this.state.position,
      add(
        scaleVector(basis.forward, safeDepth),
        add(
          scaleVector(basis.right, (screenX - centerX) / Math.max(0.0001, scale)),
          scaleVector(basis.up, (screenY - centerY) / Math.max(0.0001, scale)),
        ),
      ),
    );
  }

  panByPixels(deltaX: number, deltaY: number): void {
    const basis = cameraBasis(this.state);
    const targetDepth = Math.max(0.0001, distance(this.state.position, this.state.target));
    const pixelsPerWorldUnit = this.state.projection === 'orthographic'
      ? this.state.zoom
      : Math.max(1, this.viewport.height) * this.state.zoom / targetDepth;
    const translation = add(
      scaleVector(basis.right, deltaX / Math.max(0.0001, pixelsPerWorldUnit)),
      scaleVector(basis.up, deltaY / Math.max(0.0001, pixelsPerWorldUnit)),
    );
    this.state = {
      ...this.state,
      position: add(this.state.position, translation),
      target: add(this.state.target, translation),
    };
  }

  /** Preserve framing while inheriting a world-space translation. */
  translateBy(delta: Vec3): void {
    if (![delta.x, delta.y, delta.z].every(Number.isFinite)) return;
    this.state = {
      ...this.state,
      position: add(this.state.position, delta),
      target: add(this.state.target, delta),
    };
  }

  orbitByPixels(deltaX: number, deltaY: number): void {
    if (this.dimensions !== '3d' || this.state.projection !== 'perspective') return;
    const basis = cameraBasis(this.state);
    const yaw = -deltaX * 0.005;
    const pitch = -deltaY * 0.005;
    let offset = subtract(this.state.position, this.state.target);
    let up = this.state.up;
    offset = rotateAroundAxis(offset, basis.up, yaw);
    const yawedForward = normalize(scaleVector(offset, -1));
    const yawedRight = normalize(cross(yawedForward, basis.up));
    const pitchedOffset = rotateAroundAxis(offset, yawedRight, pitch);
    const pitchedUp = normalize(rotateAroundAxis(up, yawedRight, pitch));
    const nextForward = normalize(scaleVector(pitchedOffset, -1));
    if (Math.abs(dot(nextForward, pitchedUp)) > 0.999) return;
    this.state = {
      ...this.state,
      position: add(this.state.target, pitchedOffset),
      up: pitchedUp,
    };
  }

  zoomByWheel(deltaY: number, anchor?: { readonly x: number; readonly y: number }): void {
    const validAnchor = anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y) ? anchor : undefined;
    const anchorWorld = validAnchor && this.viewport.width > 0 && this.viewport.height > 0
      ? this.screenToWorld(validAnchor.x, validAnchor.y, this.worldToScreen(this.state.target).depth)
      : undefined;
    if (this.state.projection === 'perspective') {
      const offset = subtract(this.state.position, this.state.target);
      const currentDistance = Math.max(0.0001, length(offset));
      const nextDistance = clamp(
        currentDistance * Math.exp(deltaY * 0.0015),
        MIN_PERSPECTIVE_DISTANCE,
        MAX_PERSPECTIVE_DISTANCE,
      );
      this.state = {
        ...this.state,
        position: add(this.state.target, scaleVector(offset, nextDistance / currentDistance)),
      };
      this.preserveAnchor(validAnchor, anchorWorld);
      return;
    }
    const zoom = clamp(this.state.zoom * Math.exp(-deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM);
    this.state = { ...this.state, zoom };
    this.preserveAnchor(validAnchor, anchorWorld);
  }

  private preserveAnchor(
    anchor: { readonly x: number; readonly y: number } | undefined,
    before: Vec3 | undefined,
  ): void {
    if (!anchor || !before) return;
    const depth = this.worldToScreen(this.state.target).depth;
    const after = this.screenToWorld(anchor.x, anchor.y, depth);
    const translation = subtract(before, after);
    this.state = {
      ...this.state,
      position: add(this.state.position, translation),
      target: add(this.state.target, translation),
    };
  }

  setPerspectiveZoom(zoom: number): void {
    if (this.state.projection !== 'perspective') return;
    const nextZoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const previousZoom = Math.max(MIN_ZOOM, this.state.zoom);
    const offset = subtract(this.state.position, this.state.target);
    this.state = {
      ...this.state,
      position: add(this.state.target, scaleVector(offset, nextZoom / previousZoom)),
      zoom: nextZoom,
    };
  }

  setTarget(target: Vec3, preserveView = true): void {
    const translation = subtract(target, this.state.target);
    this.state = {
      ...this.state,
      target: { ...target },
      position: preserveView ? add(this.state.position, translation) : this.state.position,
    };
  }

  fit(
    positions: readonly Vec3[],
    paddingPx = 48,
    maxMagnification?: number,
    center?: Vec3,
    minimumRadius = 0,
  ): void {
    if (!positions.length || this.viewport.width <= 0 || this.viewport.height <= 0) return;
    const bounds = graphBounds(positions);
    const target = center ? { ...center } : {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    };
    if (this.state.projection === 'orthographic') {
      const width = Math.max(1, minimumRadius * 2, center
        ? 2 * Math.max(...positions.map((position) => Math.abs(position.x - target.x)))
        : bounds.max.x - bounds.min.x);
      const height = Math.max(1, minimumRadius * 2, center
        ? 2 * Math.max(...positions.map((position) => Math.abs(position.y - target.y)))
        : bounds.max.y - bounds.min.y);
      let zoom = clamp(Math.min(
        Math.max(1, this.viewport.width - paddingPx * 2) / width,
        Math.max(1, this.viewport.height - paddingPx * 2) / height,
      ), MIN_ZOOM, MAX_ZOOM);
      if (maxMagnification !== undefined && Number.isFinite(maxMagnification) && maxMagnification > 0) {
        zoom = Math.min(zoom, this.state.zoom * maxMagnification);
      }
      const offset = subtract(this.state.position, this.state.target);
      this.state = { ...this.state, target, position: add(target, offset), zoom };
      return;
    }

    const radius = Math.max(1, minimumRadius, ...positions.map((position) => distance(position, target)));
    const backwards = normalize(subtract(this.state.position, this.state.target));
    let distanceForFit = Math.max(10, radius * 2.4 * Math.max(MIN_ZOOM, this.state.zoom));
    if (maxMagnification !== undefined && Number.isFinite(maxMagnification) && maxMagnification > 0) {
      const currentDistance = Math.max(MIN_PERSPECTIVE_DISTANCE, distance(this.state.position, this.state.target));
      distanceForFit = Math.max(distanceForFit, currentDistance / maxMagnification);
    }
    this.state = {
      ...this.state,
      target,
      position: add(target, scaleVector(backwards, distanceForFit)),
    };
  }
}

interface CameraBasis {
  readonly right: Vec3;
  readonly up: Vec3;
  readonly forward: Vec3;
}

function cameraBasis(state: GraphCameraStateV1): CameraBasis {
  const forward = normalize(subtract(state.target, state.position));
  let right = cross(forward, normalize(state.up));
  if (length(right) < 0.0001) right = { x: 1, y: 0, z: 0 };
  right = normalize(right);
  const up = normalize(cross(right, forward));
  return { right, up, forward };
}

function graphBounds(positions: readonly Vec3[]): { min: Vec3; max: Vec3 } {
  const min = { ...positions[0] };
  const max = { ...positions[0] };
  for (const position of positions.slice(1)) {
    min.x = Math.min(min.x, position.x);
    min.y = Math.min(min.y, position.y);
    min.z = Math.min(min.z, position.z);
    max.x = Math.max(max.x, position.x);
    max.y = Math.max(max.y, position.y);
    max.z = Math.max(max.z, position.z);
  }
  return { min, max };
}

function rotateAroundAxis(vector: Vec3, axis: Vec3, angle: number): Vec3 {
  const unit = normalize(axis);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return add(
    add(scaleVector(vector, cosine), scaleVector(cross(unit, vector), sine)),
    scaleVector(unit, dot(unit, vector) * (1 - cosine)),
  );
}

function cloneCamera(state: GraphCameraStateV1): GraphCameraStateV1 {
  return {
    position: { ...state.position },
    target: { ...state.target },
    up: { ...state.up },
    zoom: state.zoom,
    projection: state.projection,
  };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scaleVector(vector: Vec3, scalar: number): Vec3 {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length(vector: Vec3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function distance(a: Vec3, b: Vec3): number {
  return length(subtract(a, b));
}

function normalize(vector: Vec3): Vec3 {
  const magnitude = length(vector);
  return magnitude > 0.000001 ? scaleVector(vector, 1 / magnitude) : { x: 0, y: 0, z: -1 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
