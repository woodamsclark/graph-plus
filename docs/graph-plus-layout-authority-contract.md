# Graph+ physics ownership across panes

Global and Local share world positions and pins, with exactly one visible pane
authorized to advance layout. Camera, Focus, Attention and filters remain per pane.

- The first opened pane initially owns layout.
- Pointer movement, pointer presses and keyboard input inside a visible Graph+
  pane request layout ownership for that pane. Ownership is transferred through
  the application's serialized world queue, after copying the previous owner's
  latest positions, pins and force state. Repeated activity in the owning pane
  performs no transfer or export.
- Hiding the owner transfers layout to another visible, open pane. All hidden
  panes have layout disabled; revealing a pane makes it eligible again.
- A pane that closes or becomes hidden while a transfer is pending cannot become
  the owner. Input listeners are removed with the session.
- Local may initialize saved coordinates with physics settled. With its canvas
  focused, plain Space temporarily runs physics at maximum alpha, including over
  a disabled force setting. Key release or window blur restores normal physics.
  Local's Focus and Attention are preserved.

The regression originated with the shared-world ownership introduced in
`b8b153d`: ownership was elected on opening/closing, but not on visibility or
input. A Local follower's force module was skipped even while Space was held;
a hidden Global owner could also leave every visible pane without physics.
The earlier Space tests exercised an independently owned engine session and
therefore did not cover this multi-pane gate.

`tests/graph-plus/adapter.test.ts` covers Global/Local Space ownership, actual
geometry movement, restoration of settled activity, visibility handoffs, and
the all-hidden/reveal cycle. Engine tests separately cover the disabled-setting
override and cancellation on window blur. Live Obsidian acceptance requires a
plugin reload and a check with Global and Local open, including hiding Global
and holding/releasing Space after clicking the Local canvas.
