# Offline credential visibility

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

Change: show saved offline credential material as “saved · not verified” without widening the availability or decrypt-status primitives.

## Design card

- ★1 User: A creator saves a key while offline, reopens the connection, comes back online, and retries a rejected replacement; the screen must preserve the saved key and state the next action. Evidence: `tests/ux/credential-offline.walk.mjs` and the eight screenshots in `docs/evidence/2026-10-08-credential-offline/`.
- ★2 Owner: `credentialRecordCounts` and `apiKeyDecryptStatus` own usable credentials; `credentialMaterialSaved` owns the material-present display fact; `readCatalog` projects both facts. Evidence: `electron/catalog/secrets.ts`, `electron/catalog/catalogStore.ts`, and `node scripts/door-map.mjs apiKeyDecryptStatus`.
- ★3 Consistency and reuse: all existing `hasApiKey` consumers keep the usable-credential meaning; only the credential presentation path reads `credentialMaterialSaved`. Evidence: the 19-door `hasApiKey` map and `credentialStateMatrix.test.ts`.
- ★4 Full states: no material, pending offline, verified usable, locked material, and user-disabled material each have explicit availability, probe, and copy behavior. Evidence: `electron/catalog/credentialStateMatrix.test.ts` and `electron/ai/onboarding/vendorHealth.test.ts`.
- ★5 Interruption matrix: states (no key / saved offline / re-checked / rejected replacement) × interruptions (offline, reconnect, close and reopen, retry, double-click save). Saved offline survives reopen (persisted, walk-asserted); reconnect re-checks once and clears pending; a rejected replacement keeps the old key; double-click is blocked while saving (`busy`). No spend happens in any cell. Evidence: `tests/ux/credential-offline.walk.mjs` (zh and en) and the eight frames in `docs/evidence/2026-10-08-credential-offline/`.
- ★6 External data and failure: external inputs are the provider `/models` probe response and the user's key. 401 gives the localized “key validation failed… previous key kept”; network failure keeps the pending state; a disabled key is never decrypted or probed (`decryptApiKeyRecord` gate, `tikhubDisabledKey.test.ts`). Unknown failures are not blamed on the user's key. Evidence: `validateCandidateCredential.ts`, `vendorHealth.ts`, the 401 frames.
- ★7 Performance budget: the decrypt gate adds one synchronous boolean check (`credentialRecordCounts`) before the keychain call, so it removes work for disabled records; the catalog projection reuses the existing read. Not measured with a benchmark: unverified. Pending revalidation stays one bounded health request.
- ★8 Real conditions: Windows, zh and en UI, real Electron (isolated temp profile, off-screen), local loopback fake endpoint, offline then reconnect then reopen; no real provider was called and no key is real (synthetic credential storage). Not run: macOS, minimum window size, clean install, real paid call (unverified). Evidence: `NOMI_WALK_LOCALE=en node tests/ux/credential-offline.walk.mjs` and the eight Read-checked frames.
- ★9 Acceptance and rollback: independent acceptance V-credoffline2 passed; build exit 0, related Vitest green, root-cause contract valid, PR judgement and merge preflight checked. Rollback: revert the round-4 commit `85898c788` (restores the form-mode stored hint, the pre-recheck copy and the ungated decrypt) and, for the whole feature, `0018cde6a` plus `b42efb2df`. Ledger: `tests/ux/full-walk/escapeLedger/FB-20261008-credential-offline-visible.json`.

### Functional classification

- [x] New UI / interaction
- [x] Long-running / asynchronous state
- [x] Data / state projection
- [ ] Spend path
- [ ] Agent behavior

### Root-cause decision

The rejected implementation widened a shared usable-credential primitive to serve display copy. This repair keeps the shared primitive stable and introduces a material-only predicate at the credential owner. A full schema split for user intent versus verification state remains a separate migration decision because old `enabled=false` pending records need an explicit read-time precedence rule.
