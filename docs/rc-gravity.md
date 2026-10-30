# Alpha-cooled vector gravity

The `rc/attachments` branch includes a configurable uniform world-space force in
the shipped force-layout module. The UI calls it Gravity; it is a physics input,
not attraction toward the pointer, the origin, or other nodes.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `gravityEnabled` | `false` | Apply the configured force while ordinary simulation runs |
| `gravityX` | `0` | Signed world X component |
| `gravityY` | `0` | Signed world Y component |
| `gravityZ` | `0` | Signed world Z component, applied only in 3D |

Components are finite solver coefficients clamped to -100..100. Positive and
negative values select opposite directions. They are not SI acceleration units;
the engine retains its existing per-admitted-step integrator and safety limits.
Zero components produce no force. Off preserves all component values so the same
direction and strength can be restored later. A 2D session retains Z for a later
dimension switch, but ignores its physical contribution.

In the plugin Settings tab, look under Layout and motion for Gravity and its three
components. Profile customization exposes the same settings. In Quick Settings,
expand Forces and enable Gravity to reveal its signed sliders and numeric inputs;
Z is shown only for a 3D session. Changes update the live graph and use the existing
profile inheritance, reset, coalescing and persistence paths. Consumers may hide
the enable control or individual axes using the new `gravity`, `gravityX`,
`gravityY`, and `gravityZ` Quick Settings control IDs.

## Consumer use

Request `GRAPH_UNIFORM_FORCE_CAPABILITY_V1` (`force-layout-uniform-force`) from a
matching provider and enable force layout. The client exports
`GraphUniformForceSettingsV1` as an optional settings shape. The older Y-only
prototype capability does not guarantee this API.

```ts
import type { GraphUniformForceSettingsV1 } from '@graph-plus/graph-engine-client';

const force = {
  gravityEnabled: true,
  gravityX: 0.5,
  gravityY: 1,
  gravityZ: -0.25,
} satisfies GraphUniformForceSettingsV1;

await session.setSessionOverrides({
  modules: { 'force-layout': { enabled: true, settings: { ...force } } },
});
```

`setSessionOverrides` replaces the consumer's session overrides. Real consumers
should merge these keys with their other overrides, rather than unintentionally
removing unrelated settings. User edits in the plugin's controls already preserve
siblings through the existing settings service.

Updating several components in one override supplies any resultant direction.
Multiple uniform influences can be summed component by component before submission.
Each update replaces the current coefficients; it does not accumulate hidden
forces or create an asynchronous force queue. Updating at successive frames is
allowed. To change direction, submit new signed components; to pause gravity,
set `gravityEnabled: false` while preserving the current component values.

## Alpha and lifecycle

Each admitted physics step adds `0.6 * (gravityX, gravityY, gravityZ)` to the
full-step velocity, followed by ordinary forces, velocity decay and speed limiting.
The engine's existing alpha blend then scales the position and velocity transition
once. Gravity is not separately multiplied by alpha before that blend, which would
incorrectly make its contribution scale with alpha squared.

A configured force does not hold alpha at 1 or keep a sleeping simulation awake.
An unchanged vector cools and stops with the rest of the graph. An effective vector
change reheats ordinary simulation; repeated live changes can therefore sustain
activity while editing, and stopping edits lets it cool again. Merely changing
disabled values, applying an unchanged vector, or changing only Z in a 2D session
does not wake gravity-driven physics. Existing explicit drag or Space physics
override behavior still takes precedence over ordinary cooling.

An isolated unpinned node can respond and cool under gravity. Turning gravity off
while it moves removes only the force, preserving its velocity for ordinary settling.
Pins, exact dragging, accepted hard attachment rays, suspension, Form layout
authority and the global speed limit remain authoritative. There is no floor,
automatic anchoring, mass variation, inverse-square attraction, or viewport-relative
direction. With no anchor or centering force, the graph can drift until it cools.

This is independent from the settings-based node-pull prototype and the transient
grab-constraint experiment; neither is merged into the RC.

## Verification

597 tests pass, including 10 new solver tests and four new settings/control tests.
Coverage includes default-off compatibility, alpha-linear contribution, all signed
axes, live replacement/reversal, topology reuse, cooling and wakeup, isolated nodes,
disabling without an impulse, pins/dragging, hard attachment constraints, Form and
suspension, speed safety, actual global control callbacks, inheritance/persistence,
real leased profile updates from Quick Settings, numeric input while editing, and
consumer control visibility. Typecheck and build pass; lint has no errors (the
Quick Settings file retains its existing DOM-helper style warnings).

The RC source and generated client have been built and tested. This work does not
automatically replace or reload an installed Graph+ provider in a user's vault.
