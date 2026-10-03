# Graph Engine Reflex, Memory, Association, and Reaction Contract

Status: Implemented foundation

Date: 2026-09-30

## Ownership

Graph Engine has two independent temporal systems.

**Reflex** is subject-local autonomic recognition. A Reflex retains a short-lived
immutable receipt, recognizes a later stimulus, and lets its owning subject decide the
response. It is session-transient and does not enter conscious associative memory. The
primary-tap Reflex is the first implementation: an eager first tap records press and
release evidence, a matching second press restores the intended interaction state, and
a quick stationary release earns activation. A stationary 450 ms primary node hold
enters Focus without requiring a prior tap, while second-press movement over a node drives a reversible camera
transition into the canonical Focus fit. These are alternative outcomes of one Reflex,
not parallel double-click recognizers.

**Memory → Association → Reaction → Ego** belongs to presentation-scoped
Consciousness. Semantic observations enter Memory. Association compares those
observations with validated consumer criteria. A match creates a semantic Reaction
intent. Ego adjudicates that intent before an existing registered capability may act.
The initial Ego policy accepts every structurally valid Reaction unchanged; the seam is
deliberately real so later experience, safety, or attention policies can constrain it.

```text
local stimulus → receipt → Reflex → local response

semantic observation → Memory → Association → Reaction → Ego → capability
```

## Memory

Memory records host-neutral observation type, stable subject ID, and monotonic
timestamp. The initial observation vocabulary is:

- node activated;
- node selected;
- node focused; and
- node drag ended.

Memory is persisted inside compatible session view state under the reserved
`conscious-memory-v1` key. It contains no note contents, pointer trails, arbitrary
consumer values, functions, or host-specific objects.

Memory remains bounded per observation/subject key through exponential compaction.
Recent observations remain exact. When a level exceeds two buckets, its two oldest
buckets merge into the next level and retain total count, first timestamp, last
timestamp, and weighted-average timestamp. Lifetime counts therefore remain exact
while stored bucket count grows logarithmically. The complete pool also has a fixed
4,096-bucket ceiling. Beyond it, the oldest buckets of the same observation type merge
into anonymous historical summaries: historical mass and timing survive, while very
old subject identity fades and can no longer satisfy a subject-specific association.
Counts inside a time window are exact
for uncompacted observations and estimated proportionally for an older bucket that
crosses the window boundary.

## Association and Reaction registration

Consumers register declarative associations through their existing engine lease. A
registration declares an observation type, occurrence threshold, optional time window,
optional repetition, and the ID of an already registered node action. Registrations
are lease-scoped and disposable. The additive public surface is advertised by the
`conscious-reactions` capability so older protocol-v1 providers remain distinguishable.

Consumers do not supply matcher functions or callbacks to Consciousness. They cannot
read another consumer's registrations, execute arbitrary commands, inspect raw global
memory, or attach code to the persistence payload. A Reaction can invoke only a node
action registered by the same lease and only when its remembered subject still exists
in the active document. Action availability, busy isolation, and failure handling remain
owned by the existing node-action capability.

## Current limits

The foundation recognizes occurrence thresholds for one stable node subject. It does
not yet expose cross-subject sequences, negative conditions, arbitrary event
publication, memory inspection/reset UI, global cross-session memory, or user-authored
code. Those features require explicit contracts rather than widening this registry
implicitly.
