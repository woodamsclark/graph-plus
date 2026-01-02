var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/plugin/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => GraphPlus
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/plugin/GraphView.ts
var import_obsidian2 = require("obsidian");

// src/graph/GraphController.ts
var import_obsidian = require("obsidian");

// src/settings/settingsStore.ts
var currentSettings;
var listeners = /* @__PURE__ */ new Set();
function initSettings(initial) {
  currentSettings = initial;
}
function getSettings() {
  return currentSettings;
}
function updateSettings(mutator) {
  mutator(currentSettings);
  for (const l of listeners)
    l();
}

// src/graph/renderer.ts
function createRenderer(canvas, camera) {
  const context = canvas.getContext("2d");
  let settings = getSettings();
  let mousePosition = null;
  let graph = null;
  let nodeById = /* @__PURE__ */ new Map();
  let theme = buildThemeSnapshot();
  const nodeMap = /* @__PURE__ */ new Map();
  let followedNodeId = null;
  function render() {
    if (!context)
      return;
    settings = getSettings();
    context.fillStyle = theme.colors.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!graph)
      return;
    nodeMap.clear();
    for (const node of graph.nodes) {
      nodeMap.set(node.id, camera.worldToScreen(node));
    }
    drawEdges(nodeMap);
    drawNodes(nodeMap);
    drawLabels(nodeMap);
  }
  function destroy() {
    graph = null;
    nodeById.clear();
  }
  function drawEdges(nodeMap2) {
    if (!context || !graph || !graph.edges)
      return;
    const edges = graph.edges;
    context.save();
    context.strokeStyle = theme.colors.edge;
    context.globalAlpha = theme.colors.edgeAlpha;
    context.lineWidth = 1;
    context.lineCap = "round";
    for (const edge of edges) {
      const src = nodeById.get(edge.sourceId);
      const tgt = nodeById.get(edge.targetId);
      if (!src || !tgt)
        continue;
      const p1 = nodeMap2.get(edge.sourceId);
      const p2 = nodeMap2.get(edge.targetId);
      if (!p1 || !p2)
        continue;
      if (p1.depth < 0 || p2.depth < 0)
        continue;
      context.beginPath();
      context.moveTo(p1.x, p1.y);
      context.lineTo(p2.x, p2.y);
      context.stroke();
    }
    context.restore();
  }
  function drawNodes(nodeMap2) {
    if (!context || !graph || !graph.nodes)
      return;
    const nodes = graph.nodes;
    context.save();
    const nodeColor = theme.colors.node;
    const tagColor = theme.colors.tag;
    for (const node of nodes) {
      const p = nodeMap2.get(node.id);
      if (!p || p.depth < 0)
        continue;
      let radius = node.radius;
      const isTag = node.type === "tag";
      const fillColor = isTag ? tagColor : nodeColor;
      context.beginPath();
      context.arc(p.x, p.y, radius, 0, Math.PI * 2);
      context.fillStyle = fillColor;
      context.globalAlpha = 1;
      context.fill();
    }
    context.restore();
  }
  function drawLabels(nodeMap2) {
    if (!context || !graph || !graph.nodes || !mousePosition)
      return;
    if (!settings.graph.showLabels)
      return;
    const R = settings.graph.labelRevealRadius;
    const baseAlpha = 1;
    const sigma = R * 0.5;
    const inv2Sigma2 = 1 / (2 * sigma * sigma);
    const offsetY = 10;
    const fontSize = settings.graph.labelFontSize;
    context.save();
    context.font = `${fontSize}px ${theme.fonts.interface}`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillStyle = theme.colors.label;
    for (const node of graph.nodes) {
      const p = nodeMap2.get(node.id);
      if (!p || p.depth < 0)
        continue;
      const dx = p.x - mousePosition.x;
      const dy = p.y - mousePosition.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > R * R)
        continue;
      const a = baseAlpha * Math.exp(-d2 * inv2Sigma2);
      if (a < 0.01)
        continue;
      context.globalAlpha = a;
      context.fillText(node.label, p.x, p.y + node.radius + offsetY);
    }
    if (followedNodeId) {
      const pFollow = nodeMap2.get(followedNodeId);
      if (pFollow && pFollow.depth >= 0) {
        context.globalAlpha = 1;
        const followedNode = nodeById.get(followedNodeId);
        const r = followedNode?.radius ?? 0;
        context.fillText(
          followedNode?.label ?? "",
          pFollow.x,
          pFollow.y + r + offsetY
        );
      }
    }
    context.restore();
  }
  function setGraph(data) {
    graph = data;
    nodeById.clear();
    if (!data)
      return;
    for (const node of data.nodes) {
      nodeById.set(node.id, node);
    }
    const counts = data.nodes.reduce(
      (acc, n) => {
        acc[n.type] = (acc[n.type] ?? 0) + 1;
        return acc;
      },
      {}
    );
  }
  function buildThemeSnapshot() {
    return {
      fonts: readFonts(),
      colors: readColors()
    };
  }
  function refreshTheme() {
    theme = buildThemeSnapshot();
  }
  function cssVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
  }
  function readFonts() {
    return {
      text: cssVar("--font-text") || "sans-serif",
      interface: cssVar("--font-interface") || "sans-serif",
      mono: cssVar("--font-monospace") || "monospace"
    };
  }
  function readColors() {
    const s = getSettings();
    return {
      background: s.graph.backgroundColor ?? cssVar("--background-primary"),
      edge: s.graph.edgeColor ?? cssVar("--text-normal"),
      node: s.graph.nodeColor ?? cssVar("--interactive-accent"),
      tag: s.graph.tagColor ?? cssVar("--interactive-accent-hover"),
      label: s.graph.labelColor ?? cssVar("--text-muted"),
      edgeAlpha: 0.03
    };
  }
  function resize(width, height) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, Math.floor(width));
    const cssH = Math.max(1, Math.floor(height));
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    camera.setViewport(cssW, cssH);
    render();
  }
  function setMouseScreenPosition(pos) {
    mousePosition = pos;
  }
  function setFollowedNode(id) {
    followedNodeId = id;
  }
  const renderer = {
    resize,
    render,
    destroy,
    setGraph,
    refreshTheme,
    setMouseScreenPosition,
    setFollowedNode
  };
  return renderer;
}

