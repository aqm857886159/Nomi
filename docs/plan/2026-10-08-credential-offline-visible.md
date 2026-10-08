# Offline credential visibility

Change: show saved offline credential material as “saved · not verified” without widening the availability or decrypt-status primitives.

## Design card

- ★1 User: A creator saves a key while offline, reopens the connection, comes back online, and retries a rejected replacement; the screen must preserve the saved key and state the next action. Evidence: `tests/ux/credential-offline.walk.mjs` and the six screenshots in `docs/evidence/2026-10-08-credential-offline/`.
- ★2 Owner: `credentialRecordCounts` and `apiKeyDecryptStatus` own usable credentials; `credentialMaterialSaved` owns the material-present display fact; `readCatalog` projects both facts. Evidence: `electron/catalog/secrets.ts`, `electron/catalog/catalogStore.ts`, and `node scripts/door-map.mjs apiKeyDecryptStatus`.
- ★3 Consistency and reuse: all existing `hasApiKey` consumers keep the usable-credential meaning; only the credential presentation path reads `credentialMaterialSaved`. Evidence: the 19-door `hasApiKey` map and `credentialStateMatrix.test.ts`.
- ★4 Full states: no material, pending offline, verified usable, locked material, and user-disabled material each have explicit availability, probe, and copy behavior. Evidence: `electron/catalog/credentialStateMatrix.test.ts` and `electron/ai/onboarding/vendorHealth.test.ts`.
- ★5 Interruption matrix: offline, reconnect, app reopen, failed replacement, and retry each show the persisted state and a runnable next step; no state silently turns a disabled key into an available one. Evidence: the real Electron walk and the three-state Chinese and English screenshot pairs.
- ★6 External data and failure: network failure stays pending, a rejected replacement keeps the prior key and gives its failure reason, and disabled non-pending material is not decrypted or probed. Evidence: `electron/ai/onboarding/vendorHealth.ts`, `validateCandidateCredential.ts`, and the 401 screenshot pair.
- ★7 Performance budget: the UI projection is synchronous and reuses the existing catalog read; pending revalidation remains one bounded health request and never enters a paid generation path. Evidence: `pnpm run build`, the walk’s zero-paid-call assertion, and `electron/catalog/catalogStore.ts`.
- ★8 Real conditions: Windows Electron, Chinese and English UI, offline save, reconnect, persisted reopen, and real loopback HTTP responses are covered; synthetic key storage is used only to isolate the local evidence run. Evidence: `node tests/ux/credential-offline.walk.mjs`, the English temporary-locale walk, and the six Read-checked screenshots.
- ★9 Acceptance and rollback: acceptance is build exit 0, related Vitest green, root-cause contract valid, preflight green, and both locale screenshot pairs present; rollback is reverting feature commit `0018cde6a` while retaining the refreshed baseline merge. Evidence: `.tmp-pr-body.md`, `pnpm run build`, 15-file/115-test Vitest run, and `pnpm run delivery:preflight`.

### Functional classification

- [x] New UI / interaction
- [x] Long-running / asynchronous state
- [x] Data / state projection
- [ ] Spend path
- [ ] Agent behavior

### Root-cause decision

The rejected implementation widened a shared usable-credential primitive to serve display copy. This repair keeps the shared primitive stable and introduces a material-only predicate at the credential owner. A full schema split for user intent versus verification state remains a separate migration decision because old `enabled=false` pending records need an explicit read-time precedence rule.
