# Graph Engine V1.4 Topology-Weighted Layout Contract

Status: Approved; implementation candidate complete, live acceptance pending

Baseline: Graph Engine V1.3

Date: 2026-08-27

Depends on:

- [Graph+ and Graph Engine V1.1 Architecture and Contracts](graph-engine-v1-contracts.md)
- [Graph Engine V1.2 Scalability Contract](graph-engine-v1.2-scalability-contract.md)
- [Graph Engine V1.3 Tag Regions Contract](graph-engine-v1.3-tag-regions-contract.md)
- [Graph Engine V1.4 Topology-Weighted Layout Acceptance Plan](graph-engine-v1.4-topology-weighted-layout-acceptance.md)

## 1. Purpose

V1.4 makes free-layout graph geography reflect the structure already present in a
`GraphDocumentV1`. Instead of treating nearly every edge as an equal-strength spring
with one target length, Graph Engine derives bounded layout affinity from topology and
uses it to form compact local neighborhoods, loose bridges, legible hubs, and packed
connected components.

This is an engine feature, not a Graph+ semantic policy. Any consumer that supplies a
neutral graph can receive the same analysis without teaching Graph Engine what its
nodes or relationships mean.

The governing rule is:

> Consumers describe what exists; Graph Engine measures that topology and lays it out.

## 2. Compatibility statement

V1.4 is additive to the public graph model and preserves canonical node and edge
identity. It does not rewrite consumer documents, redirect edges, infer domain meaning,
or persist derived affinity as canonical data.

The shipped force-layout module supports two modes:

- `uniform`: the compatibility behavior in which canonical edges use their existing
  spring treatment;
- `topology-weighted`: the V1.4 behavior defined by this contract.

`topology-weighted` is the Graph Engine and first-party free-layout default. An explicit
saved profile, user-profile, or session override selecting `uniform` remains
authoritative through the existing settings-precedence chain. Form-derived positions
remain governed by Form and do not silently acquire free-layout forces.

V1.4 applies in both 2D and 3D free layouts. Component packing and force calculations
operate in the active dimensions. The V1.3 region-boundary renderer remains 2D-only.

## 3. Ownership boundary

Graph Engine solely owns:

- topology indexing and invalidation;
- endpoint-pair aggregation for physical layout;
- parallel-edge and supplied-weight evidence;
- directed reciprocity detection;
- total, inbound, outbound, weighted, and relation-channel degree statistics;
- connected-component analysis;
- hub discounting and affinity normalization;
- mapping affinity to spring strength and target length;
- maintaining force-layout responsiveness for the complete node-drag lifecycle;
- coordination between ordinary springs and direct region-membership forces;
- component-level centering and packing;
- the weighted-layout mode and its stock quick setting;
- deterministic diagnostics, performance, suspension, and disposal.

Consumers solely own:

- converting their native source into canonical nodes and edges;
- preserving whatever source evidence they want represented in the graph document;
- assigning stable IDs, direction, optional numeric weights, opaque tokens, and
  attributes;
- domain meaning, persistence, actions, and product UI.

Graph+, PatternSmith, and other consumers do not calculate effective layout affinity,
hub scores, reciprocity boosts, target spring lengths, or force strengths.

### 3.1 Faithful input, not consumer weighting

Graph Engine can analyze only information present in the accepted graph document. A
consumer may represent repeated evidence as either:

- multiple canonical edge records, including parallel edges; or
- one consolidated canonical edge whose supplied `weight` carries the accumulated
  evidence.

Both forms are valid inputs to the same engine analysis. Omitting or consolidating
source information is a consumer ingestion decision, not an engine weighting policy.
Graph Engine is not required to reconstruct source events absent from the document.

## 4. Terminology

- **Canonical edge:** one public `GraphEdgeV1`, retained unchanged for identity,
  filtering, rendering, queries, actions, and export.
- **Endpoint pair:** the unordered pair of canonical node IDs joined by one or more
  visible canonical edges.
- **Evidence mass:** the non-negative magnitude contributed by a visible edge to its
  endpoint pair. The default contribution is `abs(edge.weight ?? 1)`.
