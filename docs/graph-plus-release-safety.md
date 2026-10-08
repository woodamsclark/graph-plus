# Graph+ release packaging, shutdown, and recovery

## Release artifacts and versions

`npm run release` validates metadata, checks TypeScript, runs the complete test suite,
rebuilds the plugin and engine client, and creates `releases/<version>/`. The three
individual plugin assets are `main.js`, `manifest.json`, and `styles.css`; the ZIP
contains exactly those same files. Upload the individual assets to GitHub releases.
The ZIP is for manual installation. Never ZIP the live plugin checkout.

`npm run release:public` additionally requires a stable `x.y.z` version. It rejects
an RC before building or packaging. Promote the version only after release acceptance:
update `manifest.json`, `package.json`, both root version fields in `package-lock.json`,
and the matching minimum-Obsidian entry in `versions.json`. The GitHub tag must exactly
match the manifest version, without `v`. The client package has its own version.

The current build remains `2.0.0-rc.1`. Its compatibility entry and lockfile agree.
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

## Acceptance still needed in Obsidian

On the built RC, verify rapid disable/re-enable after a drag/camera change, normal
close/reopen, read-only/unavailable storage warnings, recovery controls, and mobile
background/resume. Use an isolated test vault to induce corruption or missing files;
never corrupt a user's live checkpoint for testing. Passing automated tests does
not establish real-device acceptance or authorize a public release.

## Remaining review changes

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
file list includes it. Client version 1.7.1 remains independent from the plugin RC.

The README documents manual RC installation. Layout reset continues to require one
Global pane for this release; settings now explain which panes to open or close.
Frank mode remains opt-in with the description “for Frank's eyes only.” Physics
cadence is unchanged. See [vault benchmark results](graph-plus-vault-benchmark.md)
for reproducible 1k/5k/10k measurements and the remaining device performance checks.

## Validation status for this RC

TypeScript, the complete 477-test suite, the plugin build, clean release packaging,
and packed-client license inclusion pass. The vault benchmark completes at all three
sizes and records its synthetic-host limitations separately.

The desktop UI attempt observed Graph+ rendering in Obsidian 1.13.7, then attempted
a focused disable/re-enable to load the rebuilt bundle. Subsequent native UI actions
and reconnection repeatedly timed out, including after resetting the automation
connection. Live acceptance of the rebuilt bundle is therefore inconclusive; the
source of the UI timeout has not been established. Obsidian was not force-quit and
no live checkpoint was deliberately reset or corrupted. No physical mobile surface
is available in this session. Desktop reload/drag interruption and mobile acceptance
remain open release checks.
