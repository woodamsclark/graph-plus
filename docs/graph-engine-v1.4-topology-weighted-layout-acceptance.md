# Graph Engine V1.4 Topology-Weighted Layout Acceptance Plan

Status: In progress; deterministic implementation evidence present, live acceptance pending

Baseline: Graph Engine V1.3

Date: 2026-08-27

Depends on: [Graph Engine V1.4 Topology-Weighted Layout Contract](graph-engine-v1.4-topology-weighted-layout-contract.md)

## 1. Purpose

This plan turns the V1.4 topology-weighted layout contract into observable,
release-blocking scenarios. It supplements the V1/V1.1 functional baseline, V1.2
scalability suite, and V1.3 region suite; it does not replace them.

V1.4 succeeds when the same neutral graph consistently produces tighter specific
neighborhoods, looser hub-mediated bridges, and separately packed disconnected
components without changing canonical data or requiring consumer knowledge.

## 2. Proof levels

| Level | Purpose | Environment |
| --- | --- | --- |
| C - Contract | Identity, aggregation, settings, ownership | Deterministic TypeScript tests |
| A - Analysis | Degree, reciprocity, relations, affinity invariants | Seeded topology-analysis harness |
| L - Layout | Distance, stiffness, settlement, components | Seeded force-layout harness |
| R - Regression | Regions, Filter, Form, pins, session isolation | Existing runtime suites |
| S - Scale | Analysis and active/settled frame cost | V1.2 benchmark harness |
| G - Graph+ | Neutral ingestion and visible geography | Fixture vault and live Obsidian |
| P - Platform | Desktop, popout, mobile, 2D, 3D | Physical or representative smoke |

### Current implementation evidence

The V1.4 implementation candidate passes 150 deterministic tests plus typecheck,
production build, external-client artifact synchronization, and `git diff --check`.
Tests cover endpoint-pair aggregation, parallel and consolidated evidence equivalence,
directed reciprocity, opaque relation channels, degree-aware hub discounting, bounded
weight magnitude, region-force coordination, event-driven invalidation, component
targets, weighted spring mapping, mode persistence, and state-preserving live mode
switches. They also cover sustained force heat for held node drags, release cooling,
orthographic node-radius scaling, perspective dolly scaling, and zoom-consistent hit
geometry.

The representative Graph+ document contains 1,410 nodes, 2,733 canonical edges, 2,603
non-self endpoint pairs, and 147 force components. Derived affinity spans `0.232` to
`2.5`, with p10 `0.511`, median `1.0`, and p90 `1.443`. Reciprocal low-degree pairs
occupy the strong end while hub-mediated `journal.md` pairs occupy the weakest end.
This is structural analysis evidence; visual acceptance after live settlement remains
outstanding.

The repeatable `weighted-stress-10000-2d` characterization uses 10,000 nodes, 30,000
canonical edges, a hub above degree 1,000, 20 opaque relation channels, parallel,
reciprocal, undirected, self-edge, weighted-edge, and approximately 500-component
cases. On the 2026-08-27 darwin-arm64 Node v25.1.0 run, mount took 146.46 ms and 60
active-layout frames reported module-tick p50 39.64 ms, p95 48.06 ms, and max 62.10
ms. Total frame time reported p50 73.54 ms and p95 90.74 ms. These numbers are
characterization evidence, not approved release budgets.

## 3. Required fixtures

### 3.1 `weighted-specificity`

- two equally sized local clusters;
- several low-degree internal endpoint pairs;
- one high-degree hub connected to both clusters;
- one ordinary bridge between clusters;
- stable seeded positions and no region definitions.

### 3.2 `weighted-evidence`

- an ordinary one-way pair with evidence mass `1`;
- an otherwise-equivalent reciprocal directed pair;
- otherwise-equivalent pairs with evidence masses `2`, `5`, and `100`;
- the same evidence represented once as parallel edges and once as one consolidated
  weighted edge;
- one self-edge and one undirected edge.

