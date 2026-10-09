# Obsidian submission warning and recommendation audit

Audit date: 2026-10-09. Source: the maintainer's latest directory review for
2.0.2. Every original-source location in that report was inspected; duplicate
locations under packages/graph-engine-client are generated from the same source.
The remaining General heading error was removed before this audit.

## Warning findings

| Reported warning | Finding and disposition |
| --- | --- |
| Unsafe assignments, member access, arguments, returns, calls | Fixed. Array.isArray narrows values to any[] even in typed validation paths. Local readonly unknown[] guards preserve element types while retaining the same runtime checks. Unknown prototypes and reaction maps now have explicit types. Source and generated client contain no remaining unsafe-value diagnostics. |
| Unnecessary assertions (both variants) | Fixed. Applied only the checker's assertion-removal fixes, then replaced inferred Object.entries assertions with explicit generic arguments. Type checking and runtime tests verify the result. |
| globalThis | Retained after inspection. Client/checkpoint default clocks support non-DOM hosts and are injectable. The shutdown barrier deliberately survives bundle reloads in its realm. UI-layout references are type-only intersections; actual observers come from the owning window. Replacing these blindly with a pane's window would change lifecycle or portability behavior. |
| document.createElement | Retained. Engine/client surfaces remain independent from Obsidian extensions. Host code creates elements through the owning document to keep popout ownership correct. These are style recommendations, not evidence of wrong-window access. Host-only helpers can be migrated separately. |
| Empty blocks | Fixed by documenting each intentional catch: unavailable pointer capture, independent teardown, consumer notification isolation, or preserving the original failed transaction when rollback persistence also fails. Behavior is unchanged. |
| Lexical declaration in case | Fixed. Preview-hover case now has its own scope. |
| Unbound methods | Fixed. Module presentation/choreography/projection hooks use the instance receiver; dynamically typed lifecycle hooks bind it explicitly. Existing custom-module tests exercise hook behavior. |
| Throwing non-Error values | Fixed. World-handoff failures preserve existing Error identity, wrapping non-Error failures and retaining the original value as cause. |
| Bare setTimeout/clearTimeout | Retained. The application owns reconciliation across presentations, rather than belonging to one pane; these timers do not access the DOM. A future injected application clock can make ownership explicit without introducing a pane dependency. |
| Unhandled promise | Fixed. Opening a tag search now awaits revealLeaf so failures propagate to its caller. |
| Async event callback | Fixed. Slider double-click reset explicitly handles its promise and displays failures through a Notice. |
| Plugin name in command labels | Fixed. Labels are Open global graph and Open local graph. The diagnostics command was removed at the maintainer's request. |
| Plugin ID in command ID | Resolved by removing the diagnostics command at the maintainer's request. |
| Console logging | Resolved. Removed the diagnostics command and its clipboard/console implementation. |
| Missing getSettingDefinitions | Deferred feature migration. The current imperative tab is not indexed by the new declarative settings search. Adding an empty method merely to silence the checker would hide the gap. Migrating the profile controls and dynamic colors is separate UI work. |
| display instead of update | Deferred with the declarative migration. The tab currently renders imperatively; replacing refresh calls alone does not implement searchable setting definitions. |

The local checker additionally flagged primitive frontmatter stringification;
flattenValues now limits string conversion to searchable primitive values. It
also reports existing sentence-case wording, which was not in the pasted report.
These remaining UI wording diagnostics are visible in the checker, not suppressed.

## Recommendation resolutions

| Recommendation | Resolution |
| --- | --- |
| peripheralAwarenessNodeIds | Added consciousFieldNodeIds as the preferred input. New and legacy inputs merge at a compatibility boundary. They never become deliberate Awareness. A regression test covers both inputs, duplicate IDs, and absent nodes. |
| Unused registration | Removed unused destructuring from profile resolution. |
| AnimaPresentationRoleV1 | Internal policies use AnimaPresentationPhaseV1. The deprecated public alias remains available. |
| Unused navigation | Removed the unused navigation read only from navigationPivot. Other navigation operations keep their state reads. |
| Unused magnitude | Removed the dead force-layout helper. |
| adaptiveLabelThreshold | Kept the old spelling readable at a documented compatibility boundary. The current internal name is adaptiveLabelSaliency. |
| GraphRenderThemeV1 | Compatibility constant uses the current visual-theme and presentation-policy intersection; the public legacy type remains exported. |
| GraphPlusHostEventV1 | Host-event ingress accepts the current GraphPlusUnconsciousActivityV1 type. The old type alias remains exported. |
| GraphPlusConsumerV1 | Compatibility entry point reexports the canonical presentation implementation under the existing name, preserving runtime identity and old imports. The application factory remains the preferred API. |
| Unused mountRelation | Removed the inactive relation UI and its commented registration. Saved Form data and engine support remain intact. |
| Unused GraphContextMenuOptionsV1 | Removed the unused type import. |

## Local review workflow

Run npm run lint:submission. The official eslint-plugin-obsidianmd recommended
configuration checks source and regenerated client, including settings-heading
rules. It retains all diagnostics. The unnecessary-assertion and custom-message
rules use warning severity to match the directory report; they are not disabled.

The release task now regenerates the client and runs this checker before type
checking, tests, build, and allowlisted packaging. Warnings remain visible and
errors stop the release task. This is a local preflight, not confirmation that
the directory's potentially newer scanner will accept a release.

Validation: all 513 tests, type checking, build, and release packaging pass.
The local checker reports zero errors, zero deprecated-use/unused-declaration
recommendations, and 52 remaining warnings in the documented groups. No new version or GitHub release was created by this audit.
