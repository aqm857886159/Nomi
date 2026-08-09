# MCP Client Activation Truth

Status: complete and verified on the installed macOS app (2026-08-09).

## Problem

Nomi previously called a configured MCP command directly and labelled a successful handshake as “Connected to Cursor.” That hid two independent blockers:

1. Every MCP Production Run was stamped `origin.host = external`, while Nomi's trusted-host policy only accepts `claude`, `codex`, or `cursor`. A budgeted run therefore stopped at `untrusted-host` even after a successful handshake.
2. Cursor has its own approval boundary. Nomi can verify the local server and grant Nomi-side draft authority, but cannot prove or silently change Cursor's local MCP approval.

The result was a green connection state that could not complete the advertised workflow.

## Decision

| Option | User-visible result | Cost / risk |
|---|---|---|
| Trust `initialize.clientInfo.name` | No reconnect required | Any caller can self-declare `codex` or `cursor`; rejected as unsafe |
| Trust every local bearer-token caller | Fewer settings | Collapses client isolation and lets generic local RPC calls inherit assistant authority; rejected |
| Nomi-signed, client-scoped capability | Reconnect once, then each client has truthful Nomi-side identity | Adds two generated environment values; selected |

Nomi derives an HMAC proof from the local capability token and the context `nomi-mcp-client:v1:<client>`. The proof is written only by Nomi's install/copy-config path. stdio and GUI RPC independently verify the client/proof pair. Missing, forged, or cross-client proofs resolve to `external`; request parameters and MCP `clientInfo` never grant authority.

## Scope

- Generate client-scoped configuration for Claude Code, Codex, and Cursor with `NOMI_MCP_CLIENT` and `NOMI_MCP_CLIENT_PROOF`.
- Carry verified identity through direct stdio dispatch and the GUI loopback RPC bridge.
- Treat unsigned current-launcher configurations as stale and require reconnect.
- Keep direct initialize + `tools/list` verification as transport evidence only.
- Show Cursor's local connection, Nomi permission, and Cursor permission as three separate rows.
- Keep Cursor's summary neutral even after a successful direct handshake.
- Deep-link the remaining Nomi permission action to the Cursor row, then focus its switch after policy loading completes.
- Disable AI and automation policy controls until the persisted policy has loaded, preventing defaults from overwriting existing budgets, models, or trust settings.
- Refresh the assistant card after policy persistence so the completed Nomi permission is visible immediately.

## Non-goals

- Nomi must not write Cursor's approval store or silently approve itself.
- Do not infer Cursor approval from a workspace-specific file.
- Do not broaden any host's authority to approve spend, rough cuts, export, publish, delete, or overwrite.
- Do not add batch generation or editing features.

## Adversarial review

Three independent passes found the following failure modes, all addressed in this change:

- Cursor showed a green success state before all activation boundaries were satisfied.
- A missing verification result fell back to generic “connected” copy. Green now requires a real successful handshake for Claude Code and Codex; Cursor always remains neutral.
- The Nomi permission action opened only the top of Settings. It now targets and focuses the Cursor switch.
- The card did not read Nomi's trusted-host state. `mcpInfo` now includes that policy and refreshes after persistence.
- Settings could be changed before asynchronous policy loading completed. Both affected tabs are disabled until the read settles.
- Existing tests only searched source strings. A pure activation-state matrix now covers unknown, checking, verified, and broken states; protocol tests cover forged and cross-client proofs.
- A real Codex upgrade exposed a second TOML shape: `[mcp_servers.nomi.env]` survived replacement of the parent table, then conflicted with the new inline `env` key and prevented Codex from loading any configuration. Nomi now removes the complete `mcp_servers.nomi` table family and has a regression test using that exact legacy shape.
- The installed-app journey assumed a reconnect button and Cursor permission CTA always existed. Healthy current configurations intentionally show neither. The journey is now idempotent: it reconnects only stale entries, otherwise requires a 13-tool handshake, and only opens permissions when Cursor is not already trusted.

Two environmental setup issues are intentionally handled without destructive automation:

- Paths containing spaces must remain structured command/argument values rather than shell-concatenated strings.
- Installing Nomi updates only the named `nomi` entry and preserves same-named client configuration files and unrelated MCP servers, with a recoverable `.nomi-backup`.

## Rollback

Revert this change and use each client's `.nomi-backup` configuration. That restores transport connectivity but also restores the known `origin.host = external` blocker; it is not a production-safe fallback.

## Acceptance

1. Cursor never shows the generic “Connected” copy based only on Nomi's direct handshake.
2. Unsigned, forged, and cross-client identities produce `external`; each Nomi-signed client produces its exact host origin.
3. The Cursor state names the remaining client-side approval and links to the focused Nomi permission row.
4. Unknown verification never produces a green connection state.
5. Bilingual copy, state-matrix tests, RPC tests, and packaged Production Draft smoke cover the distinction.
6. Full gates, packaged smoke, real installed-app UI checks, and all three real client initializations pass.

## Release verification

- Official Codex behavior was checked against the [OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp): `codex mcp list`, stdio environment variables, startup/tool timeouts, and `writes` approval mode are supported configuration.
- `/Applications/Nomi.app` packaged smoke passed from an isolated working directory for three separately signed clients: 13 tools, 24 resources, full `director.cinematography` body (7,885 characters), and exact origins `claude/codex/cursor`.
- The installed-app activation journey passed in isolated and real-user modes. Claude Code, Codex, and Cursor each completed a real handshake and exposed 13 tools; Chinese light mode, English dark mode, and the 520 px compact layout were visually inspected.
- Client managers report Nomi healthy: Claude Code `Connected`, Codex `enabled`, and Cursor `ready`. All three entries point to `/Applications/Nomi.app/Contents/MacOS/Nomi`; recoverable `.nomi-backup` files remain in place.
- A real Claude Code Production Draft persisted `origin.host = claude`; a real Codex Production Draft persisted `origin.host = codex`. Both stopped at `awaiting_direction`, with authorized, reserved, actual, and unsettled Nomi spend all equal to zero.
- Cursor Agent is not signed in on this machine, so it correctly refuses to begin a model session. Nomi does not hide or bypass that external account boundary. Cursor's real config still passed its signed 13-tool handshake, while packaged end-to-end draft verification proved `origin.host = cursor` with the same client-scoped protocol.
- Claude Code validation used USD 0.64500575 of Claude model budget across one intentionally capped attempt and one successful attempt. Nomi called no model provider and spent no generation credit.
- The three empty/zero-spend acceptance projects were removed from the project library and moved to Trash, where their evidence remains recoverable.