- **Parallel multiplicity:** the number of visible canonical edge records joining the
  same endpoint pair, independent of direction.
- **Reciprocal pair:** an endpoint pair containing directed evidence in both
  directions. An undirected edge alone is symmetric but is not a reciprocal directed
  pair.
- **Relation channel:** an opaque edge category identified by a `relation:*` token.
  Edges without such a token participate in a deterministic default channel.
- **Structural degree:** degree measured from the active visible topology, optionally
  weighted and partitioned by relation channel.
- **Layout affinity:** private, bounded engine output describing how short and stiff an
  endpoint pair's physical spring should be relative to the profile baseline.
- **Layout component:** a connected component of the active force topology, including
  visible spring pairs and active direct region-membership relationships.

## 5. Canonical edge preservation and physical aggregation

Topology weighting never combines, removes, or edits canonical edges. Rendering,
selection, filtering, queries, direction indicators, relation presentation, and export
continue to observe every canonical edge separately.

For physics, Graph Engine aggregates visible canonical edges by unordered endpoint
pair and applies at most one ordinary physical spring per pair. This prevents parallel
or reciprocal records from accidentally becoming several unbounded independent
springs. Their evidence still contributes to the aggregated pair.

For each endpoint pair, the topology index records at least:

- canonical edge IDs;
- accumulated evidence mass;
- parallel multiplicity;
- presence of directed evidence in each direction;
- presence of undirected evidence;
- distinct relation channels;
- endpoint total and relation-channel degrees;
- active direct region-membership overlap, when any.

Self-edges remain canonical but contribute no positional spring because they cannot
define a distance between distinct nodes.

## 6. Opaque relation handling

Graph Engine treats relation tokens as categorical topology, not vocabulary. It may
compare `relation:x` with other occurrences of `relation:x`, but it must never infer
that `x` is intrinsically stronger, more important, causal, pedagogical, or otherwise
meaningful.

Relation channels affect normalization rather than receiving hard-coded semantic
rankings:

- degree and specificity may be measured within each channel so a node's many edges in
  one channel do not automatically erase a rare relationship in another;
- an edge with multiple relation tokens participates deterministically in each channel;
- the number or spelling of relation tokens does not create an unbounded force boost;
- unknown relation tokens require no registration and receive the same algorithm;
- edges with no `relation:*` token use the default channel.

Non-relation tokens remain available to other engine facilities but do not affect the
shipped topology-weighted policy unless a later generic contract explicitly says so.

## 7. Affinity contract

The exact implementation formula is private so the engine can improve it without
changing canonical data. The shipped algorithm must nevertheless satisfy these
observable invariants for otherwise equivalent graphs:

1. Greater positive evidence mass never produces lower affinity solely because the
   evidence increased.
2. Repeated evidence has diminishing returns; raw counts are never used as an
   unbounded linear spring multiplier.
3. A reciprocal directed pair receives a bounded increase over the corresponding
   otherwise-equivalent one-way pair.
4. A relationship incident to a very high-degree endpoint is discounted relative to
   an equally evidenced relationship between more specific endpoints.
5. Relation-channel degree can preserve a relationship that is rare in its channel
   even when an endpoint has high total degree.
6. Leaf relationships remain connected but are not promoted to unbounded attraction.
7. Every effective affinity is finite, deterministic, and clamped to published
   profile-safe bounds.
8. Input order, canonical IDs' lexical order, and frame rate do not change the result.

The recommended shipped profile uses an effective affinity range equivalent to
approximately `0.2` through `2.5`, with logarithmic or eased evidence growth and a
degree-aware specificity discount. Those numbers are tuning defaults rather than new
canonical-document semantics.

Negative supplied weights retain any meaning they have for queries or rendering, but
their magnitude supplies non-negative physical evidence. A weight of zero supplies no
ordinary spring evidence. Invalid non-finite values continue to be rejected at the
document boundary.

## 8. Force mapping

Topology weighting must affect both spring stiffness and target length.