// src/graph/simulation.ts
function createSimulation(graph, camera, getMousePos) {
  const nodes = graph.nodes;
  const edges = graph.edges;
  let running = false;
  let pinnedNodes = /* @__PURE__ */ new Set();
  const nodeById = /* @__PURE__ */ new Map();
  for (const n of nodes)
    nodeById.set(n.id, n);
  function makeOctNode(cx, cy, cz, h) {
    return {
      cx,
      cy,
      cz,
      h,
      mass: 0,
      comX: 0,
      comY: 0,
      comZ: 0,
      body: null,
      children: null
    };
  }
  function childIndex(cell, x, y, z) {
    let idx = 0;
    if (x >= cell.cx)
      idx |= 1;
    if (y >= cell.cy)
      idx |= 2;
    if (z >= cell.cz)
      idx |= 4;
    return idx;
  }
  function ensureChildren(cell) {
    if (!cell.children)
      cell.children = new Array(8).fill(null);
  }
  function getOrCreateChild(cell, idx) {
    ensureChildren(cell);
    let child = cell.children[idx];
    if (child)
      return child;
    const h2 = cell.h * 0.5;
    const ox = idx & 1 ? h2 : -h2;
    const oy = idx & 2 ? h2 : -h2;
    const oz = idx & 4 ? h2 : -h2;
    child = makeOctNode(cell.cx + ox, cell.cy + oy, cell.cz + oz, h2);
    cell.children[idx] = child;
    return child;
  }
  function buildOctree(bodies) {
    if (!bodies.length)
      return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const n of bodies) {
      if (n.x < minX)
        minX = n.x;
      if (n.y < minY)
        minY = n.y;
      if (n.z < minZ)
        minZ = n.z;
      if (n.x > maxX)
        maxX = n.x;
      if (n.y > maxY)
        maxY = n.y;
      if (n.z > maxZ)
        maxZ = n.z;
    }
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const dx = maxX - minX;
    const dy = maxY - minY;
    const dz = maxZ - minZ;
    const h = Math.max(dx, dy, dz) * 0.5 + 1e-3;
    const root = makeOctNode(cx, cy, cz, h);
    for (const b of bodies) {
      insertBody(root, b);
    }
    return root;
  }
  function insertBody(cell, body) {
    const m0 = cell.mass;
    const m1 = m0 + 1;
    cell.comX = (cell.comX * m0 + body.x) / m1;
    cell.comY = (cell.comY * m0 + body.y) / m1;
    cell.comZ = (cell.comZ * m0 + body.z) / m1;
    cell.mass = m1;
    if (!cell.children && cell.body === null) {
      cell.body = body;
      return;
    }
    if (!cell.children && cell.body !== null) {
      const existing = cell.body;
      cell.body = null;
      ensureChildren(cell);
      insertIntoChild(cell, existing);
      insertIntoChild(cell, body);
      return;
    }
    insertIntoChild(cell, body);
  }
  function insertIntoChild(cell, body) {
    const idx = childIndex(cell, body.x, body.y, body.z);
    const child = getOrCreateChild(cell, idx);
    insertBody(child, body);
  }
  function applyRepulsionBarnesHut(physicsSettings, root) {
    const strength = physicsSettings.repulsionStrength;
    const minDist = 40;
    const minDistSq = minDist * minDist;
    const theta = 0.8;
    const thetaSq = theta * theta;
    const eps = 1e-3;
    for (const a of nodes) {
      if (pinnedNodes.has(a.id))
        continue;
      accumulateBH(a, root, strength, thetaSq, minDistSq, eps);
    }
  }
  function accumulateBH(a, cell, strength, thetaSq, minDistSq, eps) {
    if (cell.mass === 0)
      return;
    if (!cell.children && cell.body === a)
      return;
    const dx = a.x - cell.comX;
    const dy = a.y - cell.comY;
    const dz = (a.z || 0) - (cell.comZ || 0);
    const distSqRaw = dx * dx + dy * dy + dz * dz + eps;
    const size = cell.h * 2;
    const sizeSq = size * size;
    const isFarEnough = !cell.children || sizeSq / distSqRaw < thetaSq;
    if (isFarEnough) {
      const distSq = Math.max(distSqRaw, minDistSq);
      const dist = Math.sqrt(distSqRaw);
      const safeDist = dist > 0 ? dist : 1e-3;
      const force = strength * cell.mass / distSq;
      const fx = dx / safeDist * force;
      const fy = dy / safeDist * force;
      const fz = dz / safeDist * force;
      a.vx = (a.vx || 0) + fx;
      a.vy = (a.vy || 0) + fy;
      a.vz = (a.vz || 0) + fz;
      return;
    }
    const kids = cell.children;
    if (!kids)
      return;
    for (let i = 0; i < 8; i++) {
      const c = kids[i];
      if (c)
        accumulateBH(a, c, strength, thetaSq, minDistSq, eps);
    }
  }
  function setPinnedNodes(ids) {
    pinnedNodes = new Set(ids);
  }
  function applyMouseGravity(physicsSettings) {
    if (!physicsSettings.mouseGravityEnabled)
      return;
    const mousePos = getMousePos();
    if (!mousePos)
      return;
    const { x: mouseX, y: mouseY } = mousePos;
    const radius = physicsSettings.mouseGravityRadius;
    const strength = physicsSettings.mouseGravityStrength;
    for (const node of nodes) {
      if (pinnedNodes.has(node.id))
        continue;
      const nodePos = camera.worldToScreen(node);
      if (nodePos.depth < 0)
        continue;
      const dx = mouseX - nodePos.x;
      const dy = mouseY - nodePos.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > radius * radius)
        continue;
      const targetWorld = camera.screenToWorld(mouseX, mouseY, nodePos.depth);
      const wx = targetWorld.x - node.x;
      const wy = targetWorld.y - node.y;
      const wz = targetWorld.z - node.z;
      const dist = Math.sqrt(wx * wx + wy * wy + wz * wz) + 1e-6;
      const maxBoost = 1 / node.radius;
      const boost = Math.min(maxBoost, 1 / (dist * dist));
      const k = strength * boost;
      node.vx += wx * k;
      node.vy += wy * k;
      node.vz += wz * k;
    }
  }
  function applyRepulsion(physicsSettings) {
    const N = nodes.length;
    for (let i = 0; i < N; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < N; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dz = (a.z || 0) - (b.z || 0);
        let distSq = dx * dx + dy * dy + dz * dz;
        if (distSq === 0)
          distSq = 1e-4;
        const dist = Math.sqrt(distSq);
        const minDist = 40;
        const effectiveDist = Math.max(dist, minDist);
        const force = physicsSettings.repulsionStrength / (effectiveDist * effectiveDist);
        const fx = dx / dist * force;
        const fy = dy / dist * force;
        const fz = dz / dist * force;
        if (!pinnedNodes.has(a.id)) {
          a.vx = (a.vx || 0) + fx;
          a.vy = (a.vy || 0) + fy;
          a.vz = (a.vz || 0) + fz;
        }
        if (!pinnedNodes.has(b.id)) {
          b.vx = (b.vx || 0) - fx;
          b.vy = (b.vy || 0) - fy;
          b.vz = (b.vz || 0) - fz;
        }
      }
    }
  }
  function applySprings(physicsSettings) {
    if (!edges)
      return;
    for (const e of edges) {
      const a = nodeById.get(e.sourceId);
      const b = nodeById.get(e.targetId);
      if (!a || !b)
        continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = (b.z || 0) - (a.z || 0);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
      const displacement = dist - (physicsSettings.springLength || 0);
      const f = (physicsSettings.springStrength || 0) * Math.tanh(displacement / 50);
      const fx = dx / dist * f;
      const fy = dy / dist * f;
      const fz = dz / dist * f;
      if (!pinnedNodes.has(a.id)) {
        a.vx = (a.vx || 0) + fx;
        a.vy = (a.vy || 0) + fy;
        a.vz = (a.vz || 0) + fz;
      }
      if (!pinnedNodes.has(b.id)) {
        b.vx = (b.vx || 0) - fx;
        b.vy = (b.vy || 0) - fy;
        b.vz = (b.vz || 0) - fz;
      }
    }
  }
  function applyCentering(physicsSettings) {
    if (physicsSettings.centerPull <= 0)
      return;
    const cx = physicsSettings.worldCenterX;
    const cy = physicsSettings.worldCenterY;
    const cz = physicsSettings.worldCenterZ;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id))
        continue;
      const dx = cx - n.x;
      const dy = cy - n.y;
      const dz = cz - n.z;
      n.vx = (n.vx || 0) + dx * physicsSettings.centerPull;
      n.vy = (n.vy || 0) + dy * physicsSettings.centerPull;
      n.vz = (n.vz || 0) + dz * physicsSettings.centerPull;
    }
  }
  function applyDamping(physicsSettings) {
    for (const n of nodes) {
      if (pinnedNodes.has(n.id))
        continue;
      const d = Math.max(0, Math.min(1, physicsSettings.damping));
      n.vx = (n.vx ?? 0) * (1 - d);
      n.vy = (n.vy ?? 0) * (1 - d);
      n.vz = (n.vz ?? 0) * (1 - d);
      if (Math.abs(n.vx) < 1e-3)
        n.vx = 0;
      if (Math.abs(n.vy) < 1e-3)
        n.vy = 0;
      if (Math.abs(n.vz) < 1e-3)
        n.vz = 0;
    }
  }
  function applyPlaneConstraints(physicsSettings) {
    const noteK = physicsSettings.notePlaneStiffness;
    const tagK = physicsSettings.tagPlaneStiffness;
    if (noteK === 0 && tagK === 0)
      return;
    const targetZ = physicsSettings.worldCenterZ;
    const targetX = physicsSettings.worldCenterX;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id))
        continue;
      if (isNote(n) && noteK > 0) {
        const dz = targetZ - n.z;
        n.vz = (n.vz || 0) + dz * noteK;
      } else if (isTag(n) && tagK > 0) {
        const dx = targetX - (n.x || 0);
        n.vx = (n.vx || 0) + dx * tagK;
      }
    }
  }
  function integrate(dt) {
    const scale = dt * 60;
    for (const n of nodes) {
      if (pinnedNodes.has(n.id))
        continue;
      n.x += (n.vx || 0) * scale;
      n.y += (n.vy || 0) * scale;
      n.z = (n.z || 0) + (n.vz || 0) * scale;
      if (isTag(n) && Math.abs(n.x) < 1e-4)
        n.x = 0;
    }
  }
  function start() {
    running = true;
  }
  function stop() {
    running = false;
  }
  function reset() {
    for (const n of nodes) {
      n.vx = 0;
      n.vy = 0;
    }
  }
  function isTag(n) {
    return n.type === "tag";
  }
  function isNote(n) {
    return n.type === "note";
  }
  function tick(dt) {
    if (!running)
      return;
    if (!nodes.length)
      return;
    const settings = getSettings();
    const physicsSettings = settings.physics;
    const root = buildOctree(nodes);
    if (!root)
      return;
    applyRepulsionBarnesHut(physicsSettings, root);
    applySprings(physicsSettings);
    applyMouseGravity(physicsSettings);
    applyCentering(physicsSettings);
    applyPlaneConstraints(physicsSettings);
    applyDamping(physicsSettings);
    integrate(dt);
  }
  return { start, stop, tick, reset, setPinnedNodes };
}

