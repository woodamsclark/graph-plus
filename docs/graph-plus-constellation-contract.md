# Shared working constellation

Updated 2026-10-18. Working membership belongs to the Graph+ application, above
Global and Local panes. This supersedes the per-presentation membership lifecycle.

## Ownership and presentation

`GraphPlusApplicationV1` owns one `GraphPlusConstellationV1`. Active-note arrivals
while any presentation is attached, deliberate graph admissions, removals, and
clear actions update that set. Each presentation installs a filtered projection
through the engine's external-influence boundary. Peer installations emit no user
selection/focus intentions and preserve camera framing, coordinates, and pins.

Opening Global after visiting A, B, C in Local must show the same A/B/C working
constellation. This applies in either opening order and with multiple panes.
Membership is independent of the three-note bounded Memory history. Hover and
document-link peeking never admit members.

Focus subject, View, camera, hover, and filters remain local to each pane. Global
can stay in Overview while Local follows the active note in Focus. A pane filter
can hide members but cannot remove them from the application; removing the filter
reprojects them. Deliberate edits report membership deltas so concurrent edits in
different panes do not overwrite one another's additions or hidden members.

## Lifetime and persistence

Closing every pane retains the application constellation. While all panes are
closed, note activity updates bounded Memory but does not accumulate new working
members. Reopening seeds the current active note without replaying closed history.
An old in-flight Local follow cannot change a newly opened pane's focused root.
Rapid note switching with open panes admits every arrival even when the Local
follow queue coalesces its latest subject.

Application membership is persisted independently in
`consumers.graphPlus.workingConstellationNodeIds`, including Local-only changes.
On first use without that field, the application migrates the existing saved
Global checkpoint selection once, even when Local opens first. Thereafter, shared
application state takes precedence over stale Global checkpoint selection. An
explicit empty saved array is authoritative. Global still saves its viewport and
the shared graph world through its existing checkpoint controller; Local viewport
state remains ephemeral. Explicit checkpoint recovery restores membership from
the recovered checkpoint, or clears it on reset.

Unknown active-note IDs wait for canonical metadata without being rendered.
Reconciliation removes deleted known nodes. Explicit clear cancels unknown pending
members, so their later canonical arrival cannot resurrect the cleared group.

## Clearing and required Local roots

Clear constellation applies to the application from either pane, through Quick
Settings, the member context action, or the application API. With no open Local
pane it empties membership. Local is Focus-only, so each open Local focused root
is a required member: clearing retains those roots in the shared set and therefore
in every unfiltered pane. Removing a required root from a peer cannot invalidate
Local Focus. Closing a Local pane does not automatically remove its former root.

Global retains the engine's deliberate clear-constellation View command; its
committed empty selection requests the shared clear. Local Quick Settings invokes
the registered presentation clear action instead of requesting forbidden Overview.
Clearing preserves camera framing, layout, and pins. A Global Focus whose subject
is explicitly removed can retreat to Constellation under the normal engine policy.

## Visual Memory

Global and Local disable visual Memory constellations. Bounded note history still
updates on activation. The unchanged remembered-subject projection installs once
per engine session, coalesces identical in-flight requests, and retries failed
installs. It does not own or reconstruct the working constellation.

## Cause and regression coverage

The previous implementation admitted note visits only to currently attached
presentations. Opening another pane restored its own selection and current note,
so it missed the trail built in an existing pane. Sharing world geometry did not
share Attention, because engine world state intentionally excludes viewport state.
The fix adds application-owned membership rather than broadening engine world state.

`tests/graph-plus/shared-constellation.test.ts` covers Local-first trails beyond
bounded Memory, later and multiple Global panes, real engine membership/clear
controls, concurrent edits, independent Focus/camera/geometry, transient hover,
filter restoration, pending/deleted nodes, legacy migration, Local-only persistence,
stale checkpoints, explicit empty restores, and clearing during in-flight following.
Adapter tests cover closed activity and close/reopen boundaries; persistence tests
cover the additive saved field and migration. Automated tests do not establish a
physical Obsidian smoke-test result.