### 3.3 `weighted-relations`

- opaque `relation:a`, `relation:b`, and unknown `relation:arbitrary` channels;
- one endpoint with many `relation:a` edges and few `relation:b` edges;
- edges with multiple relation tokens;
- edges with no relation token;
- identical topology with relation names permuted.

### 3.4 `weighted-regions`

- one region owner and three direct members;
- a canonical edge coinciding with every direct membership;
- one member belonging directly to two regions;
- ordinary internal and external edges;
- region forces enabled and disabled variants.

### 3.5 `weighted-components`

- one large component;
- three small multi-node components;
- ten isolated nodes;
- one filtered bridge that splits a component;
- one added bridge that merges two components;
- pinned nodes in the large component and one small component.

### 3.6 `weighted-stress`

The deterministic stress fixture contains at least:

- 10,000 canonical nodes and 30,000 canonical edges;
- a power-law-like degree distribution with one hub above degree 1,000;
- parallel, reciprocal, undirected, and self-edge cases;
- at least 20 sparse opaque relation channels;
- at least 500 connected components including isolated nodes;
- optional active region memberships overlapping canonical endpoint pairs;
- visible projections retaining 100%, 50%, and 10% of topology.

The fixture generator records its seed and graph revision.

## 4. Contract and ownership acceptance

### C-OWN-01 - Neutral consumer boundary

Given two consumers submit structurally identical `GraphDocumentV1` values with
different labels and domain attributes, when topology weighting runs, then their
derived topology summaries and affinities are equivalent.

### C-OWN-02 - No consumer affinity input required

Given a valid document containing only canonical nodes and edges, when
`topology-weighted` mode starts, then the engine derives a complete valid layout
without consumer-supplied hub scores, reciprocal flags, affinity values, target
lengths, or force strengths.

### C-OWN-03 - Consumer semantics cannot select force policy

Given relation tokens are renamed while their structural partition is preserved, when
analysis runs, then the result is equivalent apart from diagnostic token labels.

### C-DATA-01 - Canonical identity preservation

Given any valid fixture, when weighted mode is enabled, disabled, settled, exported,
or restored, then every canonical node and edge retains its ID, endpoints, direction,
weight, tokens, attributes, and query identity.

### C-DATA-02 - Derived data is private

Given an analyzed graph, when its public document and canonical checkpoint are
exported, then no effective affinity, degree table, reciprocal index, physical
endpoint-pair record, or component bound appears as authoritative graph data.

## 5. Topology-analysis acceptance

### A-PAIR-01 - One physical pair, multiple canonical edges

Given parallel and reciprocal canonical edges share two endpoints, when the force
topology is built, then all canonical edges remain observable while exactly one
ordinary physical spring represents their unordered endpoint pair.

### A-PAIR-02 - Consolidated and parallel evidence equivalence

Given one pair has five parallel weight-1 edges and another otherwise-equivalent pair
has one weight-5 edge, when analysis runs, then their accumulated evidence mass and
effective affinity are equivalent within deterministic numeric tolerance.

### A-PAIR-03 - Self-edge preservation

Given a canonical self-edge, when analysis and layout run, then the edge remains
available to rendering and queries but contributes no positional spring or non-finite
force.

### A-DIRECTION-01 - Reciprocity detection

Given directed evidence exists from A to B and B to A, when analysis runs, then the
endpoint pair is reciprocal regardless of input order or canonical edge IDs.

### A-DIRECTION-02 - Symmetry is not directed reciprocity

Given only one undirected A-B edge, when analysis runs, then it creates symmetric
connectivity but does not receive the directed-reciprocity boost.

### A-DEGREE-01 - Deterministic degree statistics

Given fixed visible topology, when analysis runs repeatedly, then total, inbound,
outbound, weighted, and relation-channel degree statistics are identical and finite.

### A-RELATION-01 - Opaque channels

Given `weighted-relations`, when analysis runs, then known, unknown, and renamed
`relation:*` channels use the same rules without registration or semantic ranking.

