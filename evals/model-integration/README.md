# Model integration acceptance evidence

This directory stores redacted, reviewable acceptance inputs and results for the
conversational model-integration boundary. It must never contain API keys,
credential references, signed URLs, user file paths, or raw provider error pages.

The two process journeys are:

- `tests/ux/model-integration-no-repo.mjs`: J0 tools/resources discovery from an
  isolated empty working directory, including the unsigned generic-host write
  rejection.
- `tests/ux/model-integration-packaged.e2e.mjs`: J4 no-spend stop/restart
  readback using the same isolated user data and signed client identity.

Run them after `pnpm run build`:

```bash
node tests/ux/model-integration-no-repo.mjs --packaged /absolute/path/to/Nomi.app
node tests/ux/model-integration-packaged.e2e.mjs --packaged /absolute/path/to/Nomi.app
```

`manifest.template.json` is the schema-shaped checklist. The dated JSON file is
the latest local evidence snapshot; `unverified` entries are intentional when a
real provider, native ComfyUI instance, WorkBuddy host, or release restart
account is not available. Mock traffic never upgrades an external entry to
`pass`.
