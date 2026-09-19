# Graph Engine V2.0 Generic Tags and Tag-Hierarchy Layout Design

Status: Proposed

Date: 2026-09-14

Milestone: [2.0 — Public Release](https://github.com/woodamsclark/graph-engine/milestone/1)

Depends on:

- [Graph+ and Graph Engine V1.1 Architecture and Contracts](graph-engine-v1-contracts.md)
- [Graph Engine V1.3 Tag Regions Contract](graph-engine-v1.3-tag-regions-contract.md)
- [Graph Engine V1.4 Topology-Weighted Layout Contract](graph-engine-v1.4-topology-weighted-layout-contract.md)
- [Graph Engine V1.6 Anima Presentation and Native Motion Contract](graph-engine-v1.6-anima-presentation-and-native-motion-contract.md)
- [Graph Engine V2.0 Rendering Foundations Design](graph-engine-v2.0-rendering-foundations-design.md)

## 1. Decision summary

Graph Engine will own a generic tag-projection facility. A consumer supplies explicit,
normalized tag definitions and memberships; Graph Engine validates them and projects
them into ordinary canonical tag nodes, membership edges, optional parent-child edges,
and node-region definitions.

Graph Engine does not discover tags, parse consumer source formats, or decide what a
tag means. Graph+ remains responsible for translating Obsidian metadata into the
generic tag input. PatternSmith and later consumers may translate lesson packs or
other many-to-many labels into the same input when tag behavior fits their domain.

Tag membership is many-to-many. Tag hierarchy is optional and may also be
many-to-many. The facility is therefore named `tag`, not `taxonomy` or
`classification`; neither a strict tree nor exhaustive classification is implied.

The shipped free-layout profile gives generated `relation:tag-parent` relationships a
structural layout policy:

- bypass the ordinary hub-specificity discount;
- derive target length from the active ordinary `linkDistance` using a bounded scale,
  never an absolute distance;
- allocate additional parent-child distance from the child's unique visible recursive
  region size;
- derive strength from the active ordinary `linkStrength` using a bounded scale; and
- leave ordinary note links and tag-membership relationships under their existing
  topology-weighted behavior.

The recommended initial scales are:

```text
tagParentBaseLength = ordinaryWeightedTargetLength * 0.5
tagParentStrength = ordinaryWeightedStrength * 1.5
```

These values are release-characterization defaults. Live acceptance may tune them
without changing the public tag contract.

All endpoint pairs, including ordinary relationships, resolve through one universal
topology-layout policy. The default policy expresses the currently shipped evidence,
reciprocity, hub-discount, affinity, length, and strength equations. Relation policies
are declarative field overrides, not a second force path. A validated policy snapshot
may later be replaced while a session is mounted without changing canonical graph
data.

## 2. Motivation

Graph+ currently performs tag projection privately in `VaultGraphAdapter`:

- Obsidian tags become canonical nodes carrying `kind:tag` and `tag:*` tokens;
- note membership creates `relation:tag` edges;
- nested tag paths create `relation:tag-parent` edges; and
- the same relationships become generic `nodeRegions` definitions.

This produces useful engine data, but another consumer would need to repeat Graph+'s
node, edge, ID, hierarchy, and region construction. The behavior is reusable and
should have one engine-owned implementation.

The current topology-weighted solver also applies one global hub discount to every
physical endpoint pair:

```text
hubDiscount = 1 / (effectiveSourceDegree * effectiveTargetDegree) ^ hubDiscountExponent
```

The default exponent is `0.25`. Relation channels currently affect only
`effectiveDegree`: for every relation token on a pair, analysis uses the smallest of
the endpoint's total degree and its degree within those channels. There is no current
per-relation hub-discount branch or policy object.

That heuristic is appropriate for an associative graph: an edge between two large
hubs is often a bridge between neighborhoods and should be longer and softer. It is
not appropriate for a tag hierarchy. A parent tag's high child count is the intended
structure, not evidence that each parent-child relationship is nonspecific.

For example, `#quote` should be able to sit at the center of a tight hierarchy:

```text
#quote
  -> #quote/nietzsche
  -> #quote/jung
  -> #quote/kierkegaard
```

Ordinary note-to-note hubs should retain the existing separation behavior.

## 3. Terminology

- **Tag:** a consumer-defined, stable many-to-many label projected as an ordinary
  canonical graph node.
- **Tag membership:** an explicit consumer-supplied association between one canonical
  member node and one tag.
- **Parent tag:** a tag explicitly named as a direct parent of another tag.
- **Child tag:** a tag explicitly assigned one or more parent tags.
- **Tag input:** normalized consumer data supplied to the engine projector. It is not
  inferred from graph labels, paths, tokens, positions, or prose.
- **Tag projection:** the deterministic canonical nodes, edges, and region definitions
  generated by Graph Engine from accepted tag input.
- **Relation layout policy:** validated declarative force settings selected by an
  opaque edge token. It is data, not a consumer-authored executable callback.

## 4. Ownership boundary

Consumers own:

- identifying tags in their native data;
- stable tag IDs and user-facing labels;
- direct memberships and optional parent relationships;
- translating source changes into replacement tag input;
- domain meaning, actions, persistence, and source mutation; and
- mapping returned canonical IDs back to native objects.

Graph Engine owns:

- validating tag input;
- deterministic tag-node and generated-edge construction;
- collision-free canonical ID validation;
- constructing direct node-region definitions;
- cycle rejection for recursive tag-region closure;
- incremental reconciliation of generated topology;
- published generic tag tokens and relationship tokens;
- the default tag-parent relation layout policy; and
- identical behavior for every consumer supplying equivalent normalized input.

Graph Engine must not inspect Obsidian metadata, parse `#tag/path` syntax, infer a
lesson pack, or assume that a parent relation means semantic subsumption. Those are
consumer translations.

## 5. Public construction contract

The implementation should add an engine-owned pure projector rather than changing the
runtime meaning of `GraphDocumentV1`. Consumers provide a base canonical document and
normalized tag input; the projector returns a complete validated `GraphDocumentV1`.

An equivalent public shape is:

```ts
interface GraphTagDefinitionV1 {
  readonly nodeId: string;
  readonly label: string;
  readonly parentTagNodeIds?: readonly string[];
  readonly tokens?: readonly string[];
  readonly attributes?: Readonly<Record<string, GraphAttributeValue>>;
  readonly positionHint?: Vec3;
}

interface GraphTagMembershipV1 {
  readonly tagNodeId: string;
  readonly memberNodeId: string;
  readonly weight?: number;
}

interface GraphTagProjectionInputV1 {
  readonly version: 1;
  readonly tags: readonly GraphTagDefinitionV1[];
  readonly memberships: readonly GraphTagMembershipV1[];
}

function projectGraphTagsV1(
  base: GraphDocumentV1,
  input: GraphTagProjectionInputV1,
): GraphDocumentV1;
```

Exact exported names may follow repository conventions, but the ownership and data
must remain equivalent.

The consumer supplies final stable `nodeId` values. This preserves consumer lookup
and lets Graph+ retain its existing `tag:<normalized-tag>` IDs so saved positions,
pins, focus, selection, and checkpoints survive migration.

### 5.1 Validation

Projection is atomic. It rejects:

- duplicate tag node IDs;
- a tag node ID colliding with a base node ID unless an explicit future augmentation
  contract permits it;
- unknown tag IDs in memberships or parent relationships;
- unknown base member IDs;
- duplicate membership records;
- self-membership or self-parenthood;
- cycles through parent-tag relationships;
- non-finite or negative membership weights; and
- malformed tokens, attributes, or position hints under existing document rules.

A node may belong directly to any number of tags. A tag may have zero, one, or many
parents. A tag with no parents remains valid. A tag with no members remains an ordinary
canonical node but produces no empty rendered region.

### 5.2 Cycle-safe hierarchy and closure

Many-to-many parentage does not require cycles. Accepted parent-tag relationships form
a directed acyclic graph rather than requiring a strict tree. Shared descendants and
diamond-shaped hierarchy are valid; a tag being its own direct or indirect ancestor is
not.

Validation uses an iterative depth-first walk with `visiting` and `visited` states, or
an equivalent topological-sort algorithm. Encountering a `visiting` tag through a
child edge identifies a cycle and rejects the complete projection atomically. The
production implementation must not depend on JavaScript call-stack depth.

Recursive structural closure follows only accepted tag-parent relationships. Direct
tag memberships to ordinary nodes do not enlarge the parent-child tag distance; their
ordinary forces remain responsible for their own space. The traversal never follows
ordinary canonical graph edges. A per-root visited set ensures that a shared nested tag
region reached through several valid paths contributes once to that root's closure and
space estimate.

Closure indexes are derived and cached when accepted tag input or projection
visibility changes. They are not rebuilt during each simulation or rendering frame.

## 6. Generated canonical topology

For each accepted tag definition, the projector creates one ordinary canonical node:

```text
tokens include: kind:tag
attributes include: kind = tag
```

Consumer-supplied tokens and attributes are retained subject to validation. Published
engine tokens take precedence when a conflicting reserved value is supplied.

For each membership, the projector creates one directed relationship:

```text
member -> tag
relation:tag
```

For each parent relationship, it creates one directed relationship:

```text
parent tag -> child tag
relation:tag-parent
```

Generated edge IDs are deterministic from their role and endpoint IDs. Generated
records do not overwrite or merge consumer-owned canonical edges. Physical endpoint
aggregation may still combine their force evidence under the accepted topology
contract while preserving every canonical edge identity.

The projector also creates or merges the equivalent direct `nodeRegions` definitions:

- a tag's ordinary members are direct region members;
- its child tags are direct region members; and
- recursive region closure continues to follow only declared tag membership, never
  arbitrary ordinary links.

Any merge with consumer-supplied node-region definitions is deterministic and rejects
conflicting ownership rather than silently discarding members.

## 7. Tag-parent layout policy

### 7.1 Why tag-parent hubs differ

The general hub penalty encodes relationship specificity. A hierarchy parent is a
different structure: high degree is evidence that the node is functioning as a
center. Applying the ordinary penalty makes the parent-child springs longer and
softer precisely as the hierarchy becomes more established.

Generated `relation:tag-parent` pairs therefore use a hub-discount exponent of `0`:

```text
tagParentHubDiscount = pow(degreeProduct, 0) = 1
```

Evidence growth, reciprocity detection, finite validation, affinity normalization,
collision, repulsion, cooling, drag, pins, and component handling remain active unless
this contract explicitly overrides them.

### 7.2 Relative length and strength

Tag-parent layout never hard-codes a world-unit target length. It composes over the
ordinary topology-weighted pair parameters:

```text
tagParentBaseLength = ordinaryWeightedTargetLength * tagParentLengthScale
tagParentStrength = ordinaryWeightedStrength * tagParentStrengthScale
```

Recommended first-party defaults:

```text
tagParentLengthScale = 0.5
tagParentStrengthScale = 1.5
```

Changing the user's ordinary Link distance or Link force therefore changes tag
hierarchy geometry proportionally. The scales are finite, positive, bounded, and
profile-owned. No consumer may inject an executable force callback.

With the current default `linkDistance` of `250`, a baseline-affinity tag-parent pair
has a base target of `125`. Pairwise collision separately targets the sum of the two
resolved world radii, plus any configured collision gap, so leaf tags can remain close
to their parents without overlapping visible node geometry.

### 7.3 Recursive region space

A uniformly short parent-child distance is insufficient for a deep hierarchy. A child
tag may itself own a large descendant region that must remain separate from its sibling
regions. This is spatial allocation, not evidence that the parent-child relationship
is nonspecific, so it must not be represented by restoring the ordinary hub penalty.

Space is estimated from cached topology rather than a live rendered contour. Feeding
rendered boundary dimensions back into force targets would create a loop in which node
motion changes a boundary, the boundary changes the spring, and the spring causes more
node motion.

For tag `T`, define:

```text
closureSize(T) = 1 + count(unique visible nested tag regions beneath T)
unitSpacing = linkDistance * tagParentLengthScale + collisionGap
```

The initial dimension-aware footprint estimate is:

```text
requiredRadius2d(T) = unitSpacing / 2 * sqrt(closureSize(T))
requiredRadius3d(T) = unitSpacing / 2 * cbrt(closureSize(T))
```

The square root follows area growth in 2D; the cube root follows volume growth in 3D.
These are stable capacity estimates, not measurements of semantic importance or exact
rendered bounds.

For a parent-child pair whose child is `T`:

```text
leafFootprint = unitSpacing / 2
spaceExtension(T) = max(0, requiredRadius(T) - leafFootprint)
tagParentTargetLength = tagParentBaseLength + spaceExtension(T)
```

A leaf child has `closureSize = 1`, so its extension is zero and it retains the tight
base distance. A child containing four unique descendants has `closureSize = 5`; at
the current `125` unit spacing its estimated 2D radius is approximately `140`, giving
a baseline-affinity parent-child target near `202.5`.

Sibling tag regions continue to interact through ordinary node collision and
repulsion. A later accepted implementation may add cached region-level packing if live
fixtures show that node-level forces do not separate large sibling regions reliably.
Region overlap remains legal because tag membership and parentage are many-to-many;
space allocation is a soft layout influence rather than rigid containment.

The target is an equilibrium input, not a guarantee of exact final distance. Many
children must spread around their parent, and collision, repulsion, other links, pins,
and memberships remain authoritative participants.

### 7.4 Universal declarative topology policy

The current force settings expose individual global scalars such as
`evidenceLogFactor`, `reciprocalBoost`, and `hubDiscountExponent`. V2.0 gathers their
meaning into one immutable, validated topology-layout policy. Ordinary and specialized
relationships use the same policy-resolution and force pipeline.

An equivalent public shape is:

```ts
interface GraphEvidenceGrowthPolicyV1 {
  readonly curve: 'none' | 'log2';
  readonly coefficient: number;
}

interface GraphSpringMappingPolicyV1 {
  readonly strengthExponent: number;
  readonly lengthExponent: number;
  readonly minimumStrengthScale: number;
  readonly maximumStrengthScale: number;
  readonly minimumLengthScale: number;
  readonly maximumLengthScale: number;
  readonly targetLengthScale: number;
  readonly strengthScale: number;
}

interface GraphRecursiveRegionSpacingPolicyV1 {
  readonly mode: 'off' | 'target-region-closure';
}

interface GraphTopologyPairPolicyV1 {
  readonly evidenceGrowth: GraphEvidenceGrowthPolicyV1;
  readonly reciprocityScale: number;
  readonly hubDiscountExponent: number;
  readonly minimumAffinity: number;
  readonly maximumAffinity: number;
  readonly spring: GraphSpringMappingPolicyV1;
  readonly recursiveRegionSpacing: GraphRecursiveRegionSpacingPolicyV1;
}

interface GraphRelationPolicyOverrideV1 {
  readonly id: string;
  readonly edgeToken: string;
  readonly priority: number;
  readonly override: PartialGraphTopologyPairPolicyV1;
}

interface GraphTopologyLayoutPolicyV1 {
  readonly version: 1;
  readonly defaultPairPolicy: GraphTopologyPairPolicyV1;
  readonly relationOverrides: readonly GraphRelationPolicyOverrideV1[];
}
```

`PartialGraphTopologyPairPolicyV1` is a structural partial form defined by the public
contract; it does not accept functions, source text, or unbounded expressions. Exact
exported names may follow repository conventions.

The shipped default policy reproduces current ordinary topology behavior:

```text
evidence growth: log2, coefficient 0.35
reciprocity scale: 1.25
hub discount exponent: 0.25
affinity bounds: 0.2 through 2.5
spring strength exponent: 0.65
spring length exponent: -0.55
spring strength scale bounds: 0.35 through 2
spring length scale bounds: 0.55 through 1.85
target length scale: 1
strength scale: 1
recursive region spacing: off
```

The engine-owned tag-parent override is:

```text
edge token: relation:tag-parent
hub discount exponent: 0
target length scale: 0.5
strength scale: 1.5
recursive region spacing: target-region-closure
```

No force implementation branches on Obsidian, PatternSmith, vault paths, or consumer
identity. It resolves an effective pair policy and evaluates the same bounded
equations for every relationship.

### 7.5 Resolution and precedence

For every aggregated endpoint pair, Graph Engine:

1. starts with `defaultPairPolicy`;
2. selects relation overrides whose exact `edgeToken` occurs on the pair;
3. sorts matching overrides by ascending `priority`, then stable `id`;
4. applies structural field replacement in that order, so the highest priority wins
   for a field declared by several matches;
5. validates the resolved finite bounds and coefficients; and
6. calculates affinity, spring mapping, and optional structural spacing once.

Scales replace inherited scale fields; they are not repeatedly multiplied merely
because an edge carries several relation tokens. Input order and token order cannot
change the result. Duplicate override IDs or otherwise invalid policy snapshots reject
atomically.

### 7.6 Live policy replacement

A mounted session may accept a complete replacement
`GraphTopologyLayoutPolicyV1` through the existing engine settings/command boundary.
Replacement is atomic:

- validate and copy the complete immutable snapshot before activation;
- retain the previous policy if validation fails;
- invalidate cached effective pair policies and affected spring parameters;
- preserve canonical nodes and edges, positions, camera, pins, selection, focus,
  filters, and consumer state;
- reheat the free layout once without resetting coordinates; and
- persist only through the existing consumer/profile/session settings-precedence
  boundary.

The first implementation rebuilds all pair parameters on replacement. Later versions
may narrow work only through dependency-aware invalidation. A change to evidence,
reciprocity, hub discount, or affinity bounds can change the graph-wide median
reference and therefore requires renormalizing every active pair. A change confined to
post-affinity spring mapping may update only matching pairs when the resulting behavior
is identical. Policy evaluation and replacement are event-driven and never occur once
per frame.

Existing scalar settings migrate into the equivalent fields of
`defaultPairPolicy`. With no relation overrides, the numerical ordinary-layout oracle
must remain unchanged.

## 8. Membership behavior

`relation:tag` membership edges retain current topology-weighted spring behavior in
V2.0. The existing node-region membership force continues to provide bounded direct
group attraction.

This separation is intentional:

- tag-parent edges express the compact skeleton of a tag hierarchy;
- tag-membership edges connect ordinary nodes to that skeleton; and
- ordinary note links preserve associative graph geography.

Applying the tight parent-child rule to all tag memberships could collapse every note
carrying a popular tag into one dense ball. Any later membership-specific length rule
requires separate live evidence and review.

## 9. Graph+ migration

Graph+ will stop privately creating tag nodes, tag edges, tag-parent edges, and
`nodeRegions` definitions in `VaultGraphAdapter`.

Instead, it will:

1. read and normalize Obsidian tags exactly as it does today;
2. preserve existing `tag:<normalized-tag>` node IDs and labels;
3. translate nested paths into explicit parent tag IDs;
4. translate note assignments into explicit memberships;
5. pass the base note graph and tag input to the engine projector; and
6. retain its private lookup from generated canonical IDs to Obsidian files or tag
   actions.

Migration must produce equivalent canonical IDs and relationship directions so
existing persisted view state restores without a layout reset. A document revision
may change because ownership moved, but unchanged vault content must not churn node or
edge identities on every refresh.

PatternSmith may later supply lesson packs or other domain labels through the same tag
input. It remains free not to use tags where its structure is better represented by
ordinary nodes, edges, Form, or another future primitive.

## 10. Settings and UI

V2.0 requires no new Graph+ quick-setting control. Tag-parent layout ships as part of
the first-party profile's default structural behavior and continues to scale from the
existing Link distance and Link force settings.

The underlying bounded scales may remain profile settings for diagnostics and future
profile authoring. They should not be exposed merely because they exist internally.

Diagnostics should report:

- projected tag, membership, and parent-edge counts;
- cached closure counts and effective region-radius ranges;
- rejected projection reasons without consumer objects;
- active topology-layout policy version and resolved override counts;
- number of pairs matched by the tag-parent layout policy; and
- effective tag-parent length and strength ranges.

## 11. Acceptance criteria

The feature is accepted when automated fixtures and live Graph+ smoke testing show:

1. One ordinary node can belong to several tags without duplication.
2. One tag can contain many members, and one child tag can have several parents.
3. Parent cycles, unknown IDs, duplicates, and ID collisions reject atomically.
4. Generated IDs, edges, tokens, directions, and regions are deterministic under input
   reordering.
5. Equivalent tag input from two consumers produces equivalent engine topology.
6. Graph+ migration preserves existing tag-node IDs and persisted positions.
7. `#quote` remains a visual center while many child tags settle compactly around it.
8. Tag-parent pairs receive no hub discount as the parent's child count grows.
9. Above the collision-derived spacing floor, doubling Link distance approximately
   doubles tag-parent target lengths before equilibrium; no absolute tag distance
   remains hidden in the policy.
10. Leaf tag children retain the tight base distance regardless of ordinary note
    membership, while children with nested tag regions receive monotonically greater
    structural space.
11. Diamond-shaped hierarchy counts each shared descendant once per root, and very
    deep valid hierarchy does not depend on JavaScript call-stack depth.
12. Ordinary graph cycles do not enter tag traversal or invalidate tag projection.
13. Ordinary note-to-note hub pairs retain the accepted topology-weighted penalty.
14. Tag-membership edges do not silently acquire the tight parent-child scale.
15. Collision, pins, drag, filters, 2D/3D layout, suspension, and disposal retain their
    accepted behavior.
16. A large tag fixture does not introduce per-frame tag reconstruction or quadratic
    hierarchy analysis.
17. The generated client artifact and consumer smoke fixtures remain synchronized.
18. The default policy with no relation overrides matches the current ordinary-layout
    numerical oracle.
19. Relation-override resolution is independent of document edge order, token order,
    and override declaration order.
20. Replacing a valid policy on a mounted session retains graph and interaction state,
    rebuilds required spring parameters, and reheats once.
21. Replacing a policy with invalid curves, coefficients, priorities, or bounds leaves
    the prior policy and simulation state authoritative.

## 12. Non-goals

V2.0 does not include:

- discovering tags from arbitrary consumer data;
- parsing Obsidian tags or PatternSmith lesson packs inside Graph Engine;
- requiring tags to form a tree or exhaustive taxonomy;
- inferring parentage from labels, delimiters, paths, or spatial containment;
- automatic community detection or conversion of communities into tags;
- making region boundaries authoritative membership containers;
- applying tight hierarchy physics to ordinary tag membership;
- exposing arbitrary consumer force callbacks;
- evaluating or compiling consumer-authored mathematical expressions;
- guaranteeing exact settled distances in a multi-force simulation; or
- changing consumer domain data when a generated tag node is dragged or activated.

## 13. Review decisions

Approval of this design confirms:

1. `tag` is the generic public primitive because membership and optional hierarchy are
   many-to-many; taxonomy semantics are not required.
2. Consumers identify and normalize tags, while Graph Engine owns deterministic tag
   projection.
3. Projected tags remain ordinary canonical nodes usable by every existing engine
   facility.
4. The engine generates published membership and parent relation tokens plus matching
   node-region definitions.
5. Tag-parent hubness represents intended hierarchy and bypasses the ordinary hub
   discount.
6. Tag-parent distance and strength are scales of the active ordinary force settings,
   not fixed world-unit values.
7. Recursive child-region space is estimated from unique visible closure using
   dimension-aware area or volume growth, not live contour feedback.
8. Ordinary note links and tag memberships retain their existing topology behavior.
9. Graph+ preserves current tag IDs during migration so saved view state survives.
10. PatternSmith and other consumers may opt into the same tag facility without Graph
   Engine learning their source vocabulary.
11. Ordinary and specialized relationships resolve through one universal declarative
    topology-layout policy rather than separate solver branches.
12. The default policy explicitly represents today's ordinary relationship equations,
    and relation policies deterministically override selected fields.
13. Valid policies may be replaced atomically during a mounted session without
    changing canonical graph data or resetting view state.
14. Exact tuning remains subject to live acceptance, while ownership, proportional
    scaling, neutrality, and deterministic behavior are contract decisions.