### A-RELATION-02 - Sparse channel specificity

Given a node has many `relation:a` neighbors and only one `relation:b` neighbor, when
otherwise-equivalent evidence is compared, then high total degree alone does not erase
the structurally rare `relation:b` relationship.

### A-RELATION-03 - Bounded multiple-channel effect

Given an edge carries many distinct relation tokens, when analysis runs, then its
affinity remains within the same published global bounds and does not grow linearly
with token count.

## 6. Affinity acceptance

### A-AFFINITY-01 - Evidence monotonicity

Given otherwise-equivalent pairs with increasing positive evidence mass, when affinity
is derived, then affinity never decreases solely because evidence increased.

### A-AFFINITY-02 - Diminishing returns

Given evidence masses `1`, `2`, `5`, and `100`, when affinity is derived, then each
increase remains bounded and the weight-100 pair is not treated as a spring 100 times
stronger than the weight-1 pair.

### A-AFFINITY-03 - Bounded reciprocity

Given otherwise-equivalent one-way and reciprocal pairs, when affinity is derived,
then the reciprocal pair is stronger, remains within published bounds, and does not
receive two independent ordinary springs.

### A-AFFINITY-04 - Hub discount

Given equal-evidence pairs where one joins two low-degree endpoints and the other is
incident to a very high-degree hub, when affinity is derived, then the specific
low-degree pair has greater affinity.

### A-AFFINITY-05 - Leaf bound

Given a degree-1 pair, when affinity is derived, then it remains finite and no greater
than the published maximum.

### A-AFFINITY-06 - Zero evidence

Given an endpoint pair whose only canonical edge has weight zero, when analysis runs,
then the edge remains canonical but supplies no ordinary physical spring evidence.

### A-AFFINITY-07 - Negative weight magnitude

Given otherwise-equivalent edges weighted `-5` and `5`, when physical evidence is
derived, then their evidence magnitudes are equivalent while their canonical weights
remain unchanged.

### A-AFFINITY-08 - Order independence

Given identical documents with nodes, edges, and tokens in different valid orders,
when analysis runs, then every endpoint pair receives equivalent affinity.

## 7. Force-layout acceptance

### L-SPRING-01 - Affinity changes strength and length

Given low-, baseline-, and high-affinity endpoint pairs in equivalent conditions, when
their spring parameters are inspected, then high affinity is shorter and stiffer,
baseline matches the profile baseline, and low affinity is longer and softer.

### L-SPRING-02 - Bounded smooth mapping

Given evidence near every clamp and curve transition, when spring parameters are
derived, then values remain finite, within configured limits, and free of discontinuous
jumps large enough to destabilize settlement.

### L-SPRING-03 - Specific neighborhoods emerge

Given `weighted-specificity`, when seeded layout settles in weighted mode, then each
local cluster has a smaller internal median endpoint distance than its hub-mediated or
cross-cluster bridges.

### L-SPRING-04 - Hub does not collapse geography

Given `weighted-specificity`, when weighted and uniform seeded layouts are compared,
then the weighted layout preserves hub connectivity while producing greater separation
between the two local-cluster centroids without exceeding world or stability bounds.

### L-SPRING-05 - Pins remain authoritative

Given pinned and unpinned endpoints, when weighting changes or the layout reheats, then
pinned coordinates remain unchanged and unpinned neighbors settle around them.

### L-SPRING-06 - 2D and 3D support

Given the same fixture in allowed 2D and 3D free-layout profiles, when weighted layout
settles, then both use the same topology analysis and bounded affinity policy in their
active dimensions without presenting V1.3 boundaries as 3D regions.

### R-DRAG-01 - Held drag remains live

Given a node drag lasts longer than the layout's ordinary cooling period, when the
pointer remains captured and the node moves again, then the force layout retains a
bounded interaction heat floor and neighboring unpinned nodes continue responding.

### R-DRAG-02 - Release restores cooling

