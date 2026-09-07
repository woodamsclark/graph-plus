# graph-engine downstream compatibility policy

Status: Active

Date: 2026-09-06

## Goal

Downstream plugins integrate with a stable graph protocol, not graph-engine's release
cadence. A compatible installed provider supplies rendering, camera, interaction,
layout, physics, Anima, performance, and lifecycle improvements without requiring each
consumer to rebuild or revendor its client artifact.

## Version ownership

- `engineVersion` identifies the installed graph-engine release.
- `consumerVersion` identifies the downstream plugin release.
- the client artifact version identifies a compile-time SDK snapshot.
- `protocolVersion` defines runtime compatibility.

These versions are independent. Equality between engine, consumer, and client versions
is never a connection requirement.

## Protocol V1 guarantee

While graph-engine advertises protocol V1:

- existing V1 request, registration, document, session, intent, and error shapes retain
  their accepted meaning;
- new V1 fields are optional and new capabilities are opt-in;
- provider-internal changes require no downstream update;
- an older V1 client may connect to a newer V1 provider;
- a consumer updates its client only to use a new public API or receive a relevant
  client-side transport, validation, or helper fix; and
- a consumer's profile may inherit improved engine defaults by omitting copied defaults
  for engine-owned behavior.

A release that cannot honor these rules requires a new protocol version. A future V2
provider should advertise V1 and V2 together for a migration window rather than forcing
all consumers to update in lockstep.

## Capability adoption

Consumers request only the capabilities they use. Adding a provider capability does not
change an existing consumer. To adopt one, the consumer explicitly requests it and
updates its profile policy. Domain decisions remain consumer-owned; for example,
PatternSmith can require Anima presentation while retaining its authored linear layout
and continuing to forbid free-force layout.

## Release impact

Every graph-engine release should classify downstream impact as one of:

- **none** — provider implementation or compatible defaults only;
- **optional client refresh** — new public API or a client-side fix that existing
  consumers do not require; or
- **protocol migration required** — a new protocol whose adoption is separately planned.

The default classification is **none**. Engine and compatibility tests must keep a
legacy-shaped V1 consumer mounting successfully against the current provider.
