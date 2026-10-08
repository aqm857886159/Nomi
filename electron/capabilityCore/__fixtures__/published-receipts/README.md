# Published proposal receipt fixtures

These JSON files are the release-boundary samples for the durable Agent
proposal receipt. The matrix test discovers every `*.json` file in this
directory; adding a release sample is therefore part of the release checklist.

The samples were generated with the writer from each tag using:

```text
pnpm exec tsx scripts/generate-published-receipt-fixtures.mjs v0.22.0 v0.22.1 v0.22.2 v0.22.3 v0.22.4 v0.22.5 v0.23.0 v0.23.1 --pre-journal-v2
```

The generator uses `git show` to extract the historical writer and its local
TypeScript imports, runs the real service through `tsx`, and writes a preparing
then committed receipt with a fixed timestamp. `git log --follow` shows the
writer first appeared in `0b6441c69`; `v0.22.0` is the earliest release tag
containing it, so there is no earlier published receipt sample to add.

`v0.22.0.json` and `v0.23.0.json` are the complete schema-2 journal output of
their tagged writers. The `v0.22.5` writer also emits the complete journal in
the tag source, but the upgrade incident contained a valid schema-2
pre-journal shape on disk. The `--pre-journal-v2` projection preserves that
observed release-boundary shape so the compatibility matrix proves the
migration path; the raw writer output is reproducible by rerunning the same
command without that flag.

When a new version ships, add its tag to the command and commit its generated
`v<version>.json` file in the same change. If a release writes a new shape,
keep the old samples and add the new one; do not replace history.