Given an actively dragged node, when drag-end or transient-state cancellation occurs,
then the private drag signal clears and normal cooling, settlement, and configured pin
release behavior resume.

### R-CAMERA-01 - Orthographic node scaling

Given a 2D graph at two valid camera zoom levels, when the same node renders, then its
screen radius changes by the projection-scale ratio while its canonical radius and
world position remain unchanged.

### R-CAMERA-02 - Perspective node scaling

Given a 3D graph whose camera dollies toward or away from a node, when the node
renders, then its screen radius increases or decreases with projected depth while the
stock perspective camera retains its established baseline size.

### R-CAMERA-03 - Visible and interactive radius agree

Given any valid zoom in 2D or 3D, when node rendering, culling, edge clipping, label
placement, and hit testing use the projection, then all consume the same bounded
projected radius.

## 8. Region coordination acceptance

### R-REGION-01 - No unrestricted double attraction

Given a canonical endpoint pair also represents active direct region membership, when
combined force parameters are inspected, then ordinary and membership attraction share
the configured pair-level budget rather than applying two unrestricted baseline pulls.

### R-REGION-02 - Canonical edge remains visible and queryable

Given ordinary spring contribution is coordinated with active membership, when the
frame renders and queries run, then every canonical edge retains its normal render,
filter, query, direction, and interaction behavior.

### R-REGION-03 - Membership toggle reconciliation

Given a coincident canonical pair, when region membership force is disabled and then
enabled, then pair-level force parameters reconcile once, no canonical data changes,
and the layout does not retain stale double attraction.

### R-REGION-04 - Overlap remains normalized

Given one node belongs directly to multiple regions, when topology weighting and
membership forces are active, then its total membership influence still satisfies the
V1.3 normalization bound.

## 9. Component-packing acceptance

### L-COMPONENT-01 - Disconnected components do not share one center

Given `weighted-components`, when layout settles, then component bounds do not
substantially overlap except where pins make separation impossible.

### L-COMPONENT-02 - Collection remains centered

Given multiple unpinned components, when layout settles, then their packed collection
remains within the configured world envelope and does not drift indefinitely.

### L-COMPONENT-03 - Isolated nodes are components

Given isolated nodes, when components are built and packed, then each is retained as a
one-node component with deterministic padding and no invalid force.

### L-COMPONENT-04 - Split reconciliation

Given Filter hides the only bridge between two subgraphs, when projection commits,
then the affected topology becomes two layout components, repacks once, and unrelated
components retain their existing analysis.

### L-COMPONENT-05 - Merge reconciliation

Given an edge is added between two components, when the document revision commits,
then they become one component, obsolete packing state is released, and the affected
layout reheats once.

### L-COMPONENT-06 - Pinned component constraint

Given a component contains pinned nodes, when packing runs, then pinned coordinates
remain authoritative and other components avoid its effective bounds where practical.

## 10. Projection, settings, and lifecycle acceptance

### R-PROJECT-01 - Projection topology only

Given a projection-scope Filter excludes nodes and edges, when topology analysis runs,
then excluded topology contributes no active degree, affinity, spring, relation
channel, or component connection. Given the same request uses render scope, then the V1
contract retains underlying topology and layout forces.

### R-PROJECT-02 - Transactional replacement

Given one accepted document or Filter transaction, when analysis reconciles, then no
frame observes mixed old and new pair, degree, affinity, or component indexes.

### C-SETTING-01 - Engine-owned quick setting

Given a profile exposes shipped force-layout settings, when quick settings opens, then
one engine-owned control offers `Topology weighted` and `Uniform` without a private
Graph+ implementation.

### C-SETTING-02 - Weighted default and compatibility override

Given no explicit override, when a first-party free-layout session starts, then
`Topology weighted` is effective. Given an explicit saved `Uniform` override, then it
remains effective through the existing settings-precedence chain.

### C-SETTING-03 - Mode switch preserves view state