// src/graph/InputManager.ts
var InputManager = class {
  canvas;
  callback;
  draggedNodeId = null;
  lastClientX = 0;
  // (( Client Space ))
  lastClientY = 0;
  // (( Client Space ))
  downClickX = 0;
  // [[ Canvas Space ]]
  downClickY = 0;
  // [[ Canvas Space ]]
  dragThreshold = 5;
  // Drag starts after 5 pixels of movement
  pointerMode = 0 /* Idle */;
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.callback = callbacks;
    this.attachListeners();
  }
  attachListeners() {
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    this.canvas.addEventListener("wheel", this.onWheel);
    this.canvas.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("mouseleave", this.onMouseLeave);
    document.addEventListener("mousemove", this.onGlobalMouseMove);
    document.addEventListener("mouseup", this.onGlobalMouseUp);
  }
  onMouseDown = (e) => {
    const canvas = this.canvas.getBoundingClientRect();
    this.downClickX = e.clientX - canvas.left;
    this.downClickY = e.clientY - canvas.top;
    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;
    const isLeft = e.button === 0;
    const isMiddle = e.button === 1;
    const isRight = e.button === 2;
    this.draggedNodeId = this.callback.detectClickedNode(this.downClickX, this.downClickY)?.id || null;
    if (isLeft && e.ctrlKey || isLeft && e.metaKey || isRight) {
      this.pointerMode = 3 /* RightClick */;
      return;
    }
    this.pointerMode = 2 /* Click */;
  };
  onGlobalMouseMove = (e) => {
    const clientX = e.clientX;
    const clientY = e.clientY;
    const rect = this.canvas.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    const dx = clientX - this.lastClientX;
    const dy = clientY - this.lastClientY;
    this.lastClientX = clientX;
    this.lastClientY = clientY;
    const dxScr = screenX - this.downClickX;
    const dyScr = screenY - this.downClickY;
    const distSq = dxScr * dxScr + dyScr * dyScr;
    const thresholdSq = this.dragThreshold * this.dragThreshold;
    switch (this.pointerMode) {
      case 0 /* Idle */:
      case 1 /* Hover */:
        return;
      case 2 /* Click */:
        if (distSq > thresholdSq) {
          if (this.draggedNodeId != null) {
            this.pointerMode = 4 /* DragNode */;
            this.callback.onDragStart(this.draggedNodeId, screenX, screenY);
          } else {
            this.pointerMode = 5 /* Pan */;
            this.callback.onPanStart(screenX, screenY);
          }
        }
        return;
      case 4 /* DragNode */:
        this.callback.onDragMove(screenX, screenY);
        return;
      case 5 /* Pan */:
        this.callback.onPanMove(screenX, screenY);
        return;
      case 3 /* RightClick */:
        if (distSq > thresholdSq) {
          this.pointerMode = 6 /* Orbit */;
          this.callback.onOrbitStart(screenX, screenY);
        }
        return;
      case 6 /* Orbit */:
        this.callback.onOrbitMove(screenX, screenY);
        return;
    }
  };
  onGlobalMouseUp = (e) => {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    switch (this.pointerMode) {
      case 4 /* DragNode */:
        this.callback.onDragEnd();
        break;
      case 5 /* Pan */:
        this.callback.onPanEnd();
        break;
      case 6 /* Orbit */:
        this.callback.onOrbitEnd();
        break;
      case 2 /* Click */:
        this.callback.onOpenNode(screenX, screenY);
        break;
      case 3 /* RightClick */:
        if (this.draggedNodeId != null) {
          this.callback.onFollowStart(this.draggedNodeId);
        } else {
          this.callback.resetCamera();
        }
        break;
    }
    this.pointerMode = 0 /* Idle */;
    this.draggedNodeId = null;
  };
  // local canvas mouse move for hover state
  onMouseMove = (e) => {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    this.callback.onMouseMove(screenX, screenY);
  };
  onMouseLeave = () => {
    this.callback.onMouseMove(-Infinity, -Infinity);
  };
  onWheel = (e) => {
    e.preventDefault();
    this.callback.onZoom(e.offsetX, e.offsetY, Math.sign(e.deltaY));
  };
  destroy() {
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("mouseleave", this.onMouseLeave);
    document.removeEventListener("mousemove", this.onGlobalMouseMove);
    document.removeEventListener("mouseup", this.onGlobalMouseUp);
  }
};

// src/graph/CameraController.ts
var MIN_DISTANCE = 100;
var MAX_DISTANCE = 5e3;
var MIN_PITCH = -Math.PI / 2 + 0.05;
var MAX_PITCH = Math.PI / 2 - 0.05;
var CameraController = class {
  cameraSettings;
  cameraState;
  //private renderer       : Renderer;
  cameraSnapShot = null;
  //private worldAnchor     : { screenX: number; screenY: number; screenZ: number }       | null  = null;
  worldAnchor = null;
  screenAnchor = null;
  viewport = { width: 0, height: 0, offsetX: 0, offsetY: 0 };
  worldTransform = null;
  constructor(initialState) {
    this.cameraState = { ...initialState };
    this.cameraSettings = getSettings().camera;
  }
  getState() {
    return { ...this.cameraState };
  }
  setState(next) {
    this.cameraState = { ...next };
  }
  patchState(partial) {
    this.cameraState = { ...this.cameraState, ...partial };
  }
  /** If user changes camera settings in UI */
  updateSettings(settings) {
    this.cameraSettings = { ...settings };
  }
  resetCamera() {
    this.cameraState = { ...getSettings().camera.state };
    this.clearMomentum();
  }
  worldToScreen(node) {
    const { yaw, pitch, distance, targetX, targetY, targetZ } = this.cameraState;
    const { offsetX, offsetY } = this.viewport;
    let wx0 = node.x || 0;
    let wy0 = node.y || 0;
    let wz0 = node.z || 0;
    const wt = this.worldTransform;
    if (wt) {
      wx0 *= wt.scale;
      wy0 *= wt.scale;
      wz0 *= wt.scale;
      const cy = Math.cos(wt.rotationY), sy = Math.sin(wt.rotationY);
      const x1 = wx0 * cy - wz0 * sy;
      const z1 = wx0 * sy + wz0 * cy;
      wx0 = x1;
      wz0 = z1;
      const cx = Math.cos(wt.rotationX), sx = Math.sin(wt.rotationX);
      const y2 = wy0 * cx - wz0 * sx;
      const z2 = wy0 * sx + wz0 * cx;
      wy0 = y2;
      wz0 = z2;
    }
    const wx = wx0 - targetX;
    const wy = wy0 - targetY;
    const wz = wz0 - targetZ;
    const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
    const xz = wx * cosYaw - wz * sinYaw;
    const zz = wx * sinYaw + wz * cosYaw;
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
    const yz = wy * cosP - zz * sinP;
    const zz2 = wy * sinP + zz * cosP;
    const camZ = distance;
    const dz = camZ - zz2;
    const safeDz = Math.max(1e-4, dz);
    const focal = 800;
    const perspective = focal / safeDz;
    return {
      x: xz * perspective + offsetX,
      y: yz * perspective + offsetY,
      depth: dz
    };
  }
  setWorldTransform(t) {
    this.worldTransform = t;
  }
  setViewport(width, height) {
    this.viewport.width = width;
    this.viewport.height = height;
    this.viewport.offsetX = width / 2;
    this.viewport.offsetY = height / 2;
  }
  // Unprojects screen coords to world coords on a plane at camera-distance (for panning)
  screenToWorld(screenX, screenY, dz) {
    const { yaw, pitch, distance: camZ, targetX, targetY, targetZ } = this.cameraState;
    const { offsetX, offsetY } = this.viewport;
    const focal = 800;
    const px = screenX - offsetX;
    const py = screenY - offsetY;
    const perspective = focal / dz;
    const xz = px / perspective;
    const yz = py / perspective;
    const zz2 = camZ - dz;
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
    const wy = yz * cosP + zz2 * sinP;
    const zz = -yz * sinP + zz2 * cosP;
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const wx = xz * cosY + zz * sinY;
    const wz = -xz * sinY + zz * cosY;
    let world = { x: wx + targetX, y: wy + targetY, z: wz + targetZ };
    const wt = this.worldTransform;
    if (wt) {
      const cx = Math.cos(-wt.rotationX), sx = Math.sin(-wt.rotationX);
      const y1 = world.y * cx - world.z * sx;
      const z1 = world.y * sx + world.z * cx;
      world.y = y1;
      world.z = z1;
      const cy = Math.cos(-wt.rotationY), sy = Math.sin(-wt.rotationY);
      const x2 = world.x * cy - world.z * sy;
      const z2 = world.x * sy + world.z * cy;
      world.x = x2;
      world.z = z2;
      const s = wt.scale === 0 ? 1 : wt.scale;
      world.x /= s;
      world.y /= s;
      world.z /= s;
    }
    return world;
  }
  screenToWorld3D(screenX, screenY, depthFromCamera) {
    return this.screenToWorld(screenX, screenY, depthFromCamera);
  }
  screenToWorld2D(screenX, screenY) {
    const cam = this.cameraState;
    const world = this.screenToWorld(screenX, screenY, cam.distance);
    return { x: world.x, y: world.y };
  }
  clearMomentum() {
    this.cameraState.orbitVelX = 0;
    this.cameraState.orbitVelY = 0;
    this.cameraState.panVelX = 0;
    this.cameraState.panVelY = 0;
    this.cameraState.zoomVel = 0;
  }
  startPan(screenX, screenY) {
    const cam = this.cameraState;
    this.screenAnchor = { screenX, screenY };
    this.worldAnchor = this.screenToWorld(screenX, screenY, cam.distance);
  }
  updatePan(screenX, screenY) {
    if (!this.worldAnchor)
      return;
    const cam = this.cameraState;
    const current = this.screenToWorld(screenX, screenY, cam.distance);
    const dx = current.x - this.worldAnchor.x;
    const dy = current.y - this.worldAnchor.y;
    const dz = current.z - this.worldAnchor.z;
    cam.targetX -= dx;
    cam.targetY -= dy;
    cam.targetZ -= dz;
    this.worldAnchor = this.screenToWorld(screenX, screenY, cam.distance);
  }
  endPan() {
    this.screenAnchor = null;
    this.worldAnchor = null;
  }
  startOrbit(screenX, screenY) {
    this.screenAnchor = { screenX, screenY };
    this.cameraSnapShot = { ...this.cameraState };
  }
  updateOrbit(screenX, screenY) {
    const rotateSensitivityX = this.cameraSettings.rotateSensitivityX;
    const rotateSensitivityY = this.cameraSettings.rotateSensitivityY;
    const zoomSensitivity = this.cameraSettings.zoomSensitivity;
    const dx = screenX - this.screenAnchor.screenX;
    const dy = screenY - this.screenAnchor.screenY;
    let yaw = this.cameraSnapShot.yaw - dx * rotateSensitivityX;
    let pitch = this.cameraSnapShot.pitch - dy * rotateSensitivityY;
    const maxPitch = Math.PI / 2;
    const minPitch = -maxPitch;
    if (pitch > maxPitch)
      pitch = maxPitch;
    if (pitch < minPitch)
      pitch = minPitch;
    this.cameraState.yaw = yaw;
    this.cameraState.pitch = pitch;
  }
  endOrbit() {
    this.screenAnchor = null;
    this.cameraSnapShot = null;
  }
  startDrag(nodeId, screenX, screenY) {
  }
  updateDrag(screenX, screenY) {
  }
  endDrag() {
  }
  updateZoom(screenX, screenY, delta) {
    this.cameraState.distance += delta * this.cameraSettings.zoomSensitivity;
  }
  updateHover(screenX, screenY) {
  }
  // Step forward in time for momentum-based smoothing.
  // dtMs is elapsed milliseconds since last frame.
  step(dtMs) {
    const t = dtMs / 16.67;
    const damping = Math.pow(1 - this.cameraSettings.momentumScale, t);
    if (Math.abs(this.cameraState.orbitVelX) > 1e-4 || Math.abs(this.cameraState.orbitVelY) > 1e-4) {
      this.cameraState.yaw += this.cameraState.orbitVelX;
      this.cameraState.pitch += this.cameraState.orbitVelY;
      this.cameraState.pitch = clamp(this.cameraState.pitch, MIN_PITCH, MAX_PITCH);
      this.cameraState.orbitVelX *= damping;
      this.cameraState.orbitVelY *= damping;
    }
    if (Math.abs(this.cameraState.panVelX) > 1e-4 || Math.abs(this.cameraState.panVelY) > 1e-4) {
      this.cameraState.targetX += this.cameraState.panVelX;
      this.cameraState.targetY += this.cameraState.panVelY;
      this.cameraState.panVelX *= damping;
      this.cameraState.panVelY *= damping;
    }
    if (Math.abs(this.cameraState.zoomVel) > 1e-4) {
      this.cameraState.distance = clamp(this.cameraState.distance + this.cameraState.zoomVel, MIN_DISTANCE, MAX_DISTANCE);
      this.cameraState.zoomVel *= damping;
    }
  }
};
function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

