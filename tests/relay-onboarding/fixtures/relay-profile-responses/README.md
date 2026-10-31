# Sanitized protocol response fixtures

The coordinator-only paid walk writes `relay-responses.sanitized.jsonl` in its isolated output directory. Review it before copying JSON responses here. Keep only the recorder's allowlisted projection; never copy the raw network log, headers, prompts, original identifiers, signed URLs, local paths, or free-form errors. Binary entries are metadata and are not JSON response fixtures.

A reviewed fixture is a `.json` object with `profile` (`openai-videos-v1`, `video-generations-json-v1`, or `declaration`), `sourceUrl` (public protocol documentation), `recordedAt`, and `samples`. Each sample has `response`, `expectedStatus`, and `expectedUnknown` (empty for a recognized word). `profile-statuses.test.mjs` discovers every file in this directory in the default CI lane. Review expected behavior against the existing shared inference; this collection does not authorize changing its rules.

No paid response has been captured for this change yet. Local HTTP recorder tests are separate and are not presented as provider evidence.

For a different explicitly declared three-stage route, use `profile: "declaration"` and include its exact `declaration.statusMapping` and `declaration.responseMapping`. Do not relabel that route as a code-owned profile. This permits replaying envelopes such as `data[0].status` against the contract that actually read them.
