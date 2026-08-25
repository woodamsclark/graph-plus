import type {
  GraphCameraStateV1,
  GraphDimensionsV1,
  GraphDocumentV1,
  GraphFilterRequestV1,
  GraphViewStateV1,
  JsonValue,
  Vec3,
} from '../../contracts/v1/index.ts';
import { validateGraphFilterRequestV1 } from '../filter/index.ts';

export interface GraphViewStateValidationErrorV1 {
  readonly path: string;
  readonly message: string;
}

export class InvalidGraphViewStateErrorV1 extends Error {
  readonly errors: readonly GraphViewStateValidationErrorV1[];

  constructor(errors: readonly GraphViewStateValidationErrorV1[]) {
    super(errors.map((entry) => `${entry.path}: ${entry.message}`).join('; '));
    this.name = 'InvalidGraphViewStateErrorV1';
    this.errors = errors;
  }
}

export interface GraphViewStateRestoreContextV1 {
  readonly document: GraphDocumentV1;
  readonly consumerId: string;
  readonly profileId: string;
  readonly dimensions: GraphDimensionsV1;
}

export function validateGraphViewStateV1(value: unknown): readonly GraphViewStateValidationErrorV1[] {
  const errors: GraphViewStateValidationErrorV1[] = [];
  if (!isRecord(value)) return [{ path: '$', message: 'View state must be an object.' }];
  validateKnownKeys(value, [
    'schemaVersion',
    'documentId',
    'documentRevision',
    'consumerId',
    'profileId',
    'dimensions',
    'positions',
    'pinnedNodeIds',
    'camera',
    'selectedNodeIds',
    'focusedNodeId',
    'activeFilters',
    'moduleState',
  ], '$', errors);
  if (value.schemaVersion !== 1) errors.push({ path: '$.schemaVersion', message: 'Expected schema version 1.' });
  validateId(value.documentId, '$.documentId', errors);
  validateNonNegativeInteger(value.documentRevision, '$.documentRevision', errors);
  validateId(value.consumerId, '$.consumerId', errors);
  validateId(value.profileId, '$.profileId', errors);
  if (value.dimensions !== '2d' && value.dimensions !== '3d') {
    errors.push({ path: '$.dimensions', message: 'Dimensions must be 2d or 3d.' });
  }
  validatePositions(value.positions, '$.positions', errors);
  validateIdArray(value.pinnedNodeIds, '$.pinnedNodeIds', errors);
  validateCamera(value.camera, '$.camera', errors);
  validateIdArray(value.selectedNodeIds, '$.selectedNodeIds', errors);
  if (value.focusedNodeId !== undefined) validateId(value.focusedNodeId, '$.focusedNodeId', errors);
  validateFilters(value.activeFilters, '$.activeFilters', errors);
  validateModuleState(value.moduleState, '$.moduleState', errors);
  return errors;
}

export function assertGraphViewStateV1(value: unknown): asserts value is GraphViewStateV1 {
  const errors = validateGraphViewStateV1(value);
  if (errors.length) throw new InvalidGraphViewStateErrorV1(errors);
}

export function cloneGraphViewStateV1(state: GraphViewStateV1): GraphViewStateV1 {
  assertGraphViewStateV1(state);
  return {
    schemaVersion: 1,
    documentId: state.documentId,
    documentRevision: state.documentRevision,
    consumerId: state.consumerId,
    profileId: state.profileId,
    dimensions: state.dimensions,
    positions: Object.fromEntries(Object.entries(state.positions).map(([id, position]) => [id, { ...position }])),
    pinnedNodeIds: [...state.pinnedNodeIds],
    camera: cloneCamera(state.camera),
    selectedNodeIds: [...state.selectedNodeIds],
    ...(state.focusedNodeId === undefined ? {} : { focusedNodeId: state.focusedNodeId }),
    activeFilters: Object.fromEntries(
      Object.entries(state.activeFilters).map(([scope, filter]) => [scope, cloneFilter(filter)]),
    ),
    moduleState: cloneJsonRecord(state.moduleState),
  };
}

export interface GraphViewDimensionConversionOptionsV1 {
  readonly dimensions: GraphDimensionsV1;
  readonly focalLengthMm?: number;
  readonly viewportHeight?: number;
}

