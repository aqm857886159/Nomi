# Offline credential visibility design card

Change: show saved offline key material as “已保存 · 未验证” without changing the existing availability/decrypt primitive.

| ★ | Decision | Evidence |
|---|---|---|
| ★1 User | A key can be stored while unavailable; the UI must say both facts plainly and never make the user paste it again. | `tests/ux/credential-offline.walk.mjs`, `KnownVendorKeyConnectPage.tsx` |
| ★2 Owner | `credentialRecordCounts` / `apiKeyDecryptStatus` remain the execution owner. `credentialMaterialSaved` is the material-only display owner; `readCatalog` projects both facts. | `electron/catalog/secrets.ts`, `electron/catalog/catalogStore.ts` |
| ★3 Interaction | Pending material shows saved/not verified, online health revalidation is allowed only by `verificationPending`, and generation remains unavailable until promotion. | `electron/ai/onboarding/vendorHealth.ts`, `electron/catalog/catalogModelAvailability.ts` |
| ★4 Validation | State matrix, health probe guard, catalog projection, related Vitest, real Electron walk, and production build. | `electron/catalog/credentialStateMatrix.test.ts`, `electron/ai/onboarding/vendorHealth.test.ts` |
| ★9 Risk | A full split of user intent from pending/verified state would require a separate schema migration and precedence decision for old `enabled=false` records. This change does not alter provider request construction or spend paths. | Direction review and root-cause contract |

## Functional classification

- New UI / interaction: yes
- Long-running / asynchronous state: yes
- Data / state projection: yes
- Spend path: no
- Agent behavior: no

## Root cause

The rejected implementation widened `credentialRecordCounts` to count disabled records. That changed `apiKeyDecryptStatus` for service catalog, connectors, catalog health, and catalog projection. The corrective implementation keeps that primitive unchanged and adds a display-only material predicate.

## Acceptance

- Disabled pending: `credentialMaterialSaved=true`, `hasApiKey=false`, `credentialVerificationPending=true`, `enabled=false`; UI says saved/not verified; availability is false.
- Verified enabled: `credentialMaterialSaved=true`, `hasApiKey=true`; availability is true.
- User-disabled non-pending: no decrypt, no probe, no outbound use, no available badge.
- Verified failure keeps the old key and failure reason.
