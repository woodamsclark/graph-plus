import { Project, Node, SyntaxKind, CallExpression, SourceFile } from "ts-morph";
import fg from "fast-glob";
import * as fs from "fs";
import * as path from "path";

type CanvasNode = any;
type CanvasEdge = { id: string; fromNode: string; toNode: string };
type CanvasFile = { nodes: CanvasNode[]; edges: CanvasEdge[] };

function slug(s: string) {
  return s.replace(/[^a-zA-Z0-9_.:-]+/g, "_");
}
function makeId(prefix: string, s: string) {
  return `${prefix}_${slug(s)}`;
}
function rel(p: string) {
  return path.relative(process.cwd(), p).replace(/\\/g, "/");
}
function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

// ===== CONFIG =====
// Obsidian plugin-ish safe defaults:
const SRC_GLOB = ["src/**/*.ts", "src/**/*.tsx", "main.ts", "main.tsx"];
const IGNORE = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.obsidian/**"];

// Put this in your vault if you want (recommended):
const OUT_DIR = path.join(process.cwd(), "src/docs");
const OUT_FILE = path.join(OUT_DIR, "graph-plus.canvas");

// Keep it high-level:
const MAX_DEPTH = 3;       // class-to-class hops
const MAX_OUT_EDGES = 3;   // per node (entry or class)

// Noise filters:
const IGNORE_CALLEE_PREFIXES = [
  "console.",
  "Math.",
  "JSON.",
  "Object.",
  "Array.",
  "Date.",
  "Promise.",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
];
const IGNORE_METHOD_NAMES = new Set([
  "constructor",
]);
// ==================

// ===== Key types =====
type MethodKey = `m:${string}:${string}.${string}`; // m:rel:Class.method
type ClassKey  = `cls:${string}:${string}`;         // cls:rel:Class
type EntryKey  = `entry:${string}`;                 // entry:...

type AnyKey = MethodKey | ClassKey | EntryKey;

function methodKey(sf: SourceFile, cls: string, method: string): MethodKey {
  return `m:${rel(sf.getFilePath())}:${cls}.${method}`;
}
function classKeyFromMethodKey(mk: MethodKey): ClassKey {
  // m:rel:Class.method
  const parts = mk.split(":");         // ["m", "rel", "Class.method"]
  const relPath = parts[1];
  const classAndMethod = parts.slice(2).join(":");
  const dot = classAndMethod.indexOf(".");
  const cls = dot >= 0 ? classAndMethod.slice(0, dot) : classAndMethod;
  return `cls:${relPath}:${cls}`;
}
function classLabel(ck: ClassKey): string {
  // cls:rel:Class
  return ck.split(":").slice(2).join(":");
}
function entryLabel(ek: EntryKey): string {
  return ek.replace(/^entry:/, "");
}

// ===== Load files =====
const files = fg.sync(SRC_GLOB, { absolute: true, dot: false, ignore: IGNORE });

const hasTsconfig = fs.existsSync(path.join(process.cwd(), "tsconfig.json"));
const project = hasTsconfig
  ? new Project({ tsConfigFilePath: "tsconfig.json", skipAddingFilesFromTsConfig: true })
  : new Project({
      compilerOptions: { target: 99, module: 99, strict: false, jsx: 2 },
    });

project.addSourceFilesAtPaths(files);

// ===== Collect methods + owners =====
const methodOwnerClass = new Map<MethodKey, ClassKey>();
const methodLabel = new Map<MethodKey, string>();

// Entry methods (onload/onunload, plus command callbacks etc.)
const entryMethods = new Set<MethodKey>();
const entryNodes = new Set<EntryKey>();

// Method call graph: method -> method
const methodCalls = new Map<MethodKey, Set<MethodKey>>();

function addMethodCall(from: MethodKey, to: MethodKey) {
  let s = methodCalls.get(from);
  if (!s) methodCalls.set(from, (s = new Set()));
  s.add(to);
}

// Best-effort: “is internal” by path
function isInternalSourceFile(sf: SourceFile): boolean {
  const r = rel(sf.getFilePath());
  return r.startsWith("src/") || r === "main.ts" || r === "main.tsx";
}

function isNoiseCall(call: CallExpression): boolean {
  const txt = call.getExpression().getText();
  if (IGNORE_CALLEE_PREFIXES.some((p) => txt.startsWith(p))) return true;
  if (txt.includes(".forEach") || txt.includes(".map") || txt.includes(".filter") || txt.includes(".reduce")) return true;
  return false;
}

function enclosingMethodKey(n: Node, sf: SourceFile): MethodKey | null {
  const m = n.getFirstAncestorByKind(SyntaxKind.MethodDeclaration);
  if (!m) return null;
  const cls = m.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
  const cname = cls?.getName();
  if (!cname) return null;
  const mname = m.getName();
  if (IGNORE_METHOD_NAMES.has(mname)) return null;
  return methodKey(sf, cname, mname);
}

function resolveCallTargetMethodKey(call: CallExpression): MethodKey | null {
  // Version-stable resolution:
  const exprType = call.getExpression().getType();
  const sig = exprType.getCallSignatures()[0] ?? call.getType().getCallSignatures()[0];
  const decl = sig?.getDeclaration();
  if (!decl) return null;

  const declSf = decl.getSourceFile();
  if (!isInternalSourceFile(declSf)) return null;

  if (Node.isMethodDeclaration(decl)) {
    const mname = decl.getName();
    if (IGNORE_METHOD_NAMES.has(mname)) return null;
    const cls = decl.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
    const cname = cls?.getName();
    if (!cname) return null;
    return methodKey(declSf, cname, mname);
  }

  // We intentionally ignore top-level functions for this “classes-only” view.
  return null;
}

// 1) Index all class methods and mark plugin lifecycle entrypoints
for (const sf of project.getSourceFiles()) {
  if (!isInternalSourceFile(sf)) continue;

  for (const cls of sf.getClasses()) {
    const cname = cls.getName();
    if (!cname) continue;

    // If it extends Plugin, treat onload/onunload as entrypoints
    const ext = cls.getExtends();
    const extendsPlugin = ext?.getExpression().getText() === "Plugin";

    for (const m of cls.getMethods()) {
      const mname = m.getName();
      if (IGNORE_METHOD_NAMES.has(mname)) continue;

      const mk = methodKey(sf, cname, mname);
      const ck = `cls:${rel(sf.getFilePath())}:${cname}` as ClassKey;

      methodOwnerClass.set(mk, ck);
      methodLabel.set(mk, `${cname}.${mname}()`);

      if (extendsPlugin && (mname === "onload" || mname === "onunload")) {
        entryMethods.add(mk);
        entryNodes.add(`entry:${cname}.${mname}()` as EntryKey);
      }
    }
  }
}

// 2) Find command callbacks inside this.addCommand({ callback: ... })
// We model these as entry nodes, connected into class graph via the owning method
for (const sf of project.getSourceFiles()) {
  if (!isInternalSourceFile(sf)) continue;

  sf.forEachDescendant((n) => {
    if (!Node.isCallExpression(n)) return;
    const callee = n.getExpression().getText();
    if (!callee.endsWith(".addCommand") && callee !== "this.addCommand") return;

    const arg0 = n.getArguments()[0];
    if (!arg0 || !Node.isObjectLiteralExpression(arg0)) return;

    const nameProp = arg0.getProperty("name");
    let cmdName = "command";
    if (nameProp && Node.isPropertyAssignment(nameProp)) {
      const raw = nameProp.getInitializer()?.getText() ?? "";
      cmdName = raw.replace(/^['"]|['"]$/g, "") || cmdName;
    }

    // Make an entry node for the command
    const ek = `entry:command:${cmdName}` as EntryKey;
    entryNodes.add(ek);

    // Link the command entry to the method it’s defined inside (usually onload)
    const owner = enclosingMethodKey(n, sf);
    if (owner) {
      // Mark that owner as an “entry method” seed too (so BFS includes its class)
      entryMethods.add(owner);
      // We’ll connect entry -> owner’s class later via “entry immediate classes”
    }
  });
}

// 3) Build method->method call edges
for (const sf of project.getSourceFiles()) {
  if (!isInternalSourceFile(sf)) continue;

  sf.forEachDescendant((n) => {
    if (!Node.isCallExpression(n)) return;
    if (isNoiseCall(n)) return;

    const from = enclosingMethodKey(n, sf);
    if (!from) return;

    const to = resolveCallTargetMethodKey(n);
    if (!to) return;

    addMethodCall(from, to);
  });
}

// ===== Collapse to entry/classes flow =====

// Compute class adjacency from method calls: ClassA -> ClassB if any method in A calls method in B
const classAdj = new Map<ClassKey, Map<ClassKey, number>>(); // with weights (counts)

function bumpClassEdge(fromC: ClassKey, toC: ClassKey) {
  let m = classAdj.get(fromC);
  if (!m) classAdj.set(fromC, (m = new Map()));
  m.set(toC, (m.get(toC) ?? 0) + 1);
}

for (const [fromM, tos] of methodCalls.entries()) {
  const fromC = methodOwnerClass.get(fromM);
  if (!fromC) continue;

  for (const toM of tos) {
    const toC = methodOwnerClass.get(toM);
    if (!toC) continue;
    if (fromC === toC) continue;
    bumpClassEdge(fromC, toC);
  }
}

// For each entry seed method, find immediate classes it calls into (first hop)
const entryToClasses = new Map<EntryKey, Set<ClassKey>>();

function addEntryEdge(ek: EntryKey, ck: ClassKey) {
  let s = entryToClasses.get(ek);
  if (!s) entryToClasses.set(ek, (s = new Set()));
  s.add(ck);
}

// We connect:
// - lifecycle entry nodes to their own class
// - lifecycle entry nodes to classes called directly by their entry method
for (const mk of entryMethods) {
  const ownerClass = methodOwnerClass.get(mk);
  if (!ownerClass) continue;

  // Find the entry node label that matches this method if it’s onload/onunload,
  // otherwise treat it as being reached by some entry (like command registration)
  const lbl = methodLabel.get(mk) ?? "entry";
  const isLifecycle = lbl.endsWith(".onload()") || lbl.endsWith(".onunload()");
  const ek = isLifecycle ? (`entry:${lbl}` as EntryKey) : (`entry:internal` as EntryKey);
  entryNodes.add(ek);

  // entry -> owning class
  addEntryEdge(ek, ownerClass);

  // entry -> classes called directly from this method
  const outs = Array.from(methodCalls.get(mk) ?? []);
  for (const toM of outs) {
    const toC = methodOwnerClass.get(toM);
    if (!toC) continue;
    if (toC === ownerClass) continue;
    addEntryEdge(ek, toC);
  }
}

// Also make command entries point at the plugin class via the “internal” bucket
// (You can later manually move/rename the `entry:internal` node if you want)
if (entryNodes.has("entry:internal" as EntryKey) && entryNodes.size > 1) {
  // leave it; it will connect via addEntryEdge above when owner methods exist
}

// ===== BFS prune from entry->classes into class graph =====
type FlowNode = EntryKey | ClassKey;
const keptNodes = new Set<FlowNode>();
const keptEdges: Array<{ from: FlowNode; to: FlowNode }> = [];

function addKeptEdge(from: FlowNode, to: FlowNode) {
  keptEdges.push({ from, to });
  keptNodes.add(from);
  keptNodes.add(to);
}

// 1) Keep all entry nodes
for (const e of entryNodes) keptNodes.add(e);

// 2) Seed BFS with classes reached from entries
const queue: Array<{ ck: ClassKey; depth: number }> = [];
const level = new Map<FlowNode, number>();

for (const ek of entryNodes) {
  level.set(ek, 0);
  const targets = Array.from(entryToClasses.get(ek) ?? []);
  // sort stable
  targets.sort((a, b) => classLabel(a).localeCompare(classLabel(b)));
  for (const ck of targets.slice(0, MAX_OUT_EDGES)) {
    addKeptEdge(ek, ck);
    if (!level.has(ck) || (level.get(ck) ?? 999) > 1) level.set(ck, 1);
    queue.push({ ck, depth: 1 });
  }
}

// 3) BFS across classes
while (queue.length) {
  const { ck, depth } = queue.shift()!;
  if (depth >= MAX_DEPTH) continue;

  const outs = classAdj.get(ck);
  if (!outs) continue;

  // pick top edges by weight, then name (keeps it “important”)
  const sorted = Array.from(outs.entries())
    .sort((a, b) => (b[1] - a[1]) || classLabel(a[0]).localeCompare(classLabel(b[0])))
    .slice(0, MAX_OUT_EDGES);

  for (const [toC] of sorted) {
    addKeptEdge(ck, toC);
    const nd = depth + 1;
    if (!level.has(toC) || (level.get(toC) ?? 999) > nd) level.set(toC, nd);
    queue.push({ ck: toC, depth: nd });
  }
}

// ===== Canvas build with merge-preserving layout =====
let existing: CanvasFile | null = null;
if (fs.existsSync(OUT_FILE)) {
  try {
    existing = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
  } catch {
    existing = null;
  }
}
const oldById = new Map<string, any>();
for (const n of existing?.nodes ?? []) {
  if (n?.id) oldById.set(n.id, n);
}
function mergeNode(newNode: any) {
  const old = oldById.get(newNode.id);
  if (!old) return newNode;
  return {
    ...newNode,
    x: old.x ?? newNode.x,
    y: old.y ?? newNode.y,
    width: old.width ?? newNode.width,
    height: old.height ?? newNode.height,
    color: old.color,
    background: old.background,
  };
}

const nodes: CanvasNode[] = [];
const edges: CanvasEdge[] = [];
const nodeId = new Map<FlowNode, string>();

// Layout: entries at level 0 left; classes by BFS level to the right
const PAD_X = 80, PAD_Y = 80;
const COL_W = 420;
const ROW_H = 86;

// Place entries
const entriesSorted = Array.from(entryNodes).sort((a, b) => entryLabel(a).localeCompare(entryLabel(b)));
entriesSorted.forEach((ek, i) => {
  const id = makeId("n", ek);
  nodeId.set(ek, id);
  nodes.push(mergeNode({
    id,
    type: "text",
    x: PAD_X,
    y: PAD_Y + i * ROW_H,
    width: 320,
    height: 56,
    text: entryLabel(ek),
  }));
});

// Place classes by level (1..MAX_DEPTH+something)
const classes = Array.from(keptNodes).filter((k): k is ClassKey => (typeof k === "string" && k.startsWith("cls:")));
classes.sort((a, b) => {
  const la = level.get(a) ?? 999;
  const lb = level.get(b) ?? 999;
  if (la !== lb) return la - lb;
  return classLabel(a).localeCompare(classLabel(b));
});

const countByLevel = new Map<number, number>();
for (const ck of classes) {
  const lvl = level.get(ck) ?? 1;
  const idx = countByLevel.get(lvl) ?? 0;
  countByLevel.set(lvl, idx + 1);

  const id = makeId("c", ck);
  nodeId.set(ck, id);

  nodes.push(mergeNode({
    id,
    type: "group",
    x: PAD_X + lvl * COL_W,
    y: PAD_Y + idx * (ROW_H + 20),
    width: 520,
    height: 140,
    label: classLabel(ck),
  }));
}

// Build edges
for (const e of keptEdges) {
  const fromId = nodeId.get(e.from);
  const toId = nodeId.get(e.to);
  if (!fromId || !toId || fromId === toId) continue;
  edges.push({
    id: makeId("e", `${e.from}=>${e.to}`),
    fromNode: fromId,
    toNode: toId,
  });
}

ensureDir(OUT_DIR);
fs.writeFileSync(OUT_FILE, JSON.stringify({ nodes, edges }, null, 2), "utf8");
console.log(`Wrote ${OUT_FILE} (${nodes.length} nodes, ${edges.length} edges)`);
