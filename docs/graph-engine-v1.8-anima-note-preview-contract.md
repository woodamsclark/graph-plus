# Graph Engine V1.8 Anima Note Preview Contract

Status: Implemented for V1.8.0; desktop visual acceptance pending.

Implementation note: Graph Engine retains semantic target and handoff ownership;
the host tracks its asynchronous card lifecycle (waiting, mounted, closing). Anima
supplies graph emphasis, timing constants, and bounded card placement/presentation
targets. Initial card presentation is immediate, with no continuous animation loop.

Date: 2026-09-07

Depends on:

- [Graph Engine V1.6 Anima Presentation and Native Motion Contract](graph-engine-v1.6-anima-presentation-and-native-motion-contract.md)
- [Graph Engine V1.7 Interaction, Runtime, Layout, and Recovery Contract](graph-engine-v1.7-mobile-precision-zoom-contract.md)

Supersedes the native Page Preview behavior in V1.7 section 10 and acceptance
requirements 37 through 42 and 45. V1.8 does not remove ordinary Obsidian Page
Preview from notes or other host surfaces; it replaces only graph+'s use of that
native hover lifecycle.

## 1. Purpose

V1.8 replaces graph+'s native `hover-link` bridge with a deterministic note-preview
surface coordinated by Anima. The change removes browser CSS hover and Obsidian
popover ownership from graph presentation while preserving rich, interactive Obsidian
Markdown inside the preview.

The governing boundary is:

> Input declares preview intent; Anima owns graph presentation and preview
> choreography; the graph+ host resolves and renders Obsidian note content.

Preview is transient presentation. It never changes canonical graph data, layout,
physics heat, focus, selection, pins, Filter, Form, camera state, or checkpoints.

## 2. Interaction contract

On desktop, holding the platform Mod key while pointing at a visible note node makes
that note the preview target. On macOS the platform Mod key is Command; on other
desktop platforms it is normally Control. The gesture is order independent: it works
whether Mod is held before entering the node or pressed while already over it.

The target node enters preview-active presentation immediately. After a bounded delay,
the preview card appears near the node. The initial delay is a presentation constant,
not a persisted setting in V1.8.

Moving directly between eligible note nodes transfers the target. A rapid transfer
cancels stale loading and rendering work, and content for the old target may never
replace content for the new target.

Tag nodes, background, removed nodes, filtered nodes without a visible reveal, and
unresolvable note identities do not open a preview. Entering an ineligible target
begins ordinary dismissal unless the pointer is already inside the active preview
card.

The pointer may move from the node into the preview card through a short, explicit
handoff interval. While the pointer is inside the card:

- the card remains open and interactive;
- the associated node remains preview-active through Anima;
- wheel and trackpad input scroll the card rather than the graph;
- text selection, ordinary Markdown controls, and supported links remain usable; and
- releasing Mod does not close the card until the pointer also leaves it.

If Mod is released while the pointer remains over the node and never entered the card,
preview eligibility ends and the card closes. Leaving both the eligible node and card
closes the card after a short grace interval. Pressing Escape closes it immediately.
Changing graph focus, hiding the leaf, suspending the session, deleting the target
file, or disposing the view also closes it immediately.

Touch and pen receive no note-preview gesture in V1.8.

## 3. Preview state

Graph Engine owns one semantic preview state independent from ordinary pointer hover:

- inactive;
- waiting for the card delay;
- node active;
- card active; or
- closing.

The state identifies at most one stable node ID. It is updated by semantic input and
host-surface events, never by CSS `:hover`, inferred DOM ancestry, synthetic pointer
events, or Obsidian's native popover state.

Ordinary hover may come and go without clearing an active preview. Preview persists
only according to the state machine above. Focus and preview remain separate: a node
may be previewed without becoming focused, and changing preview target never invokes
the focus controller.

