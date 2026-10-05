/**
 * 面板上「撤销这批」（runProposalUndo）遇上开着的导演台：和 Agent 撤销走同一个 embeddedEditorFlush——
 * 先把没落盘的手改落盘，再判冲突。3D-BOX 的补偿把整份节点 meta 放回去，提交之后这个节点又被改过
 * （含刚落盘的手改）→ 拒绝并说明，手改原样留着；没有后续改动 → 照常撤销、编辑器跟着重载。
 * 走真实边界：真提议事务、真收据转移（lane 命令桩）、真撤销日志、真编辑器 store。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirectorWriteInput } from '../../../../../../electron/shared/agentCapabilities/directorWrite'
import { laneClient } from '../../../../ai/lane/laneClient'
import { registerEmbeddedEditorFlush } from '../../../agent/embeddedEditorFlush'
import { applyProposalBatch } from '../../../agent/proposalTxn'
import { hydrateCommittedProposalReceipt, runProposalUndo, type CommittedProposalRecord } from '../../../agent/proposalUndo'
import { __resetCanvasUndoJournalForTests } from '../../../events/canvasUndoJournal'
import { useGenerationCanvasStore } from '../../../store/generationCanvasStore'
import { createDirectorNodeSync } from '../directorNodeSync'
import { registerDirectorSession } from '../directorSessionRegistry'
import { DIRECTOR_PROJECT_META_KEY } from '../model/directorNodeMeta'
import { normalizeDirectorProject } from '../model/directorProject'
import { createDirectorStore } from '../model/directorStore'
import type { DirectorWriteDomainResult } from './applyDirectorWrite'

const lane = vi.hoisted(() => ({
  binding: { projectId: 'p-undo-editor', immutableProjectUuid: '22222222-2222-4222-8222-222222222222', projectGeneration: 1 },
  proposal: null as null | Record<string, unknown>,
}))

const plan = {
  scene: { environment: 'day', template: 'room', tags: ['书房'] },
  actors: [
    { id: 'reader', kind: 'person', desc: '读者', placement: { relation: 'at', ref: 's1-room-floor' } },
    { id: 'friend', kind: 'person', desc: '朋友', placement: { relation: 'in_front_of', ref: 'reader' } },
  ],
  shots: [
    { id: 'wide', window: [0, 3], transitionIn: 'cut', subject: 'reader', subjects: ['reader', 'friend'], size: '全景', angle: 'front', height: 'eye', move: { kind: 'static' } },
    { id: 'close', window: [3, 6], transitionIn: 'cut', subject: 'friend', size: '中景', angle: 'three_quarter', height: 'eye', move: { kind: 'push_in', speed: 'slow' } },
  ],
}

const nodeById = (id: string) => useGenerationCanvasStore.getState().nodes.find((node) => node.id === id)

async function commit(input: DirectorWriteInput): Promise<{ result: DirectorWriteDomainResult; record: CommittedProposalRecord }> {
  const outcome = await applyProposalBatch([{ toolCallId: `tc-${input.operation}`, toolName: input.operation, effectiveArgs: input as unknown as Record<string, unknown> }])
  if (outcome.status !== 'committed') throw new Error(`aborted: ${outcome.reason}`)
  return {
    result: outcome.results[0] as DirectorWriteDomainResult,
    record: { proposalId: outcome.proposalId, summary: 'stage_shot', stepLabels: ['3D-BOX'], compensation: outcome.compensation, watchNodes: outcome.watchNodes, reconciliationOk: outcome.reconciliation.ok },
  }
}

function hydrate(record: CommittedProposalRecord): void {
  lane.proposal = record as unknown as Record<string, unknown>
  hydrateCommittedProposalReceipt({ binding: lane.binding, revision: 2, lifecycle: 'committed', proposalId: record.proposalId, operationId: `commit-${record.proposalId}`, proposal: record })
}

beforeEach(async () => {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  __resetCanvasUndoJournalForTests()
  laneClient.connect({
    onProjection: () => () => undefined,
    send: async (command) => {
      if (command.kind === 'workspace-open') return { ok: true, workspaceId: 'ws-undo-editor' }
      if (command.kind === 'receipt-read') return { ok: true, receipt: null }
      if (command.kind === 'receipt-transition') {
        return { ok: true, receipt: { binding: lane.binding, revision: command.input.expectedRevision + 1, lifecycle: command.input.lifecycle, proposalId: command.input.proposalId, operationId: command.input.operationId, proposal: lane.proposal } as never }
      }
      throw new Error(`unexpected lane command ${command.kind}`)
    },
  })
  await laneClient.open(lane.binding)
})

afterEach(() => laneClient.connect(undefined))

/** 和 DirectorEditor 同一套接线：会话登记 + 同步账 + 事务 / 撤销前落盘。 */
function openEditor(nodeId: string) {
  const raw = nodeById(nodeId)?.meta?.[DIRECTOR_PROJECT_META_KEY]
  const store = createDirectorStore({ rawProject: raw, defaultSceneName: 'S' })
  const sync = createDirectorNodeSync({
    store, defaultSceneName: 'S', initialRaw: raw,
    write: (project) => useGenerationCanvasStore.getState().updateNode(nodeId, { meta: { ...nodeById(nodeId)?.meta, [DIRECTOR_PROJECT_META_KEY]: project } }),
  })
  const offSession = registerDirectorSession(nodeId, { store, defaultSceneName: 'S', onExternalProjectChange: sync.persist })
  const offFlush = registerEmbeddedEditorFlush(sync.saveNow)
  return { store, sync, close: () => { offFlush(); offSession() } }
}

