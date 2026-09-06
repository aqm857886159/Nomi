# MCP locale and tool titles

> 🚧 进行中

## Scope
- Persist the selected desktop locale in the settings root and let the bare Node MCP launcher use it before the OS locale fallback.
- Refresh the launcher locale from the live GUI over authenticated loopback RPC so an in-session language change takes effect without restarting the launcher.
- Add zh-CN/en human titles for all nine semantic MCP tools and project the title selected by the MCP transport locale.
- Remove the L1 handshake title exemption and update the byte ratchet surgically.

## Invariants
- A stored `preferences.language` wins whenever present; system locale is only the no-preference/offline fallback.
- Live RPC locale is authoritative while the GUI is reachable; the launcher cache is replaced on every request refresh.
- Every listed MCP tool has a non-empty title in both supported locales.
- Existing tool routing, schemas, annotations, and result localization stay unchanged.

## Validation and rollback
- Red then green unit tests for persisted/offline/online locale precedence and localized tools/list titles.
- MCP surface and L1 handshake tests, payload check, typecheck, lint, and gates.
- Revert this commit to remove the persistence/RPC/title projection as one atomic change.
