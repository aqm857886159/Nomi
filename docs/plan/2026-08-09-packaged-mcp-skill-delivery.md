# Packaged MCP Skill Delivery

Status: complete and verified on the installed macOS app (2026-08-09).

## Problem

The packaged Nomi MCP server exposes all 13 tools, but a build launched outside the repository cannot discover built-in director and writer skills. The package whitelist includes `resources/**` while the built-in skill packs live under `skills/**`. Repository-based tests passed because `getSkillsRoots()` also checks `process.cwd()/skills`.

## Scope

- Include the existing `skills/**` tree in the application package.
- Add a package smoke test that launches the built app from an isolated working directory.
- Verify MCP initialize, all 13 tools, skill resource discovery, and full director skill reading.
- Create one isolated, zero-provider Production Draft per signed client and verify exact `claude`, `codex`, and `cursor` origins.
- Run the smoke test automatically after the macOS directory build.

## Non-goals

- Do not change skill lookup precedence or user-imported skill behavior.
- Do not add another skill copy or fallback path.
- Do not change Production Run tools, approvals, or public claims.
- Do not call a model provider or spend user credit in packaging smoke.

## Rollback

Revert the package whitelist and post-build smoke together. No user project data is touched; the rollback merely returns to the known state where built-in skills can disappear outside the repository.

## Acceptance

1. `pnpm run gates` passes.
2. `pnpm run dist:mac:dir` passes its packaged MCP smoke test from an isolated `cwd`.
3. The installed `/Applications/Nomi.app` reports 13 tools and can read `director.cinematography`.
4. Claude Code, Codex, and Cursor all use the installed binary and pass real initialization.

## Release verification

- `pnpm run dist:mac:dir` passed its isolated packaged smoke with 13 tools, 24 resources, a 7,885-character director Skill body, and exact `claude/codex/cursor` Production Draft origins.
- `/Applications/Nomi.app` passed both isolated and real installed-app activation journeys; each real client configuration exposed 13 tools from the installed binary.
- `claude mcp list`, `codex mcp list`, and `cursor-agent mcp list` all report the installed Nomi server available after the Codex TOML upgrade fix.
- No packaged smoke or activation journey called a model provider. All created smoke projects and Production Drafts were isolated and removed automatically.