describe('面板「撤销这批」遇上开着的导演台', () => {
  it('补丁之后又手调了、还没落盘：先落盘，再拒绝撤销并说明；手调留在编辑器和节点上', async () => {
    const created = (await commit({ operation: 'create_director_plan', plan } as DirectorWriteInput)).result
    if (!created.applied) throw new Error('create failed')
    const editor = openEditor(created.directorNodeId)
    try {
      const { record } = await commit({ operation: 'patch_director_plan', directorNodeId: created.directorNodeId, baseRevision: created.revision, edits: [{ op: 'replace', path: '/shots/close/size', value: '特写' }] })
      const wide = editor.store.getState().findCamera('shot:wide/camera')!
      editor.store.getState().updateCamera(wide.id, { fov: 18 })
      expect(editor.sync.isDirty()).toBe(true)

      hydrate(record)
      await expect(runProposalUndo(record)).rejects.toThrow(/undo_conflict/)
      expect(editor.store.getState().findCamera('shot:wide/camera')?.fov).toBe(18)
      const saved = normalizeDirectorProject(nodeById(created.directorNodeId)?.meta?.[DIRECTOR_PROJECT_META_KEY])
      expect(saved.scenes[0].cameras.find((camera) => camera.id === 'shot:wide/camera')?.fov).toBe(18)
    } finally {
      editor.close()
    }
  })

  it('补丁之后没再动：照常撤销，编辑器重载撤销后的工程', async () => {
    const created = (await commit({ operation: 'create_director_plan', plan } as DirectorWriteInput)).result
    if (!created.applied) throw new Error('create failed')
    const editor = openEditor(created.directorNodeId)
    try {
      const beforePatch = JSON.stringify(nodeById(created.directorNodeId)?.meta)
      const { record } = await commit({ operation: 'patch_director_plan', directorNodeId: created.directorNodeId, baseRevision: created.revision, edits: [{ op: 'replace', path: '/shots/close/size', value: '特写' }] })
      hydrate(record)
      await runProposalUndo(record)
      expect(JSON.stringify(nodeById(created.directorNodeId)?.meta)).toBe(beforePatch)
      expect(editor.sync.adoptNodeProject(nodeById(created.directorNodeId)?.meta?.[DIRECTOR_PROJECT_META_KEY])).toBe(true)
    } finally {
      editor.close()
    }
  })
})
