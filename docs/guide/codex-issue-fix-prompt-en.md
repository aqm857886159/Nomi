# Copy-paste prompt for Codex: fix a Nomi provider issue

If you can run Codex with a GitHub checkout, paste the prompt below. It gives Codex enough context to investigate the current onboarding failure without asking you to publish an API key or private contact details.

```text
===== PROMPT START =====

You are contributing to the public repository https://github.com/aqm857886159/Nomi.

## Goal

Investigate and fix the provider-onboarding problems reported in GitHub Issue #237 and the missing English onboarding path discussed in Discussion #220. Work from evidence, find the root cause, add regression coverage, and deliver a reviewable branch/PR.

## Repository setup

1. If this directory is not already the Nomi checkout, clone it:

   git clone https://github.com/aqm857886159/Nomi.git
   cd Nomi

2. Read `AGENTS.md` and any more-specific `AGENTS.md` files before editing.
3. Check the current branch and worktree status. Do not discard existing user changes.
4. Create a task branch from the latest `origin/main`, for example:

   git fetch origin
   git switch -c codex/issue-237-provider-onboarding origin/main

Do not push directly to `main` and do not rewrite history.

## Evidence to inspect

- Issue: https://github.com/aqm857886159/Nomi/issues/237
- Discussion: https://github.com/aqm857886159/Nomi/discussions/220
- The current Nomi catalog, parameter translation, transport, asset-localization, and migration code.
- The provider's official API documentation. If the provider is OpenAI, use:
  - https://developers.openai.com/api/docs/models/gpt-image-2
  - https://developers.openai.com/api/docs/guides/images-vision

Do not infer a third-party provider's API shape from its name. If the issue author uses a relay or aggregator, ask for the provider's public request example, exact base URL host, model ID, operation, and response shape. They must redact API keys, phone numbers, private email addresses, private paths, and confidential images.

## Symptoms that must be separated

Treat these as separate hypotheses and prove or disprove each one:

1. An OpenAI-compatible image request may serialize an empty `size` (for example, `Auto · 1K`) instead of omitting the field. An official or compatible image endpoint can reject that as `Invalid size ""`.
2. A stale saved catalog or old build may send GPT Image editing to `chat/completions` instead of the documented Images API multipart edit route.
3. Anonymous upload hosts such as `litterbox.catbox.moe` or `tmpfiles.org` may fail because of network/proxy/host availability. That is an asset-transport problem, not evidence that the model key is wrong. For a multipart provider route, check whether Nomi can send local bytes directly before introducing an anonymous upload dependency.

## Investigation rules

- Trace the real path end to end: UI selection → persisted model/parameters → template/parameter mapping → operation selection → request body or multipart fields → asset localization/upload → response parsing.
- Reproduce with a deterministic mock or request-body test first. Never require the issue author to give you a live secret.
- For official OpenAI GPT Image 2, verify the documented contract before editing code: `gpt-image-2`, Images API generation, multipart image edits, and the documented parameter names/types. Chat Completions is not the image-generation route.
- Fix the root cause at the shared layer so another entry point cannot reintroduce the same empty field or wrong operation. Do not add a provider-specific parallel UI or a blind fallback.
- Preserve existing migrations and compatibility rules. If old persisted catalog data needs migration, add or update a migration test.
- Do not claim that an anonymous host is fixed unless you have a reproducible, in-scope transport change and a test for it. Prefer a configured provider-private upload or direct multipart bytes for sensitive references.

## Required implementation

1. Add a failing regression test for every confirmed code bug.
2. Implement the smallest root-cause fix.
3. Add or update the English model-connection tutorial so a new user can enter a provider name, base URL, key, model ID, model kind, mode, and reference-image path without guessing. Include troubleshooting for empty `size`, route mismatch, and anonymous upload failures.
4. Link the tutorial from the English README. Keep contact links factual: use only URLs and contact addresses explicitly supplied or authorized by the maintainer; do not invent Reddit/YouTube accounts. The maintainer-authorized public support contacts are `2373272608@qq.com` and https://x.com/sdf297417627618.
5. If a provider contract is still unknown, document the missing evidence and leave a precise follow-up request instead of guessing.

## Verification

Run the narrow tests while iterating, then run the repository gates required by `AGENTS.md` (at minimum filesize, tokens, i18n, lint, typecheck, tests, and build). Review the final diff for secrets, private issue data, unrelated files, and accidental changes to the default branch.

Report:

- confirmed symptoms and root causes, with `file:line` evidence;
- changed files and why each changed;
- tests and gates with their actual results;
- what remains unverified (for example, a live relay requiring credentials);
- branch name, commit SHA, and PR URL if you have permission to push a branch. If you cannot push, provide the commit/patch and exact next command.

===== PROMPT END =====
```

This prompt is intentionally conservative: Codex can inspect the public code, reproduce request assembly with mocks, and prepare a PR, but only the provider account owner can supply a real key or approve a paid/live request.