Ordinary hover remains useful during focus without replacing focus. When the pointer
rests on a visible direct neighbor of the focused node, Anima temporarily presents
that neighbor as the inspected node and illuminates its direct neighborhood. Hovering
a node outside the focused node's direct neighborhood leaves focused presentation
unchanged. Removing the pointer restores the focused node's neighborhood.

When a node is focused, wheel or pinch zoom is anchored to that focused node rather
than the pointer position. The camera continues to track the focused node while its
layout position changes. Unfocused zoom retains pointer anchoring.

Resetting the camera while focus is active preserves focus and applies the same
neighbor-aware camera fit used when that node first receives focus. Resetting an
unfocused graph retains the profile's ordinary default-camera behavior.

On desktop, primary-button dragging on the background pans the camera whether focus
is active or not. A focused pan changes the camera offset without clearing focus or
selection. In 3D, trackpad scrolling remains contextual: it pans while unfocused and
orbits the focused node while focused. Secondary-button dragging remains an explicit
3D orbit.

While focus is active, a mouse may drag a visible direct neighbor only when that node
was already the stable hover target at pointer-down. The dragged neighbor receives
transient Anima drag presentation, while the original focus and selection remain
unchanged. A background node, non-neighbor, or overlapping hit without stable hover
falls through to focused camera panning. Touch and pen retain the existing focused 3D
orbit gesture and do not move neighbor nodes in V1.8.

## 4. Anima ownership

Anima is the sole authority for the graph's response to preview state. It owns all
resolved node, link, label, neighbor, and region presentation associated with the
preview target, including future transitions in color, opacity, geometry, glow, and
emphasis.

V1.8 must not use CSS classes, CSS pseudo-classes, DOM overlays, or renderer-specific
hover mutations to illuminate a graph node. The renderer receives ordinary
Anima-resolved presentation values and draws them without knowing why they changed.

Anima also owns declarative preview-card choreography targets that are independent of
Obsidian content:

- screen anchor;
- preferred placement;
- opening and closing progress;
- opacity; and
- scale or translation used by the transition.

The Graph+ host applies those targets to the preview surface. Anima does not parse
Markdown, read vault files, create DOM elements, import Obsidian APIs, or handle link
navigation.

## 5. Graph+ preview surface

Graph+ owns one floating semantic DOM surface per mounted graph view. DOM is retained
only because Obsidian Markdown requires document layout, scrolling, links, media,
selection, accessibility, and theme integration. The DOM surface is not the source of
graph hover or preview truth.

The host:

1. resolves the Anima preview target to the exact vault-relative Markdown file;
2. loads a current cached copy through the Obsidian vault API;
3. renders it through Obsidian's supported Markdown renderer with the correct source
   path and component lifecycle;
4. positions the card from Anima's screen-space target while keeping it inside the
   available graph viewport;
5. reports semantic card enter, leave, Escape, navigation, and disposal events; and
6. cancels obsolete asynchronous work when the target changes or closes.

The card has rounded corners, a bounded desktop width and height, a scrollable content
body, and a visible title affordance that can open the source note. Placement may flip
above, below, left, or right to avoid clipping. It must remain usable in a narrow
graph+ leaf.

CSS is limited to structural layout, overflow, typography, theme tokens, and
accessibility. It may not encode preview state transitions or graph presentation.

Opening the title or an internal note link delegates navigation to the graph+ Obsidian
host. External links follow Obsidian's ordinary external-link behavior. Unsupported
or unsafe content is handled by Obsidian's Markdown renderer rather than a custom HTML
parser.

## 6. Performance and lifecycle

Preview processing is event-driven. It does not add a permanent animation loop,
polling timer, DOM observer, or graph-wide scan. Anima requests frames only while a
preview presentation value is actively interpolating.

At most one note read and one Markdown render may be current for a view. Target changes
invalidate older work by generation or cancellation token. A late result is discarded
without touching the live card.