// src/graph/GraphInteractor.ts
var GraphInteractor = class {
  constructor(deps) {
    this.deps = deps;
    this.state = {
      mouseScreenPosition: null,
      hoveredId: null,
      draggedId: null,
      followedId: null,
      isPanning: false,
      isRotating: false
    };
  }
  dragWorldOffset = null;
  dragDepthFromCamera = 0;
  pinnedNodes = /* @__PURE__ */ new Set();
  openNodeFile = null;
  state;
  get cursorType() {
    if (this.state.draggedId || this.state.isPanning || this.state.isRotating) {
      return "grabbing";
    }
    if (this.state.hoveredId) {
      return "pointer";
    }
    return "default";
  }
  get mouseScreenPosition() {
    return this.state.mouseScreenPosition;
  }
  updateMouse(screenX, screenY) {
    if (screenX === -Infinity || screenY === -Infinity) {
      this.state.mouseScreenPosition = null;
    } else {
      this.state.mouseScreenPosition = { x: screenX, y: screenY };
    }
  }
  startDrag(nodeId, screenX, screenY) {
    this.endFollow();
    const graph = this.deps.getGraph();
    const camera = this.deps.getCamera();
    if (!graph || !camera)
      return;
    this.deps.enableMouseGravity(false);
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node)
      return;
    const projected = camera.worldToScreen(node);
    this.dragDepthFromCamera = Math.max(1e-4, projected.depth);
    this.state.draggedId = nodeId;
    this.pinnedNodes.add(nodeId);
    this.deps.setPinnedNodes(this.pinnedNodes);
    const underMouse = camera.screenToWorld(screenX, screenY, this.dragDepthFromCamera);
    this.dragWorldOffset = {
      x: node.x - underMouse.x,
      y: node.y - underMouse.y,
      z: (node.z || 0) - underMouse.z
    };
    return;
  }
  updateDrag(screenX, screenY) {
    const camera = this.deps.getCamera();
    const graph = this.deps.getGraph();
    if (!graph || !camera)
      return;
    if (!this.state.draggedId)
      return;
    const node = graph.nodes.find((n) => n.id === this.state.draggedId);
    if (!node)
      return;
    const underMouse = camera.screenToWorld(screenX, screenY, this.dragDepthFromCamera);
    const o = this.dragWorldOffset || { x: 0, y: 0, z: 0 };
    node.x = underMouse.x + o.x;
    node.y = underMouse.y + o.y;
    node.z = underMouse.z + o.z;
    node.vx = 0;
    node.vy = 0;
    node.vz = 0;
    return;
  }
  endDrag() {
    if (!this.state.draggedId)
      return;
    this.pinnedNodes.delete(this.state.draggedId);
    this.deps.setPinnedNodes(this.pinnedNodes);
    this.state.draggedId = null;
    this.dragWorldOffset = null;
    this.deps.enableMouseGravity(true);
    return;
  }
  startPan(screenX, screenY) {
    this.endFollow();
    this.state.isPanning = true;
    this.deps.getCamera()?.startPan(screenX, screenY);
  }
  updatePan(screenX, screenY) {
    this.deps.getCamera()?.updatePan(screenX, screenY);
  }
  endPan() {
    this.state.isPanning = false;
    this.deps.getCamera()?.endPan();
  }
  startOrbit(screenX, screenY) {
    this.state.isRotating = true;
    this.deps.getCamera()?.startOrbit(screenX, screenY);
  }
  updateOrbit(screenX, screenY) {
    this.deps.getCamera()?.updateOrbit(screenX, screenY);
  }
  endOrbit() {
    this.state.isRotating = false;
    this.deps.getCamera()?.endOrbit();
  }
  startFollow(nodeId) {
    this.state.followedId = nodeId;
    this.updateFollow();
  }
  updateFollow() {
    const id = this.state.followedId;
    if (!id)
      return;
    const graph = this.deps.getGraph();
    const camera = this.deps.getCamera();
    if (!graph || !camera)
      return;
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) {
      this.state.followedId = null;
      return;
    }
    camera.patchState({
      targetX: node.x,
      targetY: node.y,
      targetZ: node.z
    });
  }
  endFollow() {
    this.state.followedId = null;
  }
  updateZoom(screenX, screenY, delta) {
    this.deps.getCamera()?.updateZoom(screenX, screenY, delta);
  }
  openNode(screenX, screenY) {
    const node = this.nodeClicked(screenX, screenY);
    if (node && this.openNodeFile) {
      this.openNodeFile(node);
    }
  }
  setOnNodeClick(handler) {
    this.openNodeFile = handler;
  }
  nodeClicked(screenX, screenY) {
    const graph = this.deps.getGraph();
    const camera = this.deps.getCamera();
    if (!graph || !camera)
      return null;
    let closest = null;
    let closestDist = Infinity;
    const hitPadding = 0;
    for (const node of graph.nodes) {
      const projected = camera.worldToScreen(node);
      if (!projected)
        continue;
      const nodeRadius = node.radius;
      const hitR = nodeRadius + hitPadding;
      const dx = screenX - projected.x;
      const dy = screenY - projected.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= hitR * hitR && distSq < closestDist) {
        closestDist = distSq;
        closest = node;
      }
    }
    return closest;
  }
  frame() {
    this.updateFollow();
    this.checkIfHovering();
  }
  checkIfHovering() {
    if (!this.state.mouseScreenPosition) {
      this.state.hoveredId = null;
      return;
    }
    const mouse = this.state.mouseScreenPosition;
    if (!mouse)
      return;
    const hit = this.nodeClicked(mouse.x, mouse.y);
    this.state.hoveredId = hit?.id ?? null;
  }
  get hoveredNodeId() {
    return this.state.hoveredId;
  }
  get followedNodeId() {
    return this.state.followedId;
  }
};

// src/graph/CursorController.ts
function createCursorController(canvas) {
  let applied = "default";
  function apply(css) {
    if (css === applied)
      return;
    applied = css;
    canvas.style.cursor = css;
  }
  function reset() {
    apply("default");
  }
  return {
    apply,
    reset
  };
}