- Higher affinity produces a shorter, stiffer spring within configured bounds.
- Baseline affinity produces the profile's ordinary spring behavior.
- Lower affinity produces a longer, softer spring that preserves connectivity while
  allowing communities to separate.
- Mapping uses a smooth bounded curve rather than raw multiplication.
- Cooling, velocity decay, collision, repulsion, pins, drag behavior, and reheating
  remain compatible with the existing force-layout lifecycle.

### 8.1 Sustained drag lifecycle

An accepted node drag is active from its drag-start command through drag-end or
transient-state cancellation. While that lifecycle remains active, the force module
maintains a bounded interaction heat floor and may not declare the layout settled.
This lets neighboring nodes continue reacting when the dragged node moves after a
long pointer hold. The dragged node's temporary or persistent pin remains
authoritative. Once the drag ends, ordinary cooling and the configured release policy
resume without a second gesture or consumer intervention.

The active dragged-node identity is private runtime pipeline state. It is not written
to `GraphViewStateV1`, canonical graph data, checkpoints, or consumer settings.

### 8.2 Camera-scaled node geometry

V1.4 treats a node's canonical render radius as world-relative geometry for camera
projection. Orthographic zoom and perspective camera depth therefore change the
node's projected screen radius. The same projected radius is used for node drawing,
viewport culling, edge endpoints, label offsets, and hit testing so interaction never
diverges from the visible node.

Projection scale is finite and bounded by the engine camera limits. Zooming changes
neither the canonical radius nor node positions, layout mass, topology affinity, or
persistence. This is camera scaling, not degree-based node prominence or semantic
zoom.

Recommended first-party free-layout characterization ranges are:

| Effective relationship | Target length | Relative behavior |
| --- | ---: | --- |
| strong and specific | 60-80 px | compact and stiff |
| ordinary | 110-130 px | baseline |
| weak or hub-mediated bridge | 160-220 px | loose and soft |

Profiles may tune safe bounds through declarative settings. Consumers do not receive
custom executable force callbacks.

## 9. Region-membership coordination

Node regions remain generic engine topology. Graph Engine does not need to know that a
region represents a tag.

When an active direct region-membership relationship joins the same endpoint pair as
one or more canonical edges, ordinary spring attraction and membership attraction must
share a bounded pair-level attraction budget. They must not stack as two unrestricted
copies of the same grouping force.

This coordination:

- changes no canonical edge or region definition;
- does not suppress edge rendering, filtering, queries, or interaction;
- applies only while the membership force is active in the current projection;
- preserves independent evidence among the endpoint pair without double-applying the
  baseline attraction;
- remains normalized for nodes belonging directly to multiple regions as required by
  V1.3.

## 10. Component-aware centering and packing

Global per-node centering must not pull every disconnected component toward the same
origin. In topology-weighted mode, Graph Engine derives layout components from the
active force topology and treats each component as a packable unit.

- Internal forces lay out each component without knowledge of domain meaning.
- Centering acts on component centroids or bounds rather than independently collapsing
  every node onto the global center.
- Component bounds repel or pack with deterministic padding so unrelated components do
  not settle on top of one another.
- The collection of components remains centered in the available world rather than
  drifting indefinitely.
- Adding, removing, or filtering an edge may split or merge components and reheats only
  the affected layout work plus necessary packing neighbors.
- A component containing one isolated node remains a valid packable component.
- Pins remain authoritative; packing must not move a pinned node directly.

Component packing improves geography between disconnected islands. Weighted springs
remain responsible for heterogeneity inside a large connected component.

## 11. Projection, updates, and persistence

Analysis uses the active topology projection:

- nodes and edges excluded by a projection-scope Filter contribute no active degree,
  affinity, spring, or layout component;
- render-scope Filter retains the V1 contract: it changes presentation and hit testing
  while leaving underlying topology and layout forces intact;
- Filter or document changes atomically replace affected topology indexes;
- camera, hover, focus, selection, labels, and boundary visibility do not recompute
  topology weighting;
- direction, weight, token, endpoint, visibility, region membership, and dimension
  changes invalidate only the necessary derived work;
