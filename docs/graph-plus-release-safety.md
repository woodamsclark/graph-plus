# Graph+ release packaging, shutdown, and recovery

## Release artifacts and versions

`npm run release` validates metadata, checks TypeScript, runs the complete test suite,
rebuilds the plugin and engine client, and creates `releases/<version>/`. The three
individual plugin assets are `main.js`, `manifest.json`, and `styles.css`. Upload
these files individually to GitHub releases; manual installation uses the same files.
The release task creates no ZIP and excludes docs, source files, and local runtime data.

`npm run release:public` additionally requires a stable `x.y.z` version. It rejects
an RC before building or packaging. Promote the version only after release acceptance:
update `manifest.json`, `package.json`, both root version fields in `package-lock.json`,
and the matching minimum-Obsidian entry in `versions.json`. The GitHub tag must exactly
match the manifest version, without `v`. The client package and generated artifact also report `2.0.2`; protocol version 1 is unchanged.

The current stable release is `2.0.2`. Its compatibility entry and lockfile agree.
No release task uploads, tags, or publishes anything. `releases/` is ignored by Git.

## Shutdown contract

Obsidian's `onunload()` hook is synchronous. Graph+ starts one completion operation
and retains a barrier across plugin bundle reloads. A new instance waits on that
barrier before reading plugin data. The sequence is:

1. Stop incoming host activity and prevent new leases/settings changes.
2. Suspend and close all presentations, including closes already underway. Export
   and commit their final checkpoints before disposing their sessions.
3. Drain checkpoint operations and queued plugin-data saves.
4. Release the plugin lease and stop the provider.
5. Clear references, reporting failures after cleanup has completed.

Concurrent close/dispose requests share their original completion. A save failure
must not abandon other sessions or provider cleanup. Timer-triggered save failures
are handled and reported. Regular debounced autosaves remain essential: an OS kill
or abrupt app termination cannot be made to wait for this asynchronous operation.

## Recovery contract

Only a vault with no stored checkpoint/legacy document is treated as a fresh graph.
Referenced-file absence, read failure, malformed JSON, invalid document/view state,
and mismatched document identity/revision are explicit recovery failures. Graph+
blocks automatic replacement and preserves the stored metadata and document files.
The view shows the failure with Retry, Restore previous layout (when a previous
reference exists), and Reset saved layout with confirmation.

Checkpoint reads/saves/recovery are serialized. Settings changed during a document
write are retained. Camera-only saves do not serialize or rewrite graph documents.
Normal document changes retain the immediately preceding document generation and
its corresponding view metadata. Only a now-obsolete backup file is pruned after
successful metadata persistence. Pruning failures leave harmless orphan files.

Restore/reset closes all presentations first and archives the discarded metadata
in `graph-plus-checkpoints/*-recovery-*.json` before changing any stored reference.
Unreadable documents remain in place. Archive or metadata-save failure rejects
recovery without discarding the current reference. Reset affects only the current
vault's graph state; other vaults, notes, and plugin settings remain intact.

## Device acceptance and recovery checks

The maintainer reported successful real-device testing of the built plugin on
2026-10-08. The report does not enumerate individual scenarios. For targeted release
verification, check rapid disable/re-enable after a drag/camera change, normal
close/reopen, read-only/unavailable storage warnings, recovery controls, and mobile
background/resume. Use an isolated test vault to induce corruption or missing files;
never corrupt a user's live checkpoint for testing. Passing automated tests does
not establish real-device acceptance or authorize a public release.

## Release hardening

Blur, pointer cancellation, and unexpected pointer-capture loss terminate the entire
gesture, release temporary drag pins, retain preexisting pins, cancel touch holds and
momentum, and clear modifier/hover preview state. Late releases cannot activate a node;
a new gesture remains usable. Normal capture loss after pointerup does not cancel a
completed drag. Automated coverage exercises both dimensions, mouse/touch, and queued
input interrupted before its first frame.

Count duplicate links updates the existing canonical vault model and reconciles open
Global and Local presentations without recreating their sessions or fitting their
cameras. A change during an in-flight reconciliation schedules another pass. The
setting is reversible, and no-op changes retain the document revision.

The distributable engine client now declares MPL-2.0 and carries the same full LICENSE
as its reviewed Graph+ source. The client generator copies that license; its package
file list includes it. Client version 2.0.2 is aligned with the plugin release; the V1 protocol remains unchanged.

The README documents manual installation. Layout reset continues to require one
Global pane for this release; settings now explain which panes to open or close.
Frank mode remains opt-in with the description “for Frank's eyes only.” Physics
cadence is unchanged. See [vault benchmark results](graph-plus-vault-benchmark.md)
for reproducible 1k/5k/10k measurements and the remaining device performance checks.

## Validation status for 2.0.0

TypeScript, the complete 508-test suite, and the plugin build pass. Clean release
packaging and packed-client license inclusion were also validated during release
hardening. The vault benchmark completes at all three sizes and records its
synthetic-host limitations separately.

An earlier automated desktop UI attempt was inconclusive because native UI actions
and reconnection timed out. The maintainer subsequently reported that the built
plugin works correctly on real devices (2026-10-08). Deliberately induced storage
failure and corruption scenarios were not individually confirmed in that report.

The active-note queue and Focus-only Quick Settings clear regressions are covered by
the [constellation lifecycle contract](graph-plus-constellation-contract.md). Closed
panes retain bounded Memory without pending working-constellation admissions; Local
clearing keeps its focused root.

## Validation status for 2.0.1

This patch includes the distant 2D node-size correction and submission-review fixes
for manifest metadata, platform detection, static styling, settings headings, and
standard MPL-2.0 license text. Type checking, all 512 tests, build, and exact
three-file release packaging pass. Obsidian directory review and live visual
acceptance are separate from these automated checks.

## Validation status for 2.0.2

Removes the redundant plugin-name settings heading and names the remaining
sections General and Colors, addressing the sole error in the 2.0.1 directory
review. Type checking, all 512 tests, build, and exact three-file release packaging
pass. Remaining directory warnings and recommendations are unchanged; directory
review must run again against this release.