// src/graph/GraphStore.ts
var GraphStore = class {
  deps;
  graph = null;
  cachedState = null;
  constructor(deps) {
    this.deps = deps;
  }
  /** Load-or-generate once and keep it as the single graph instance */
  async init() {
    if (this.graph)
      return this.graph;
    const app = this.deps.getApp();
    const state = await this.loadState(app);
    const graph = this.generateGraph(app);
    if (state)
      this.applyPositions(graph, state);
    this.decorateGraph(graph, app);
    this.graph = graph;
    return graph;
  }
  get() {
    return this.graph;
  }
  async save() {
    if (!this.graph)
      return;
    const app = this.deps.getApp();
    const state = this.extractState(this.graph, app);
    await this.saveState(state);
    this.cachedState = state;
  }
  async rebuild() {
    this.graph = null;
    return await this.init();
  }
  invalidate() {
    this.graph = null;
  }
  // Persistence (data.json)
  async loadState(app) {
    if (this.cachedState)
      return this.cachedState;
    const plugin = this.deps.getPlugin();
    if (!plugin)
      return null;
    const raw = await plugin.loadData().catch(() => null);
    if (!raw)
      return null;
    const vaultId = app.vault.getName();
    const state = raw?.graphStateByVault?.[vaultId] ?? null;
    this.cachedState = state;
    return state;
  }
  async saveState(state) {
    const plugin = this.deps.getPlugin();
    if (!plugin)
      return;
    const raw = await plugin.loadData().catch(() => ({}));
    const next = raw ?? {};
    next.graphStateByVault ??= {};
    next.graphStateByVault[state.vaultId] = state;
    await plugin.saveData(next);
  }
  extractState(graph, app) {
    const vaultId = app.vault.getName();
    const nodePositions = {};
    for (const n of graph.nodes) {
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.z))
        continue;
      nodePositions[n.id] = { x: n.x, y: n.y, z: n.z };
    }
    return { version: 1, vaultId, nodePositions };
  }
  applyPositions(graph, state) {
    const pos = state.nodePositions || {};
    for (const n of graph.nodes) {
      const p = pos[n.id];
      if (!p)
        continue;
      n.x = p.x;
      n.y = p.y;
      n.z = p.z;
      n.vx = 0;
      n.vy = 0;
      n.vz = 0;
    }
  }
  // -----------------------
  // Generation (topology)
  // -----------------------
  generateGraph(app) {
    const settings = getSettings();
    const nodes = this.createNodes(app);
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const edges = [];
    edges.push(...this.createNoteEdges(app, nodeById));
    if (settings.graph.showTags) {
      edges.push(...this.createTagEdges(app, nodeById));
    }
    return { nodes, edges };
  }
  createNodes(app) {
    const settings = getSettings();
    let nodes = [];
    if (settings.graph.showTags)
      nodes = this.createTagNodes(app);
    nodes = nodes.concat(this.createNoteNodes(app));
    return nodes;
  }
  createNoteNodes(app) {
    const files = app.vault.getMarkdownFiles();
    const nodes = [];
    for (const file of files) {
      const jitter = 50;
      nodes.push({
        id: file.path,
        filePath: file.path,
        file,
        label: file.basename,
        x: (Math.random() - 0.5) * jitter,
        y: (Math.random() - 0.5) * jitter,
        z: (Math.random() - 0.5) * jitter,
        vx: 0,
        vy: 0,
        vz: 0,
        type: "note",
        inDegree: 0,
        outDegree: 0,
        totalDegree: 0,
        radius: 0
      });
    }
    return nodes;
  }
  createTagNodes(app) {
    const tags = /* @__PURE__ */ new Set();
    const tagMap = app.metadataCache.getTags?.();
    if (tagMap) {
      for (const rawTag of Object.keys(tagMap)) {
        tags.add(this.normalizeTag(rawTag));
      }
    }
    for (const file of app.vault.getMarkdownFiles()) {
      for (const cleanTag of this.extractTagsFromFile(file, app)) {
        if (cleanTag)
          tags.add(cleanTag);
      }
    }
    const jitter = 50;
    const nodes = [];
    for (const cleanTag of tags) {
      nodes.push({
        id: `tag:${cleanTag}`,
        label: `#${cleanTag}`,
        x: (Math.random() - 0.5) * jitter,
        y: (Math.random() - 0.5) * jitter,
        z: (Math.random() - 0.5) * jitter,
        vx: 0,
        vy: 0,
        vz: 0,
        type: "tag",
        inDegree: 0,
        outDegree: 0,
        totalDegree: 0,
        radius: 0
      });
    }
    return nodes;
  }
  createNoteEdges(app, nodeById) {
    const settings = getSettings();
    const resolved = app.metadataCache.resolvedLinks || {};
    const edges = [];
    const edgeSet = /* @__PURE__ */ new Set();
    const countDuplicates = Boolean(settings.graph.countDuplicateLinks);
    for (const sourcePath of Object.keys(resolved)) {
      const targets = resolved[sourcePath] || {};
      for (const targetPath of Object.keys(targets)) {
        if (!nodeById.has(sourcePath) || !nodeById.has(targetPath))
          continue;
        const key = `${sourcePath}->${targetPath}`;
        if (edgeSet.has(key))
          continue;
        const rawCount = Number(targets[targetPath] || 1) || 1;
        const linkCount = countDuplicates ? rawCount : 1;
        edges.push({
          id: key,
          sourceId: sourcePath,
          targetId: targetPath,
          linkCount,
          bidirectional: false
        });
        edgeSet.add(key);
      }
    }
    return edges;
  }
  createTagEdges(app, nodeById) {
    const edges = [];
    const edgeSet = /* @__PURE__ */ new Set();
    const files = app.vault.getMarkdownFiles();
    for (const file of files) {
      const srcId = file.path;
      if (!nodeById.has(srcId))
        continue;
      const tags = this.extractTagsFromFile(file, app);
      for (const cleanTag of tags) {
        const tagId = `tag:${cleanTag}`;
        if (!nodeById.has(tagId))
          continue;
        const id = `${srcId}->${tagId}`;
        if (edgeSet.has(id))
          continue;
        edges.push({
          id,
          sourceId: srcId,
          targetId: tagId,
          linkCount: 1,
          bidirectional: false
        });
        edgeSet.add(id);
      }
    }
    return edges;
  }
  // -----------------------
  // Decorations (settings)
  // -----------------------
  decorateGraph(graph, app) {
    this.computeDegreesAndRadius(graph);
    this.markBidirectional(graph.edges);
  }
  computeDegreesAndRadius(graph) {
    const settings = getSettings();
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const n of graph.nodes) {
      n.inDegree = 0;
      n.outDegree = 0;
      n.totalDegree = 0;
      n.radius = 0;
    }
    for (const e of graph.edges) {
      const src = nodeById.get(e.sourceId);
      const tgt = nodeById.get(e.targetId);
      if (!src || !tgt)
        continue;
      const c = Number(e.linkCount || 1) || 1;
      src.outDegree = (src.outDegree || 0) + c;
      tgt.inDegree = (tgt.inDegree || 0) + c;
    }
    for (const n of graph.nodes) {
      n.totalDegree = (n.inDegree || 0) + (n.outDegree || 0);
      n.radius = Math.min(Math.max(settings.graph.minNodeRadius + 0.1 * n.totalDegree, settings.graph.minNodeRadius), settings.graph.maxNodeRadius);
    }
  }
  markBidirectional(edges) {
    const m = /* @__PURE__ */ new Map();
    for (const e of edges)
      m.set(`${e.sourceId}->${e.targetId}`, e);
    for (const e of edges) {
      const rev = m.get(`${e.targetId}->${e.sourceId}`);
      if (rev) {
        e.bidirectional = true;
        rev.bidirectional = true;
      }
    }
  }
  extractTagsFromFile(file, app) {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache)
      return [];
    const tags = /* @__PURE__ */ new Set();
    for (const t of cache.tags ?? []) {
      const rawTag = t?.tag;
      if (typeof rawTag === "string") {
        tags.add(this.normalizeTag(rawTag));
      }
    }
    const fm = cache.frontmatter;
    if (fm) {
      const rawTag = fm.tags ?? fm.tag;
      if (typeof rawTag === "string") {
        for (const part of rawTag.split(/[,\s]+/)) {
          if (!part)
            continue;
          tags.add(this.normalizeTag(part));
        }
      } else if (Array.isArray(rawTag)) {
        for (const v of rawTag) {
          if (typeof v === "string") {
            tags.add(this.normalizeTag(v));
          }
        }
      }
    }
    return [...tags];
  }
  normalizeTag(tag) {
    const t = tag.trim();
    return (t.startsWith("#") ? t.slice(1) : t).trim().toLowerCase();
  }
};

