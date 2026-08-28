# Project Agent Host Phase 2B Lane C Call Surface

This is a read-only implementation-batch inventory. The closure contract remains
the source of truth; this note records the concrete call surface used by Lane C.

| Contract | Production call points | Test fixtures / direct verification | Deletion debt or ownership note |
| --- | --- | --- | --- |
| `P2B-EVENT-001` | `projectAgentTurnCommands.ts` event adapter; `workbenchAgentRunner.ts`; Creation and Canvas subscriptions | `projectAgentTurnCommands.test.ts`, `workbenchAgentRunner.test.ts`; `pnpm exec vitest run src/workbench/ai/projectAgentTurnCommands.test.ts src/workbench/ai/workbenchAgentRunner.test.ts` | Event identity is transport-only: subscription ID + epoch + Host execution token. `turnId` alone is insufficient. |
| `P2B-OWNER-001` | `projectAgentProjectionStore.ts`; pending registry; Creation/Canvas panel view selectors | `projectAgentTurnCommands.test.ts`, `CanvasAssistantPanel.test.ts`; same focused command | Host snapshot owns busy, terminality, writability, and pending lifetime. Panels may retain cancellation/editor callbacks only. |
| `P2B-THREAD-001/002` | active-thread selector in pending registry; Creation/Canvas thread effects | `projectAgentTurnCommands.test.ts`, `projectAgentProjectionStore.test.ts`; same focused command | Switching threads hides old entries without rejecting, transferring, or deciding them. |
| `P2B-ASSET-001..005` | renderer `projectAgentAttachmentClaims`; IPC `executionEnqueueField`; main `resolveProjectAgentAttachmentClaims`; queue stores resolved refs | `projectAgentAttachments.test.ts`, `projectAssetStore.test.ts`, `projectAgentIpc.test.ts`; `pnpm exec vitest run src/workbench/ai/projectAgentAttachments.test.ts electron/assets/projectAssetStore.test.ts electron/projectAgentHost/projectAgentIpc.test.ts` | Renderer submits only `{ assetId, version }`; main derives hash, metadata, and `nomi-local` URL. Canonical Host fixtures still use `attachmentRefs` by design. |
| `P2B-SHELL-001` | Existing Creation/Canvas shell selectors and cards; Host queue/proposal projection | `CanvasAssistantPanel.test.ts`, `projectAgentProjectionStore.test.ts`, `projectAgentUiCommands.test.ts`, proposal/queue focused tests | Preserve queue edit/cancel, approval/decline, stop, TaskRef, conflict/failure, attachments/history, proposal commit/deviation/Undo. No persistent pending UI store is introduced. |

## Direct Lane C Commands

```text
pnpm exec vitest run src/workbench/ai/projectAgentTurnCommands.test.ts src/workbench/ai/projectAgentAttachments.test.ts electron/assets/projectAssetStore.test.ts
pnpm exec vitest run src/workbench/ai/workbenchAgentRunner.test.ts src/workbench/ai/projectAgentProjectionStore.test.ts src/workbench/generationCanvas/components/CanvasAssistantPanel.test.ts
pnpm exec vitest run electron/projectAgentHost/projectAgentIpc.test.ts src/workbench/ai/projectAgentProjectionStore.test.ts src/workbench/ai/projectAgentUiCommands.test.ts

# Lane C close matrix (2026-08-29)
pnpm exec vitest run electron/projectAgentHost/projectAgentCutoverStructure.test.ts electron/projectAgentHost/projectAgentExecutionCoordinator.test.ts electron/projectAgentHost/projectAgentMigration.test.ts electron/projectAgentHost/projectAgentReducer.test.ts electron/projectAgentHost/projectAgentProposalReceiptStore.test.ts electron/projectAgentHost/projectAgentIpc.test.ts electron/assets/projectAssetStore.test.ts src/workbench/ai/projectAgentProjectionStore.test.ts src/workbench/ai/projectAgentUiCommands.test.ts src/workbench/ai/projectAgentClient.test.ts src/workbench/ai/projectAgentTurnCommands.test.ts src/workbench/ai/projectAgentAttachments.test.ts src/workbench/ai/workbenchAgentRunner.test.ts src/workbench/generationCanvas/agent/canvasApprovalSteps.test.ts src/workbench/generationCanvas/agent/canvasToolApproval.test.ts src/workbench/generationCanvas/agent/proposalTxn.test.ts src/workbench/generationCanvas/agent/proposalUndo.test.ts src/workbench/generationCanvas/agent/proposalUndoReceiptLifecycle.test.ts src/workbench/generationCanvas/components/CanvasAssistantPanel.test.ts src/workbench/generationCanvas/components/assistantTimelineChronology.test.ts
# Result: 20 files passed, 179 tests passed, 1.72s
```

No typecheck, lint, build, package, GUI, or repository-wide test is part of this
implementation batch.