Closing preview releases rendered Markdown children, event listeners, pending timers,
and transient Anima state. Suspending or disposing the graph performs the same cleanup
even when loading or rendering is in progress. A closed or backgrounded graph performs
zero preview work.

The preview card must not reheat physics, invalidate checkpoints, or cause continuous
Canvas rendering after its Anima transition settles.

## 7. Accessibility

The preview card is a named semantic region reachable through ordinary pointer
interaction. Escape closes it. Interactive Markdown controls retain visible focus,
and the surface does not trap keyboard focus after dismissal. Reduced-motion
preferences remove nonessential card movement while retaining immediate state changes.

V1.8 does not introduce full keyboard graph navigation or a touch preview gesture;
those require separate contracts.

## 8. Acceptance requirements

Automated tests must prove:

1. Mod plus a note node immediately establishes one semantic preview target without
   changing focus or selection.
2. Pressing Mod after the pointer is already over a note produces the same target.
3. Ordinary pointer-hover loss cannot clear the Anima preview while the state machine
   still considers the node or card active.
4. Anima alone supplies the node, neighbor, link, and label presentation response;
   no CSS hover or DOM-anchor state participates.
5. The card opens only after its delay and renders the exact note using its
   vault-relative source path.
6. Rapid transfer from note A to note B cannot display a late read or render from A.
7. Tag nodes and missing notes never create a card or stale Anima target.
8. Moving from the node into the card preserves Anima presentation and permits wheel
   scrolling, selection, and supported link interaction.
9. Releasing Mod while inside the card keeps it open until the pointer leaves; releasing
   Mod over the graph closes it through the ordinary dismissal path.
10. Escape, focus replacement, file deletion, suspension, and disposal close the card
    and release every preview resource.
11. The card flips or clamps its placement to remain inside wide, narrow, and edge-adjacent
    graph viewports.
12. Preview never focuses, selects, drags, pins, navigates, reheats, filters, reforms,
    moves the camera, or mutates canonical or persisted graph state by itself.
13. A settled open card schedules no continuous graph frame, and a closed, suspended,
    or disposed view performs zero preview work.
14. Reduced-motion mode removes nonessential card motion without hiding state changes.
15. Ordinary hover on a focused node's direct neighbor illuminates the neighbor's
    neighborhood without changing focus; hover outside that neighborhood does not.
16. Focused zoom retains the focused node as the camera target in 2D and 3D, while
    unfocused zoom remains pointer-anchored.
17. Camera reset preserves active focus and reframes the focused node with its visible
    direct neighbors; an unfocused reset restores the profile default camera.
18. Desktop primary background drag pans without clearing focus or selection, while
    focused trackpad scrolling and secondary drag retain 3D orbit access.
19. A stably hovered visible direct neighbor can be mouse-dragged without changing the
    original focus; non-neighbors and touch or pen cannot enter this focused drag path.

Manual desktop acceptance must verify Cmd behavior on macOS and the platform Mod
equivalent elsewhere, long-note scrolling, internal and external links, narrow side
leaves, viewport edges, rapid node traversal, theme changes, and repeated open/close
cycles without flashing or a stuck Anima highlight.

## 9. Removal and migration

The V1.8 implementation removes graph+'s dedicated native Page Preview source,
`hover-link` emission, invisible preview anchor, synthetic pointer events, native
popover inspection, and associated handoff logic. There is no compatibility toggle
between native and custom graph preview paths.

The existing engine-level semantic preview identity may be migrated if it conforms to
this state machine. Failed bridge-specific behavior and CSS-driven hover behavior are
deleted rather than retained as a legacy path.

## 10. Deferred work

V1.8 does not include:

- a custom Canvas or WebGL Markdown renderer;
- preview on touch or pen;
- multiple simultaneous preview cards;
- pinned or persistent preview windows;
- user-authored preview animations;
- full keyboard traversal of graph nodes; or
- general Anima 2.0 timelines, keyframes, or choreography authoring.
