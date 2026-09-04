# MCP semantic operation matrix

## Scope

- Base: `origin/main` at `68e88075ddfaa90edb0078f902b2d9103dba1bb3` (#462 merged).
- Test only the published MCP semantic operations that have a real current
  headless production path: `nomi_document_read`, `nomi_document_edit`, and
  `nomi_canvas_maintenance`.
- Exercise the MCP protocol, catalog/schema validation, verified project
  session lease, dispatcher, disk gateway, and the actual workspace project
  repository. The fixture seeds only an initial user project; it never writes
  the asserted final result.
- Inject failures only at the MCP invoke/transport boundary or the gateway
  boundary, matching the production seams.

## Explicit gaps

- `nomi_timeline_read` and `nomi_timeline_edit` are renderer-surface routes in
  the current GUI path. The headless dispatcher does not own `timeline.read`
  or `timeline.write`; this change records that as a blocked contract rather
  than routing it to a reducer or accepting a fabricated result.
- `nomi_media_query` and `nomi_export_job` likewise require the registered
  renderer asset/export surface. Export write is Host-only and is not an MCP
  capability. No test will claim those operations are live from this path.
- Document writes currently have no revision parameter in the published
  contract. The matrix records stale-revision as a schema/contract gap instead
  of inventing optimistic concurrency.

## Acceptance

- Every selected operation has normal, boundary/empty-extreme-Unicode-
  duplicate, invalid/stale, timeout, and transport/provider-failure evidence.
- Normal writes are verified by reading the persisted workspace project after
  the MCP call; canvas delete is verified again after undo.
- The key effect assertions are written red first, then made green by the
  smallest production-path test harness change. No UI files or storyboard
  files from #462 are changed.
- A V8 receipt reports only the changed production scope and its statement /
  branch result; it does not claim repository-wide coverage.