// src/graph/GraphController.ts
var GraphController = class {
  app;
  containerEl;
  plugin;
  running = false;
  canvas = null;
  renderer = null;
  adjacencyMap = null;
  simulation = null;
  animationFrame = null;
  lastTime = null;
  inputManager = null;
  camera = null;
  settingsUnregister = null;
  interactor = null;
  graphStore = null;
  graph = null;
  cursor = null;
  hoverAnchor = null;
  constructor(app, containerEl, plugin) {
    this.app = app;
    this.containerEl = containerEl;
    this.plugin = plugin;
    const settings = getSettings();
    this.camera = new CameraController(settings.camera.state);
    this.camera.setWorldTransform(null);
  }
  async init() {
    this.canvas = document.createElement("canvas");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.tabIndex = 0;
    const graphDeps = {
      getGraph: () => this.graph,
      getCamera: () => this.camera,
      getApp: () => this.app,
      getPlugin: () => this.plugin,
      setPinnedNodes: (ids) => {
        this.simulation?.setPinnedNodes?.(ids);
      },
      enableMouseGravity: (on) => {
        getSettings().physics.mouseGravityEnabled = on;
      }
    };
    const storeDeps = {
      getApp: () => this.app,
      getPlugin: () => this.plugin
    };
    this.interactor = new GraphInteractor(graphDeps);
    this.graphStore = new GraphStore(storeDeps);
    this.cursor = createCursorController(this.canvas);
    this.renderer = createRenderer(this.canvas, this.camera);
    if (!this.canvas || !this.interactor || !this.renderer || !this.graphStore || !this.renderer)
      return;
    await this.graphStore.init();
    this.interactor.setOnNodeClick((node) => this.openNodeFile(node));
    const rect = this.containerEl.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);
    this.containerEl.appendChild(this.canvas);
    this.inputManager = new InputManager(this.canvas, {
      onOrbitStart: (screenX, screenY) => this.interactor.startOrbit(screenX, screenY),
      onOrbitMove: (screenX, screenY) => this.interactor.updateOrbit(screenX, screenY),
      onOrbitEnd: () => this.interactor.endOrbit(),
      onPanStart: (screenX, screenY) => this.interactor.startPan(screenX, screenY),
      onPanMove: (screenX, screenY) => this.interactor.updatePan(screenX, screenY),
      onPanEnd: () => this.interactor.endPan(),
      onOpenNode: (screenX, screenY) => this.interactor.openNode(screenX, screenY),
      onMouseMove: (screenX, screenY) => this.interactor.updateMouse(screenX, screenY),
      onDragStart: (nodeId, screenX, screenY) => this.interactor.startDrag(nodeId, screenX, screenY),
      onDragMove: (screenX, screenY) => this.interactor.updateDrag(screenX, screenY),
      onDragEnd: () => this.interactor.endDrag(),
      onZoom: (x, y, delta) => this.interactor.updateZoom(x, y, delta),
      onFollowStart: (nodeId) => this.interactor.startFollow(nodeId),
      onFollowEnd: () => this.interactor.endFollow(),
      resetCamera: () => this.camera.resetCamera(),
      detectClickedNode: (screenX, screenY) => {
        return this.interactor.nodeClicked(screenX, screenY);
      }
    });
    this.buildAdjacencyMap();
    await this.refreshGraph();
    if (!this.graph)
      return;
    this.resetCamera();
    this.lastTime = null;
    this.animationFrame = requestAnimationFrame(this.animationLoop);
  }
  async refreshGraph() {
    this.stopSimulation();
    if (!this.graphStore)
      return;
    this.graph = this.graphStore.get();
    const interactor = this.interactor;
    const renderer = this.renderer;
    const graph = this.graph;
    const camera = this.camera;
    if (!interactor || !renderer || !graph || !camera)
      return;
    renderer?.setGraph(graph);
    this.simulation = createSimulation(graph, camera, () => interactor.mouseScreenPosition);
    const simulation = this.simulation;
    this.buildAdjacencyMap();
    this.startSimulation();
    renderer?.render();
  }
  async rebuildGraph() {
    if (!this.graphStore || !this.renderer || !this.interactor || !this.camera)
      return;
    this.stopSimulation();
    this.simulation = null;
    await this.graphStore.rebuild();
    this.graph = this.graphStore.get();
    if (!this.graph)
      return;
    this.renderer.setGraph(this.graph);
    this.simulation = createSimulation(this.graph, this.camera, () => this.interactor.mouseScreenPosition);
    this.startSimulation();
  }
  animationLoop = (timestamp) => {
    if (!this.lastTime) {
      this.lastTime = timestamp;
      this.animationFrame = requestAnimationFrame(this.animationLoop);
      return;
    }
    let dt = (timestamp - this.lastTime) / 1e3;
    if (dt > 0.05)
      dt = 0.05;
    this.lastTime = timestamp;
    if (this.running && this.simulation)
      this.simulation.tick(dt);
    const cursor = this.cursor;
    const interactor = this.interactor;
    const renderer = this.renderer;
    const camera = this.camera;
    if (!camera || !cursor || !interactor || !renderer)
      return;
    interactor.frame();
    const cursorType = interactor.cursorType;
    cursor.apply(cursorType);
    this.updateCameraAnimation(timestamp);
    renderer.setMouseScreenPosition(interactor.mouseScreenPosition);
    renderer.setFollowedNode(interactor.followedNodeId);
    renderer.render();
    this.animationFrame = requestAnimationFrame(this.animationLoop);
  };
  updateCameraAnimation(now) {
    return;
  }
  buildAdjacencyMap() {
    const adjacency = /* @__PURE__ */ new Map();
    if (this.graph && this.graph.edges) {
      for (const e of this.graph.edges) {
        if (!adjacency.has(e.sourceId))
          adjacency.set(e.sourceId, []);
        if (!adjacency.has(e.targetId))
          adjacency.set(e.targetId, []);
        adjacency.get(e.sourceId).push(e.targetId);
        adjacency.get(e.targetId).push(e.sourceId);
      }
    }
    this.adjacencyMap = adjacency;
  }
  focusNode(nodeId) {
    const graph = this.graph;
    const cam = this.camera;
    if (!graph || !cam)
      return;
    const n = graph.nodes.find((x) => x.id === nodeId);
    if (!n)
      return;
    cam.patchState({
      targetX: n.x,
      targetY: n.y,
      targetZ: n.z
    });
  }
  resetCamera() {
    this.camera?.resetCamera();
    const graph = this.graph;
    const cam = this.camera;
    if (!graph || !cam)
      return;
  }
  startSimulation() {
    if (!this.simulation)
      return;
    this.simulation.start();
    this.running = true;
  }
  stopSimulation() {
    if (this.simulation) {
      this.simulation.stop();
      this.simulation = null;
    }
  }
  async openNodeFile(node) {
    if (!node)
      return;
    const app = this.app;
    let file = null;
    if (node.file)
      file = node.file;
    else if (node.filePath) {
      const af = app.vault.getAbstractFileByPath(node.filePath);
      if (af instanceof import_obsidian.TFile)
        file = af;
    }
    if (!file) {
      console.warn("Greater Graph: could not resolve file for node", node);
      return;
    }
    const leaf = app.workspace.getLeaf(false);
    try {
      await leaf.openFile(file);
    } catch (e) {
      console.error("Greater Graph: failed to open file", e);
    }
  }
  filterGraph(graph, showTags = true) {
    if (showTags)
      return { nodes: graph.nodes, edges: graph.edges };
    const tagSet = new Set(graph.nodes.filter((n) => n.type === "tag").map((n) => n.id));
    const nodes = graph.nodes.filter((n) => !tagSet.has(n.id));
    const edges = graph.edges.filter((e) => !tagSet.has(e.sourceId) && !tagSet.has(e.targetId));
    return { nodes, edges };
  }
  refreshTheme() {
    this.renderer?.refreshTheme();
  }
  resize(width, height) {
    if (!this.renderer || !this.camera)
      return;
    this.renderer.resize(width, height);
  }
  destroy() {
    this.graphStore?.save();
    this.renderer?.destroy();
    this.renderer = null;
    this.interactor = null;
    if (this.simulation) {
      this.simulation.stop();
      this.simulation = null;
    }
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
      this.lastTime = null;
      this.running = false;
    }
    if (this.settingsUnregister) {
      this.settingsUnregister();
      this.settingsUnregister = null;
    }
    this.inputManager?.destroy();
    this.inputManager = null;
  }
};

// src/shared/debounce.ts
function debounce(fn, wait = 300, immediate = false) {
  let timeout = null;
  return (...args) => {
    const later = () => {
      timeout = null;
      if (!immediate)
        fn(...args);
    };
    const callNow = immediate && timeout === null;
    if (timeout)
      window.clearTimeout(timeout);
    timeout = window.setTimeout(later, wait);
    if (callNow)
      fn(...args);
  };
}

// src/plugin/GraphView.ts
var GRAPH_PLUS_TYPE = "graph-plus";
var GraphView = class extends import_obsidian2.ItemView {
  graph = null;
  plugin;
  scheduleGraphRefresh = null;
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  async onOpen() {
    this.containerEl.empty();
    const container = this.containerEl.createDiv({ cls: "graph+" });
    this.graph = new GraphController(this.app, container, this.plugin);
    await this.graph.init();
    if (!this.scheduleGraphRefresh)
      this.scheduleGraphRefresh = debounce(() => {
        this.graph?.refreshGraph();
      }, 200, true);
    this.registerEvent(this.app.vault.on("create", () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleGraphRefresh && this.scheduleGraphRefresh()));
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        this.graph?.refreshTheme();
      })
    );
  }
  onResize() {
    const rect = this.containerEl.getBoundingClientRect();
    this.graph?.resize(rect.width, rect.height);
  }
  async onClose() {
    this.graph?.destroy();
    this.graph = null;
    this.containerEl.empty();
  }
  getViewType() {
    return GRAPH_PLUS_TYPE;
  }
  getDisplayText() {
    return "graph+";
  }
  getIcon() {
    return "dot-network";
  }
};

// src/plugin/SettingsTab.ts
var import_obsidian3 = require("obsidian");

