# Gravity and node-pull prototype checkpoint

Branch: `experiment/gravity-node-pull`.

This preserves the previously uncommitted changes from the node-attachment testing
checkout, separately from `rc/attachments`. No new force behavior was added as part
of making this checkpoint. It starts from attachment commit `439ccde` and does not
include the RC's 3D attachment work or the separate grab-constraint implementation.

The force-layout prototype accepts `gravityY` (default 0, clamped to -100..100)
and `nodePull` (default null). A pull contains `nodeId`, a finite world-space
`target`, `strength` (0..1), and `maxForce` (0..100). It adds a bounded attraction
inside the existing solver. It has no independent grab damping or input lifecycle;
it is not the public API for the newer elastic-grab experiment.

These are settings-based experimental inputs, not RC features. Their lifecycle,
persistence implications, and interaction with simulation cooling need their own
design and tests before integration. Existing default-regression tests pass; this
checkpoint does not claim a dedicated gravity/pull acceptance suite.
