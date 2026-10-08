# Direction check: offline credential visibility

This is the fourth fix touching `KnownVendorKeyConnectPage` within the 14-day window. The review question is whether the prior patch changed a shared credential primitive to make a display case pass.

## Root cause and decision

`ApiKeyRecord.enabled` is currently used by the existing catalog lifecycle as the execution gate, while `verificationPending` marks a save that must be retried. The rejected implementation changed `credentialRecordCounts` to ignore `enabled`, which changed `apiKeyDecryptStatus` for every consumer. That allowed disabled records to look decryptable to service catalog, connectors, health, and catalog projection.

The corrective direction keeps `credentialRecordCounts` and `apiKeyDecryptStatus` unchanged: they continue to mean usable/decryptable credential material. A new `credentialMaterialSaved` predicate is owned by `secrets.ts` and is projected only as renderer display metadata. Pending health revalidation is an explicit `verificationPending` exception; ordinary disabled records remain blocked. No provider request construction changes.

## Why the larger rewrite is deferred

The full class-root rewrite would add an independent user-intent field, migrate old records, and define precedence for old `enabled=false` records that have or lack `verificationPending`. That is a catalog schema decision spanning all credential writers and the promotion/depublication lifecycle. It is higher risk than this corrective boundary and requires a separate direction approval. This change documents the cost and keeps the existing on-disk shape while preventing the unsafe primitive semantic change.

## Evidence and prevention

- `credentialStateMatrix.test.ts` names every `apiKeyDecryptStatus` / `credentialRecordCounts` consumer and asserts disabled keys remain unavailable.
- `vendorHealth.test.ts` proves pending material may revalidate while disabled non-pending material never probes.
- `catalogReadCache.test.ts` and the real Electron walk prove `hasApiKey=false` remains the availability fact while `credentialMaterialSaved=true` drives “已保存 · 未验证”.
- `node scripts/door-map.mjs hasApiKey` reports 19 read doors; they remain on the availability/readiness projection. `node scripts/door-map.mjs credentialRecordCounts` reports the two shared write boundaries.

## Independent line boundary

F-vendorhealth2 may change custom relay authorization-header precedence. This line only changes the pending-vs-disabled probe gate and display projection; it does not change request construction or header precedence.

## Direction-Check

Recommended: keep this focused boundary fix and open a separate schema direction review before introducing a user-intent field or read-time migration.