// src/settings/defaultSettings.ts
var DEFAULT_SETTINGS = {
  graph: {
    minNodeRadius: 3,
    maxNodeRadius: 20,
    nodeColor: void 0,
    tagColor: void 0,
    edgeColor: void 0,
    backgroundColor: void 0,
    labelColor: void 0,
    labelFontSize: 12,
    labelRevealRadius: 100,
    useInterfaceFont: true,
    countDuplicateLinks: true,
    drawDoubleLines: true,
    showTags: true,
    showLabels: true,
    hoverScale: 1
  },
  physics: {
    repulsionStrength: 5e3,
    springStrength: 1,
    springLength: 100,
    centerPull: 1e-3,
    damping: 0.7,
    notePlaneStiffness: 0,
    tagPlaneStiffness: 0,
    mouseGravityEnabled: true,
    mouseGravityRadius: 15,
    mouseGravityStrength: 10,
    mouseGravityExponent: 2,
    worldCenterX: 0,
    worldCenterY: 0,
    worldCenterZ: 0
  },
  camera: {
    momentumScale: 0.12,
    dragThreshold: 4,
    rotateSensitivityX: 5e-3,
    rotateSensitivityY: 5e-3,
    zoomSensitivity: 35,
    cameraAnimDuration: 300,
    state: {
      yaw: 0,
      pitch: 0,
      distance: 1200,
      targetX: 0,
      targetY: 0,
      targetZ: 0,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      orbitVelX: 0,
      orbitVelY: 0,
      panVelX: 0,
      panVelY: 0,
      zoomVel: 0
    }
  }
};

