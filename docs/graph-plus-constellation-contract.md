# Active-note constellation lifecycle and clearing

## Working constellation versus Memory

Workspace note activity always updates the bounded Graph+ session Memory (three
previous notes and the current active note). A working constellation is separate:
it accumulates active-note arrivals only while Graph+ presentations are attached.
Closed-pane history must not enter a future working constellation implicitly.

The first presentation attachment discards any prior pending admissions. The last
presentation detachment immediately discards pending admissions and invalidates the
in-flight drain, before waiting for checkpoint saves or session disposal. A drain
that was awaiting Local note-following must not admit its captured members into a
presentation attached after that boundary. Opening still applies its initial session
snapshot and seeds the current active note; saved Global constellations remain saved.
Memory does not reset when panes close, and ordinary rapid switching with open panes
still admits every arrival rather than losing intermediate notes during coalescing.

## Change detection for visual Memory

Global and Local currently disable visual Memory constellations. Bounded note history
still updates on every activation, but an unchanged projected remembered-subject list
is installed only once per engine session. Repeated and identical in-flight snapshots
share the same completion rather than sending another influence that invalidates
presentation work. Failed installs are retryable, and a newly mounted engine session
starts with a fresh projection cache. Working Attention and Local note-following are
independent and continue to update normally.

## Clear action in Quick Settings

Global retains the engine's deliberate clear-constellation View command. A Focus-only
experience cannot request Overview with empty Attention. Its Quick Settings clear
control resolves a registered consumer clear action on a selected member instead.
Graph+'s action runs `GraphPlusPresentationV1.clearConstellation()`: Local retains
its focused root as the only selected member and stays in Focus. Clearing cancels
pending per-presentation admissions and preserves camera framing, layout, and pins.
A Focus-only consumer without an available registered clear action has no clear
button, rather than a button that requests a rejected transition.

## Cause and regression coverage

Commit `82b93d8` introduced the application pending constellation set, but added active
notes before checking for presentations; its drain ran only for open presentations.
Commit `a834813` introduced the shared Quick Settings clear navigation path, which
assumed Overview was available. Local's Focus-only contract made that path ineffective.

Regression tests exercise ten closed-note activations, bounded Memory, subsequent
opening and note changes, another closed interval, an in-flight follow spanning
close/reopen, and real Local engine controls invoking the registered presentation
action. Local tests verify root/Focus retention, unchanged camera/positions/pins,
repeated clearing, and cancellation of pending not-yet-canonical members. Generic
control tests retain Global navigation and hide unavailable Focus-only actions.
Automated tests do not establish a physical Obsidian smoke-test result.