- simultaneous sessions retain isolated topology indexes and settings;
- suspension and disposal release all private analysis and packing work.

Effective affinity, degree tables, reciprocal indexes, endpoint-pair aggregation, and
component bounds are derived runtime state. They are not persisted in
`GraphDocumentV1`, consumer canonical storage, or graph checkpoints as authoritative
graph data. The selected layout mode and declarative tuning overrides may use the
existing namespaced view/profile persistence boundary.

## 12. Quick settings

Graph Engine owns a stock free-layout control with a published ID such as
`force-layout.weighting-mode` and choices equivalent to:

- `Topology weighted`;
- `Uniform`.

Graph+ may expose the stock control through its quick-settings surface but does not
recreate, translate, or privately implement it. Other consumers receive the same
control when their profile exposes the shipped force-layout settings section.

Changing modes:

- changes no canonical graph data;
- retains current positions as the starting state;
- rebuilds the required private topology index;
- reheats the layout once;
- does not reset camera, Filter, focus, selection, pins, or region visibility;
- respects reduced-motion policy for any nonessential visual interpolation.

## 13. Performance and diagnostics

V1.4 inherits the V1.2 rule: safe public snapshots and efficient private frame-loop
state.

- Topology analysis is event-driven, not repeated every frame.
- A settled graph performs no continuous degree, reciprocity, relation, or component
  recomputation.
- Per-frame force work is proportional to active aggregated endpoint pairs, not larger
  than canonical edge count because of parallel records.
- Large-degree hubs do not introduce quadratic neighbor-pair comparison.
- Relation-channel indexes are sparse and include only channels present in the active
  graph.
- Diagnostics may expose immutable summaries and effective ranges, but never mutable
  internal maps or consumer-specific semantic claims.
- Benchmarks characterize analysis, active settlement, settled frames, Filter
  invalidation, and component split/merge behavior.

Exact release budgets and fixtures are defined in the acceptance plan.

## 14. Non-goals and deferrals

V1.4 does not include:

- consumer-authored or domain-specific weighting callbacks;
- hard-coded knowledge of notes, tags, courses, citations, lessons, or any named
  relation vocabulary;
- automatic community labels or claims about semantic clusters;
- Louvain, Leiden, or another community-detection result as canonical graph data;
- changing edge opacity, color, width, arrows, bundling, or label visibility;
- degree-, centrality-, or semantics-based node sizing, mass, or visual prominence;
- semantic zoom, expansion, collapse, or Drill transitions;
- changing region boundary geometry or Anima behavior;
- guaranteeing identical final floating-point coordinates across different hardware;
- reconstructing source relationships omitted before document ingress.

Visual edge-density reduction and node-prominence work may follow after the weighted
layout is accepted against live graphs.

## 15. Review decisions

Approval of this contract confirms:

1. Topology weighting is solely a Graph Engine responsibility.
2. Consumers faithfully supply neutral graph evidence but calculate no layout affinity.
3. Parallel records and consolidated numeric weights are both valid evidence forms.
4. Graph Engine detects reciprocity, degrees, relation channels, endpoint pairs, and
   components without domain knowledge.
5. Relation names are opaque categories and receive no semantic ranking.
6. Physical springs are aggregated per unordered endpoint pair while canonical edges
   remain unchanged.
7. Affinity has diminishing returns, discounts hubs, is bounded, and affects both
   target length and stiffness.
8. Active region membership cannot double-apply unrestricted attraction for the same
   endpoint pair.
9. Disconnected components are centered and packed as units rather than independently
   pulled onto one origin.
10. `Topology weighted` is the shipped free-layout default and `Uniform` remains an
    engine-owned compatibility mode exposed through stock quick settings.
11. Active dragging keeps bounded force heat until release, after which ordinary
    cooling resumes.
12. Node drawing and hit geometry scale together with the 2D or 3D camera without
    changing canonical radius or topology.
13. Rendering declutter, topology-derived node prominence, semantic zoom, and
    consumer-specific meaning remain outside V1.4.

Release acceptance remains governed by the linked acceptance plan.