export function convertGraphViewStateDimensionsV1(
  state: GraphViewStateV1,
  options: GraphViewDimensionConversionOptionsV1,
): GraphViewStateV1 {
  assertGraphViewStateV1(state);
  if (state.dimensions === options.dimensions) return cloneGraphViewStateV1(state);
  const dimensions = options.dimensions;
  const positions = Object.fromEntries(Object.entries(state.positions).map(([id, position], index) => [
    id,
    dimensions === '2d'
      ? { x: position.x, y: position.y, z: 0 }
      : { x: position.x, y: position.y, z: seededDepth(id, index) },
  ]));
  const focusedPosition = state.focusedNodeId ? positions[state.focusedNodeId] : undefined;
  const targetZ = dimensions === '2d' ? 0 : focusedPosition?.z ?? averageDepth(Object.values(positions));
  const target = { x: state.camera.target.x, y: state.camera.target.y, z: targetZ };
  const viewportHeight = Math.max(1, finitePositive(options.viewportHeight, 360));
  const previousDistance = Math.max(0.0001, distance(state.camera.position, state.camera.target));
  const apparentScale = state.camera.projection === 'orthographic'
    ? state.camera.zoom
    : viewportHeight * state.camera.zoom / previousDistance;
  const camera: GraphCameraStateV1 = dimensions === '2d'
    ? {
        position: { x: target.x, y: target.y, z: 10 },
        target,
        up: { x: 0, y: 1, z: 0 },
        zoom: clamp(apparentScale, 0.02, 40),
        projection: 'orthographic',
      }
    : (() => {
        const zoom = clamp(finitePositive(options.focalLengthMm, 50) / 24, 0.02, 40);
        const cameraDistance = clamp(viewportHeight * zoom / Math.max(0.02, apparentScale), 10, 10_000_000);
        return {
          position: { x: target.x, y: target.y, z: target.z + cameraDistance },
          target,
          up: { x: 0, y: 1, z: 0 },
          zoom,
          projection: 'perspective',
        };
      })();
  return cloneGraphViewStateV1({ ...state, dimensions, positions, camera });
}

export function reconcileGraphViewStateV1(
  state: GraphViewStateV1,
  context: GraphViewStateRestoreContextV1,
): GraphViewStateV1 {
  assertGraphViewStateV1(state);
  const identityErrors: GraphViewStateValidationErrorV1[] = [];
  if (state.documentId !== context.document.documentId) {
    identityErrors.push({ path: '$.documentId', message: 'View state belongs to a different document.' });
  }
  if (state.consumerId !== context.consumerId) {
    identityErrors.push({ path: '$.consumerId', message: 'View state belongs to a different consumer.' });
  }
  if (state.profileId !== context.profileId) {
    identityErrors.push({ path: '$.profileId', message: 'View state belongs to a different profile.' });
  }
  if (state.dimensions !== context.dimensions) {
    identityErrors.push({ path: '$.dimensions', message: 'View state dimensions are incompatible with the profile.' });
  }
  if (identityErrors.length) throw new InvalidGraphViewStateErrorV1(identityErrors);

  const nodeIds = new Set(context.document.nodes.map((node) => node.id));
  const positions = Object.fromEntries(
    Object.entries(state.positions)
      .filter(([id]) => nodeIds.has(id))
      .map(([id, position]) => [id, { ...position }]),
  );
  return {
    ...cloneGraphViewStateV1(state),
    documentRevision: context.document.revision,
    positions,
    pinnedNodeIds: state.pinnedNodeIds.filter((id) => nodeIds.has(id)),
    selectedNodeIds: state.selectedNodeIds.filter((id) => nodeIds.has(id)),
    focusedNodeId: state.focusedNodeId && nodeIds.has(state.focusedNodeId) ? state.focusedNodeId : undefined,
  };
}

function validatePositions(value: unknown, path: string, errors: GraphViewStateValidationErrorV1[]): void {
  if (!isRecord(value)) {
    errors.push({ path, message: 'Positions must be an object.' });
    return;
  }
  for (const [id, position] of Object.entries(value)) {
    validateId(id, `${path}.${id}`, errors);
    validateVec3(position, `${path}.${id}`, errors);
  }
}

