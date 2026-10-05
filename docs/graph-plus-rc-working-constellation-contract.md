# RC labels and working constellation

Updated 2026-10-05. This supersedes the prior independent cursor-label toggle and
Focus-root neighbor promotion. The existing 0.2-second preview delay and 0.5-second
fade in/out remain.

## Labels

Display Quick Settings offers exactly three choices:

- **Off:** no node labels, including root, selection, hover, structural and cursor labels.
- **Cursor proximity (default):** labels reveal within 96 CSS pixels with the existing
  distance fade, collision/occlusion checks and 12-pixel readability floor. View-required root, constellation and preview labels remain visible independently
  of the cursor. Only extra labels use proximity instead of the adaptive algorithm.
- **Adaptive:** the existing saliency budget, semantic ordering and interaction label
  priorities. No cursor-only reveal runs in this mode.

Label position stays directly beneath Labels. The old proximity toggle is retired.
Existing explicit Adaptive/Off choices are retained; saved All maps to Adaptive. The
engine can still accept All for other consumers, while Graph+ exposes only these three
choices. Mouse gravity is unaffected by label mode.

## Focus

Hovering the current root has no prospective action and leaves node/link/label styling
unchanged. Its nonmember neighbors remain dim, and unrelated context remains void.
Hovering a neighbor previews admission and making that node the new root. Its label
uses its full resolved root-size treatment instead of the half-size neighbor treatment,
including during the preview delay. Every other non-root Focus label stays reduced, including nodes beyond the
original root neighborhood, so preview cannot accidentally restore their full size.
The admitted destination root has dim nonmember neighbors; it does not promise a
further View transition on hover.

A Focus hop retains the prior root, all admitted members and the new subject in the
working constellation. This applies to engine activation and application-directed
Focus, including Local active-note following. Local note arrival previously replaced
Attention with a singleton and could erase the prior Focus trail.

## Active notes and clearing

Active-note events add their node to each open Graph+ working constellation. Global
arrival preserves View, Focus subject, camera and geometry. Local continues its
existing active-note Focus following while retaining earlier members. This is active
membership, not a second remembered-node layer or bounded historical Memory trail.

The active startup note seeds membership without forcing a View change. Consecutive
duplicate host events do not resurrect a cleared group. Rapid activations retain each
note even when the follow queue coalesces its latest subject. A newly activated note
not yet in canonical graph data waits for canonical reconciliation before admission.

Graph+ enables the host-neutral `attention.clearOnOverviewEntry` experience policy:
returning from Constellation or Focus to Overview clears membership, while entering
Focus or returning from Focus to Constellation preserves it. Pending unavailable-note
admissions are also canceled on Overview entry. The engine's default preserves
membership for consumers that do not enable this policy. Users can also clear through
the existing explicit Clear constellation action. A later distinct note activation
starts building the group again.

Regression coverage lives in `views.test.ts`, `ego.test.ts`,
`ego-interaction-plan.test.ts`, `v16-native-presentation.test.ts`, and Graph+ adapter and
settings-controller tests. Automated checks do not replace Obsidian visual acceptance.