Given a running session, when weighting mode changes, then canonical data, positions,
camera, Filter, focus, selection, pins, and region visibility remain intact as starting
state while the force layout reheats once.

### R-FORM-01 - Form remains authoritative

Given a Form projection with derived positions and free-layout forces disabled, when
topology weighting is the saved default, then it does not silently perturb Form
positions.

### R-LIFECYCLE-01 - Session isolation

Given simultaneous sessions with different documents and modes, when both run, then
their topology indexes, affinities, components, settings, and invalidations remain
isolated.

### R-LIFECYCLE-02 - Suspension and disposal

Given analysis or layout work is active, when a session suspends or disposes, then all
private topology and component work stops and releases its resources.

## 11. Performance acceptance

### S-ANALYSIS-01 - Event-driven analysis

Given a settled unchanged graph, when at least 1,000 frames render, then degree,
reciprocity, relation, endpoint-pair, and component analysis counters do not increase.

### S-ANALYSIS-02 - No quadratic hub scan

Given `weighted-stress`, when topology analysis runs, then work scales with nodes,
edges, and present relation memberships rather than all neighbor pairs of the largest
hub.

### S-ANALYSIS-03 - Aggregated spring count

Given parallel canonical edges, when active force diagnostics are inspected, then the
ordinary physical spring count is no greater than the number of distinct non-self
endpoint pairs.

### S-ANALYSIS-04 - Bounded invalidation

Given one edge weight, direction, token, or endpoint changes, when the revision commits,
then the engine updates affected pair, endpoint, channel, and component data without
blindly rebuilding unrelated session or renderer state.

### S-FRAME-01 - Benchmark budgets

Given `weighted-stress`, when analysis, active settlement, settled frames, 50% Filter,
and component split/merge runs are benchmarked, then release budgets are explicitly
approved and met on the reference environment. Characterization numbers alone do not
constitute acceptance.

## 12. Graph+ and platform smoke acceptance

### G-ADAPTER-01 - No Graph+ weighting policy

Given the Graph+ adapter source, when reviewed, then it creates canonical graph
evidence but contains no hub discount, reciprocity boost, effective affinity, target
spring length, or spring-strength policy.

### G-ADAPTER-02 - Supported evidence forms

Given duplicate vault links are preserved as consolidated edge weight or parallel
records, when Graph Engine receives the document, then it analyzes them through the
same neutral evidence path used by synthetic consumers.

### G-LIVE-01 - Visible heterogeneous geography

Given the representative live Graph+ vault, when uniform and topology-weighted modes
settle from recorded starting positions, then weighted mode visibly produces local
neighborhoods and longer hub-mediated bridges without missing nodes, broken edges,
runaway components, or unusable camera bounds.

### G-LIVE-02 - Region regression

Given live Graph+ tag regions, when topology weighting is active, then boundaries,
membership, overlap, first-click selection, focus, camera fit, and boundary visibility
continue to satisfy V1.3 while coincident membership does not overcompress clusters.

### P-PLATFORM-01 - Host matrix

Given desktop main window, popout, representative mobile, 2D, and allowed 3D sessions,
when weighted mode starts, switches, settles, suspends, and disposes, then behavior is
stable and controls remain usable.

## 13. Release gate

V1.4 is release-ready only when:

- deterministic contract, topology-analysis, force, component, region, settings, and
  lifecycle scenarios pass;
- V1/V1.1, V1.2, and V1.3 regression suites remain green;
- typecheck, production build, client-artifact synchronization, and `git diff --check`
  pass;
- weighted-stress budgets are approved and met;
- Graph+ contains no private weighting implementation;
- live Graph+ demonstrates accepted heterogeneous geography in both modes;
- desktop, popout, representative mobile, 2D, and allowed 3D smoke evidence is
  recorded;
- remaining visual edge-density, node-prominence, semantic-zoom, and Anima work is
  explicitly recorded as deferred rather than silently included.

Live visual, platform, and explicit performance-budget acceptance remain required
before V1.4 release status.
