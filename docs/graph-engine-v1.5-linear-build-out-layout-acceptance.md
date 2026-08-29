# Graph Engine V1.5 Linear Build-out Layout Acceptance

Status: automated acceptance implemented; live visual acceptance pending.

Date: 2026-08-29

Depends on: [Linear Build-out Layout Contract](graph-engine-v1.5-linear-build-out-layout-contract.md)

## Automated acceptance

- The first supplied node is exactly `(0, 0, 0)`.
- A directed fork shares one depth layer and straddles the selected build axis.
- A directed join follows the deepest incoming branch.
- Repeated projection of the same document and settings is deterministic.
- `up`, `down`, `left`, and `right` map to the documented planar axes.
- `in` and `out` map to negative and positive Z in 3D.
- A 2D profile requesting `in` or `out` fails clearly.
- The shipped descriptor exposes `layout` and `linear-layout` and conflicts with Form
  and force layout.
- The V1.5 public client artifact contains the direction contract and remains free of
  provider implementation code.

## PatternSmith acceptance

- PatternSmith requests `linear-layout`, forbids force layout and Form, and locks the
  build direction to `up`.
- Its first syllabus lesson is the origin.
- Lesson 4 and Lesson 5 share the layer above Lesson 3; Lesson 6 occupies their joined
  successor layer.
- A fresh syllabus view fits the derived positions without overwriting a restored
  learner camera.
- First-click focus and second-click lesson Drill activation remain unchanged.

## Live visual check

Reload Graph+ and PatternSmith together in Obsidian. Verify the full syllabus on
desktop and mobile, readable branch spacing, unclipped labels, arrow direction, camera
fit, focus/activation, and persistence after close/reopen. Automated coordinates do
not substitute for this check.