// src/plugin/SettingsTab.ts
var GraphPlusSettingTab = class extends import_obsidian3.PluginSettingTab {
  plugin;
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const settings = getSettings();
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Graph Settings" });
    const addSliderSetting = (parent, opts) => {
      const s = new import_obsidian3.Setting(parent).setName(opts.name).setDesc(opts.desc || "");
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "8px";
      const range = document.createElement("input");
      range.type = "range";
      range.min = String(opts.min);
      range.max = String(opts.max);
      range.step = String(opts.step ?? (opts.step === 0 ? 0 : opts.step || 1));
      range.value = String(opts.value);
      range.style.flex = "1";
      const num = document.createElement("input");
      num.type = "number";
      num.min = String(opts.min);
      num.max = String(opts.max);
      num.step = String(opts.step ?? (opts.step === 0 ? 0 : opts.step || 1));
      num.value = String(opts.value);
      num.style.minWidth = "56px";
      num.style.textAlign = "right";
      num.style.width = "80px";
      range.addEventListener("input", (e) => {
        num.value = e.target.value;
      });
      num.addEventListener("input", (e) => {
        range.value = e.target.value;
      });
      range.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        await opts.onChange(v);
      });
      num.addEventListener("change", async (e) => {
        const v = Number(e.target.value);
        await opts.onChange(v);
      });
      const rbtn = document.createElement("button");
      rbtn.type = "button";
      rbtn.textContent = "\u21BA";
      rbtn.title = "Reset to default";
      rbtn.style.border = "none";
      rbtn.style.background = "transparent";
      rbtn.style.cursor = "pointer";
      rbtn.addEventListener("click", async () => {
        try {
          if (typeof opts.resetValue === "number") {
            range.value = String(opts.resetValue);
            num.value = range.value;
            await opts.onChange(Number(range.value));
          } else {
            await opts.onChange(NaN);
          }
        } catch (e) {
        }
      });
      wrap.appendChild(range);
      wrap.appendChild(num);
      wrap.appendChild(rbtn);
      s.controlEl.appendChild(wrap);
      return { range, num, reset: rbtn };
    };
    const addNumericSlider = (parent, opts) => {
      const current = opts.get(settings);
      const def = opts.getDefault(DEFAULT_SETTINGS);
      addSliderSetting(parent, {
        name: opts.name,
        desc: opts.desc,
        value: current,
        min: opts.min,
        max: opts.max,
        step: opts.step,
        resetValue: def,
        onChange: async (raw) => {
          if (Number.isNaN(raw)) {
            const dv = opts.clamp ? opts.clamp(def) : def;
            this.applySettings((s) => {
              opts.set(s, dv);
            });
            return;
          }
          const v = opts.clamp ? opts.clamp(raw) : raw;
          this.applySettings((s) => {
            opts.set(s, v);
          });
        }
      });
    };
    addNumericSlider(containerEl, {
      name: "Minimum node radius",
      desc: "Minimum radius for the smallest node (in pixels).",
      min: 1,
      max: 20,
      step: 1,
      get: (s) => s.graph.minNodeRadius,
      getDefault: (s) => s.graph.minNodeRadius,
      set: (s, v) => {
        s.graph.minNodeRadius = Math.round(v);
      },
      clamp: (v) => Math.max(1, Math.min(20, Math.round(v)))
    });
    addNumericSlider(containerEl, {
      name: "Maximum node radius",
      desc: "Maximum radius for the most connected node (in pixels).",
      min: 8,
      max: 80,
      step: 1,
      get: (s) => s.graph.maxNodeRadius,
      getDefault: (s) => s.graph.maxNodeRadius,
      set: (s, v) => {
        s.graph.maxNodeRadius = Math.round(v);
      },
      clamp: (v) => Math.max(8, Math.min(80, Math.round(v)))
    });
    addNumericSlider(containerEl, {
      name: "Gravity Radius",
      desc: "Scales each node's screen-space radius for glow/mouse gravity.",
      min: 10,
      max: 30,
      step: 1,
      get: (s) => s.physics.mouseGravityRadius,
      getDefault: (s) => s.physics.mouseGravityRadius,
      set: (s, v) => {
        s.physics.mouseGravityRadius = v;
      },
      clamp: (v) => Math.max(10, Math.min(30, v))
    });
    addNumericSlider(containerEl, {
      name: "Gravity strength",
      desc: "Overall strength of the mouse gravity effect.",
      min: 1,
      max: 20,
      step: 1,
      get: (s) => s.physics.mouseGravityStrength,
      getDefault: (s) => s.physics.mouseGravityStrength,
      set: (s, v) => {
        s.physics.mouseGravityStrength = v;
      },
      clamp: (v) => Math.max(1, Math.min(20, v))
    });
    addNumericSlider(containerEl, {
      name: "Label Radius",
      desc: "Screen-space label reveal radius (\xD7 node size).",
      min: 0.5,
      max: 10,
      step: 0.1,
      get: (s) => s.graph.labelRevealRadius,
      getDefault: (s) => s.graph.labelRevealRadius,
      set: (s, v) => {
        s.graph.labelRevealRadius = v;
      },
      clamp: (v) => Math.max(0.5, Math.min(10, v))
    });
    containerEl.createEl("h2", { text: "Color Settings" });
    {
      const s = new import_obsidian3.Setting(containerEl).setName("Node color (override)").setDesc("Optional color to override the theme accent for node fill. Leave unset to use the active theme.");
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      try {
        colorInput.value = settings.graph.nodeColor ? String(settings.graph.nodeColor) : "#000000";
      } catch (e) {
        colorInput.value = "#000000";
      }
      colorInput.style.marginLeft = "8px";
      colorInput.addEventListener("change", async (e) => {
        const v = e.target.value.trim();
        this.applySettings((s2) => {
          s2.graph.nodeColor = v === "" ? void 0 : v;
        });
      });
      const rb = document.createElement("button");
      rb.type = "button";
      rb.textContent = "\u21BA";
      rb.title = "Reset to default";
      rb.style.marginLeft = "8px";
      rb.style.border = "none";
      rb.style.background = "transparent";
      rb.style.cursor = "pointer";
      s.controlEl.appendChild(rb);
      const hint = document.createElement("span");
      hint.textContent = "(alpha)";
      hint.style.marginLeft = "8px";
      hint.style.marginRight = "6px";
      s.controlEl.appendChild(hint);
      s.controlEl.appendChild(colorInput);
    }
    {
      const s = new import_obsidian3.Setting(containerEl).setName("Edge color (override)").setDesc("Optional color to override edge stroke color. Leave unset to use a theme-appropriate color.");
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      try {
        colorInput.value = settings.graph.edgeColor ? String(settings.graph.edgeColor) : "#000000";
      } catch (e) {
        colorInput.value = "#000000";
      }
      colorInput.style.marginLeft = "8px";
      colorInput.addEventListener("change", async (e) => {
        const v = e.target.value.trim();
        this.applySettings((s2) => {
          s2.graph.edgeColor = v === "" ? void 0 : v;
        });
      });
      const rb = document.createElement("button");
      rb.type = "button";
      rb.textContent = "\u21BA";
      rb.title = "Reset to default";
      rb.style.marginLeft = "8px";
      rb.style.border = "none";
      rb.style.background = "transparent";
      rb.style.cursor = "pointer";
      s.controlEl.appendChild(rb);
      s.controlEl.appendChild(colorInput);
      const hint = document.createElement("span");
      hint.textContent = "(alpha)";
      hint.style.marginLeft = "8px";
      hint.style.marginRight = "6px";
      s.controlEl.appendChild(hint);
    }
    {
      const s = new import_obsidian3.Setting(containerEl).setName("Tag color (override)").setDesc("Optional color to override tag node color. Leave unset to use the active theme.");
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      try {
        colorInput.value = settings.graph.tagColor ? String(settings.graph.tagColor) : "#000000";
      } catch (e) {
        colorInput.value = "#000000";
      }
      colorInput.style.marginLeft = "8px";
      colorInput.addEventListener("change", async (e) => {
        const v = e.target.value.trim();
        settings.graph.tagColor = v === "" ? void 0 : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement("button");
      rb.type = "button";
      rb.textContent = "\u21BA";
      rb.title = "Reset to default";
      rb.style.marginLeft = "8px";
      rb.style.border = "none";
      rb.style.background = "transparent";
      rb.style.cursor = "pointer";
      s.controlEl.appendChild(rb);
      s.controlEl.appendChild(colorInput);
      const hint = document.createElement("span");
      hint.textContent = "(alpha)";
      hint.style.marginLeft = "8px";
      hint.style.marginRight = "6px";
      s.controlEl.appendChild(hint);
    }
    {
      const s = new import_obsidian3.Setting(containerEl).setName("Label color (override)").setDesc("Optional color to override the label text color. Leave unset to use the active theme.");
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      try {
        colorInput.value = settings.graph.labelColor ? String(settings.graph.labelColor) : "#000000";
      } catch (e) {
        colorInput.value = "#000000";
      }
      colorInput.style.marginLeft = "8px";
      colorInput.addEventListener("change", async (e) => {
        const v = e.target.value.trim();
        settings.graph.labelColor = v === "" ? void 0 : v;
        await this.plugin.saveSettings();
      });
      const rb = document.createElement("button");
      rb.type = "button";
      rb.textContent = "\u21BA";
      rb.title = "Reset to default";
      rb.style.marginLeft = "8px";
      rb.style.border = "none";
      rb.style.background = "transparent";
      rb.style.cursor = "pointer";
      s.controlEl.appendChild(rb);
      s.controlEl.appendChild(colorInput);
      const hint = document.createElement("span");
      hint.textContent = "(alpha)";
      hint.style.marginLeft = "8px";
      hint.style.marginRight = "6px";
      s.controlEl.appendChild(hint);
    }
    new import_obsidian3.Setting(containerEl).setName("Use interface font for labels").setDesc("When enabled, the plugin will use the theme/Obsidian interface font for file labels. When disabled, a monospace/code font will be preferred.").addToggle((t) => t.setValue(Boolean(settings.graph.useInterfaceFont)).onChange(async (v) => {
      this.applySettings((s) => {
        s.graph.useInterfaceFont = v;
      });
    }));
    addNumericSlider(containerEl, {
      name: "Base label font size",
      desc: "Base font size for labels in pixels (before camera zoom scaling).",
      min: 6,
      max: 24,
      step: 1,
      get: (s) => s.graph.labelFontSize,
      getDefault: (s) => s.graph.labelFontSize,
      set: (s, v) => {
        s.graph.labelFontSize = v;
      },
      clamp: (v) => Math.max(6, Math.min(24, v))
    });
    containerEl.createEl("h2", { text: "Physics Settings" });
    const repulsionUi = (() => {
      const internal = settings.physics.repulsionStrength;
      const ui = Math.sqrt(Math.max(0, internal / 2e3));
      return Math.min(1, Math.max(0, ui));
    })();
    addSliderSetting(containerEl, {
      name: "Repulsion strength",
      desc: "UI 0\u20131 (mapped internally). Higher = more node separation.",
      value: repulsionUi,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: repulsionUi,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          this.applySettings((s) => {
            s.physics.repulsionStrength = v * v * 2e3;
          });
        } else if (Number.isNaN(v)) {
          this.applySettings((s) => {
            s.physics.repulsionStrength = settings.physics.repulsionStrength;
          });
        }
      }
    });
    const springUi = Math.min(1, Math.max(0, settings.physics.springStrength / 0.5));
    addSliderSetting(containerEl, {
      name: "Spring strength",
      desc: "UI 0\u20131 mapped to internal spring constant (higher = stiffer).",
      value: springUi,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: springUi,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          this.applySettings((s) => {
            s.physics.springStrength = v * 0.5;
          });
        } else if (Number.isNaN(v)) {
          this.applySettings((s) => {
            s.physics.springStrength = settings.physics.springStrength;
          });
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Spring length",
      desc: "Preferred length (px) for edge springs.",
      value: settings.physics.springLength,
      min: 20,
      max: 400,
      step: 1,
      resetValue: DEFAULT_SETTINGS.physics.springLength,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0) {
          this.applySettings((s) => {
            s.physics.springLength = v;
          });
        } else if (Number.isNaN(v)) {
          this.applySettings((s) => {
            s.physics.springLength = settings.physics.springLength;
          });
        }
      }
    });
    const centerUi = Math.min(1, Math.max(0, settings.physics.centerPull / 0.01));
    addSliderSetting(containerEl, {
      name: "Center pull",
      desc: "UI 0\u20131 mapped to a small centering force (internal scale).",
      value: centerUi,
      min: 0,
      max: 1,
      step: 1e-3,
      resetValue: 0.1,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          this.applySettings((s) => {
            s.physics.centerPull = v * 0.01;
          });
        } else if (Number.isNaN(v)) {
          this.applySettings((s) => {
            s.physics.centerPull = 0;
          });
        }
      }
    });
    addSliderSetting(containerEl, {
      name: "Damping",
      desc: "Velocity damping (0.7\u20131.0). Higher values reduce motion faster.",
      value: settings.physics.damping,
      min: 0.7,
      max: 1,
      step: 0.01,
      resetValue: DEFAULT_SETTINGS.physics.damping,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0.7 && v <= 1) {
          this.applySettings((s) => {
            s.physics.damping = v;
          });
        } else if (Number.isNaN(v)) {
          this.applySettings((s) => {
            s.physics.damping = settings.physics.damping;
          });
        }
      }
    });
    new import_obsidian3.Setting(containerEl).setName("Count duplicate links").setDesc("If enabled, multiple links between the same two files will be counted when computing in/out degrees.").addToggle((t) => t.setValue(Boolean(settings.graph.countDuplicateLinks)).onChange(async (v) => {
      this.applySettings((s) => {
        s.graph.countDuplicateLinks = Boolean(v);
      });
    }));
    new import_obsidian3.Setting(containerEl).setName("Double-line mutual links").setDesc("When enabled, mutual links (A \u2194 B) are drawn as two parallel lines; when disabled, mutual links appear as a single line.").addToggle((t) => t.setValue(Boolean(settings.graph.drawDoubleLines)).onChange(async (v) => {
      this.applySettings((s) => {
        s.graph.drawDoubleLines = Boolean(v);
      });
    }));
    new import_obsidian3.Setting(containerEl).setName("Show tag nodes").setDesc("Toggle visibility of tag nodes and their edges in the graph.").addToggle((t) => t.setValue(settings.graph.showTags !== false).onChange(async (v) => {
      this.applySettings((s) => {
        s.graph.showTags = Boolean(v);
      });
    }));
    const notePlaneUi = Math.min(1, Math.max(0, settings.physics.notePlaneStiffness / 0.02));
    addSliderSetting(containerEl, {
      name: "Note plane stiffness (z)",
      desc: "How strongly notes are pulled toward the z=0 plane (UI 0\u20131).",
      value: notePlaneUi,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: 0.2,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          this.applySettings((s) => {
            s.physics.notePlaneStiffness = v * 0.02;
          });
        } else if (Number.isNaN(v)) {
          this.applySettings((s) => {
            s.physics.notePlaneStiffness = 0;
          });
        }
      }
    });
    const tagPlaneUi = Math.min(1, Math.max(0, settings.physics.tagPlaneStiffness / 0.02));
    addSliderSetting(containerEl, {
      name: "Tag plane stiffness (x)",
      desc: "How strongly tag nodes are pulled toward the x=0 plane (UI 0\u20131).",
      value: tagPlaneUi,
      min: 0,
      max: 1,
      step: 0.01,
      resetValue: 0.4,
      onChange: async (v) => {
        if (!Number.isNaN(v) && v >= 0 && v <= 1) {
          this.applySettings((s) => {
            s.physics.tagPlaneStiffness = v * 0.02;
          });
        } else if (Number.isNaN(v)) {
          this.applySettings((s) => {
            s.physics.tagPlaneStiffness = 0;
          });
        }
      }
    });
    new import_obsidian3.Setting(containerEl).setName("Mouse gravity").setDesc("Enable the mouse gravity well that attracts nearby nodes.").addToggle((t) => t.setValue(Boolean(settings.physics.mouseGravityEnabled !== false)).onChange(async (v) => {
      this.applySettings((s) => {
        s.physics.mouseGravityEnabled = Boolean(v);
      });
    }));
  }
  async applySettings(mutator) {
    updateSettings(mutator);
    await this.plugin.saveSettings();
  }
};

// src/plugin/main.ts
var GraphPlus = class extends import_obsidian4.Plugin {
  settings;
  async onload() {
    initSettings({ ...DEFAULT_SETTINGS });
    this.settings = getSettings();
    this.registerView(GRAPH_PLUS_TYPE, (leaf) => new GraphView(leaf, this));
    this.addCommand({
      id: "open-graph+",
      name: "open graph+",
      callback: () => this.activateView()
    });
    this.addSettingTab(new GraphPlusSettingTab(this.app, this));
  }
  async activateView() {
    const leaves = this.app.workspace.getLeavesOfType(GRAPH_PLUS_TYPE);
    if (leaves.length === 0) {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
        type: GRAPH_PLUS_TYPE,
        active: true
      });
      this.app.workspace.revealLeaf(leaf);
    } else {
      this.app.workspace.revealLeaf(leaves[0]);
    }
  }
  onunload() {
  }
  async saveSettings() {
    await this.saveData(getSettings());
  }
};