function validateCamera(value: unknown, path: string, errors: GraphViewStateValidationErrorV1[]): void {
  if (!isRecord(value)) {
    errors.push({ path, message: 'Camera must be an object.' });
    return;
  }
  validateKnownKeys(value, ['position', 'target', 'up', 'zoom', 'projection'], path, errors);
  validateVec3(value.position, `${path}.position`, errors);
  validateVec3(value.target, `${path}.target`, errors);
  validateVec3(value.up, `${path}.up`, errors);
  if (!isFiniteNumber(value.zoom) || value.zoom <= 0) errors.push({ path: `${path}.zoom`, message: 'Zoom must be a positive finite number.' });
  if (value.projection !== 'orthographic' && value.projection !== 'perspective') {
    errors.push({ path: `${path}.projection`, message: 'Projection must be orthographic or perspective.' });
  }
}

function validateFilters(value: unknown, path: string, errors: GraphViewStateValidationErrorV1[]): void {
  if (!isRecord(value)) {
    errors.push({ path, message: 'Active filters must be an object.' });
    return;
  }
  validateKnownKeys(value, ['render', 'projection'], path, errors);
  for (const scope of ['render', 'projection'] as const) {
    const filter = value[scope];
    if (filter === undefined) continue;
    for (const filterError of validateGraphFilterRequestV1(filter)) {
      errors.push({ path: `${path}.${scope}${filterError.path.slice(1)}`, message: filterError.message });
    }
    if (isRecord(filter) && filter.scope !== scope) {
      errors.push({ path: `${path}.${scope}.scope`, message: 'Stored filter scope must match its key.' });
    }
  }
}

function validateModuleState(value: unknown, path: string, errors: GraphViewStateValidationErrorV1[]): void {
  if (!isRecord(value)) {
    errors.push({ path, message: 'Module state must be an object.' });
    return;
  }
  for (const [moduleId, state] of Object.entries(value)) {
    validateId(moduleId, `${path}.${moduleId}`, errors);
    if (!isJsonValue(state)) errors.push({ path: `${path}.${moduleId}`, message: 'Module state must be JSON-serializable.' });
  }
}

function validateVec3(value: unknown, path: string, errors: GraphViewStateValidationErrorV1[]): void {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.z)) {
    errors.push({ path, message: 'Expected finite x, y, and z numbers.' });
    return;
  }
  validateKnownKeys(value, ['x', 'y', 'z'], path, errors);
}

function validateId(value: unknown, path: string, errors: GraphViewStateValidationErrorV1[]): void {
  if (typeof value !== 'string' || value.trim().length === 0) errors.push({ path, message: 'Expected a non-empty string.' });
}

function validateIdArray(value: unknown, path: string, errors: GraphViewStateValidationErrorV1[]): void {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || id.trim().length === 0)) {
    errors.push({ path, message: 'Expected an array of non-empty IDs.' });
  }
}

function validateNonNegativeInteger(value: unknown, path: string, errors: GraphViewStateValidationErrorV1[]): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) errors.push({ path, message: 'Expected a non-negative safe integer.' });
}

function validateKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: GraphViewStateValidationErrorV1[],
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push({ path: `${path}.${key}`, message: `Unknown view-state field "${key}".` });
  }
}

function cloneCamera(camera: GraphCameraStateV1): GraphCameraStateV1 {
  return {
    position: { ...camera.position },
    target: { ...camera.target },
    up: { ...camera.up },
    zoom: camera.zoom,
    projection: camera.projection,
  };
}

function seededDepth(id: string, index: number): number {
  let hash = 2166136261;
  for (let offset = 0; offset < id.length; offset += 1) {
    hash ^= id.charCodeAt(offset);
    hash = Math.imul(hash, 16777619);
  }
  const bucket = ((hash >>> 0) + index * 47) % 121;
  return bucket - 60;
}

function averageDepth(positions: readonly Vec3[]): number {
  if (!positions.length) return 0;
  return positions.reduce((total, position) => total + position.z, 0) / positions.length;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cloneFilter(filter: GraphFilterRequestV1): GraphFilterRequestV1 {
  return JSON.parse(JSON.stringify(filter)) as GraphFilterRequestV1;
}

function cloneJsonRecord(value: Readonly<Record<string, JsonValue>>): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]));
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value !== null && typeof value === 'object') return cloneJsonRecord(value as Readonly<Record<string, JsonValue>>);
  return value;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (isFiniteNumber(value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
