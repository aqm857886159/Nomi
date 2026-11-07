// 「这张卡的模型说不了话」那条提示的事实与前提（2026-09-29 走查 pb06）。
// 前半是纯函数；后半用**真的**画布 store + **真的** toast 所有者跑完整生命周期：
// 提示挂上去以后，节点的每一种状态转移（换家 / 重跑 / 成功 / 删除）都必须让它自己收掉——不靠定时器、不靠谁记得去关。
import { beforeEach, describe, expect, it } from 'vitest'
import { notifications, notificationsStore } from '@mantine/notifications'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useToastStore } from '../../../ui/toast'
import {
  candidateNoticeStillHolds,
  disconnectionNoticeStillHolds,
  failedAttemptOf,
  failureDescribesCurrentSelection,
  failureNoticeStillHolds,
  nodeNoticeValidity,
  nodeRecoveryToastId,
  providerFailedValues,
  vendorLabelFor,
} from './nodeRecoveryNotice'

const A = { vendorKey: 'vendor-a', modelKey: 'image-model' }
const failedNode = (overrides: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode => ({
  id: 'n1', kind: 'image', title: 'card', position: { x: 0, y: 0 }, prompt: 'x',
  status: 'error', error: 'Provider request failed',
  meta: { modelVendor: A.vendorKey, modelKey: A.modelKey },
  runs: [{ id: 'run-1', status: 'error', startedAt: 1, updatedAt: 10, attempt: A, error: 'Provider request failed' }],
  ...overrides,
})

describe('failedAttemptOf — who failed is a fact on the failure record', () => {
  it('names the dispatched pair and identifies this failure by its run', () => {
    expect(failedAttemptOf(failedNode())).toEqual({ ...A, error: 'Provider request failed', occurrence: 'run-1@10' })
  })

  it('does not guess from the node when the record does not say (legacy runs, non-vendor failures)', () => {
    const legacy = failedNode({ runs: [{ id: 'run-1', status: 'error', startedAt: 1, updatedAt: 10, error: 'x' }] })
    expect(failedAttemptOf(legacy)).toBeNull()
    expect(failedAttemptOf(failedNode({ runs: [] }))).toBeNull()
    expect(failedAttemptOf(failedNode({ runs: undefined }))).toBeNull()
  })

  it.each([
    ['not in an error state', { status: 'success' as const }],
    ['running again', { status: 'running' as const }],
    ['no error text', { error: undefined }],
  ])('is null when the node is %s', (_label, patch) => {
    expect(failedAttemptOf(failedNode(patch))).toBeNull()
  })

  it('a later run replaces the failure identity; a rewritten reason on the same run is another occurrence too', () => {
    const next = failedNode({ runs: [{ id: 'run-2', status: 'error', startedAt: 20, updatedAt: 30, attempt: A, error: 'again' }, ...(failedNode().runs ?? [])] })
    expect(failedAttemptOf(next)?.occurrence).toBe('run-2@30')
    const rewritten = failedNode({ runs: [{ id: 'run-1', status: 'error', startedAt: 1, updatedAt: 99, attempt: A, error: 'different reason' }] })
    expect(failedAttemptOf(rewritten)?.occurrence).toBe('run-1@99')
  })
})

describe('the failure describes the card only while the card still points at the failed pair', () => {
  it('is true for the failed pair and false as soon as the vendor or the model differs', () => {
    const failed = failedAttemptOf(failedNode())!
    expect(failureDescribesCurrentSelection(failedNode(), failed)).toBe(true)
    expect(failureDescribesCurrentSelection(failedNode({ meta: { modelVendor: 'vendor-b', modelKey: A.modelKey } }), failed)).toBe(false)
    expect(failureDescribesCurrentSelection(failedNode({ meta: { modelVendor: A.vendorKey, modelKey: 'other-model' } }), failed)).toBe(false)
  })

  it('the notice stops holding when the node leaves this failure (retry, success, another failure, deletion)', () => {
    const failed = failedAttemptOf(failedNode())!
    expect(failureNoticeStillHolds(failedNode(), failed)).toBe(true)
    expect(failureNoticeStillHolds(failedNode({ status: 'running' }), failed)).toBe(false)
    expect(failureNoticeStillHolds(failedNode({ status: 'success' }), failed)).toBe(false)
    expect(failureNoticeStillHolds(failedNode({ runs: [{ id: 'run-2', status: 'error', startedAt: 20, updatedAt: 30, attempt: A, error: 'x' }] }), failed)).toBe(false)
    expect(failureNoticeStillHolds(undefined, failed)).toBe(false)
  })

  it('the disconnection notice holds only while the pinned model is still missing and the card did not change', () => {
    const node = failedNode({ status: 'idle', error: undefined })
    expect(disconnectionNoticeStillHolds(node, A, true)).toBe(true)
    expect(disconnectionNoticeStillHolds(node, A, false)).toBe(false) // 模型清单里又有它了
    expect(disconnectionNoticeStillHolds(failedNode({ meta: { modelVendor: 'vendor-b', modelKey: A.modelKey } }), A, true)).toBe(false)
    expect(disconnectionNoticeStillHolds(undefined, A, true)).toBe(false)
  })

  it('the candidate notice holds only while the card still has no model', () => {
    expect(candidateNoticeStillHolds(failedNode({ meta: {} }))).toBe(true)
    expect(candidateNoticeStillHolds(failedNode())).toBe(false)
  })

  it('one card, one notice identity', () => {
    expect(nodeRecoveryToastId('n1')).toBe(nodeRecoveryToastId('n1'))
    expect(nodeRecoveryToastId('n1')).not.toBe(nodeRecoveryToastId('n2'))
  })
})

const items = () => {
  const state = notificationsStore.getState()
  return [...state.notifications, ...state.queue]
}
const store = () => useGenerationCanvasStore.getState()
const nodeState = (id = 'n1') => store().nodes.find((candidate) => candidate.id === id)

/** 真 store + 真所有者：把失败的卡放进画布，挂上切家提示，返回它的失败事实。 */
function showFailureNotice() {
  const node = store().addNode({ kind: 'image', prompt: 'x', meta: { modelVendor: A.vendorKey, modelKey: A.modelKey } })
  const run = store().appendNodeRun(node.id, { status: 'queued', attempt: A })
  store().setNodeStatus(node.id, 'error', 'Provider request failed')
  const failed = failedAttemptOf(nodeState(node.id))!
  expect(failed).toMatchObject({ ...A, occurrence: expect.stringContaining(run.id) })
  useToastStore.getState().push({
    id: nodeRecoveryToastId(node.id), occurrence: failed.occurrence, reason: 'server', message: 'vendor-a failed', type: 'warning', ttl: false,
    actionLabel: 'switch', onAction: () => {},
    validWhile: nodeNoticeValidity({ nodeId: node.id, holds: (current) => failureNoticeStillHolds(current, failed) }),
  })
  return { nodeId: node.id, failed }
}

// 2026-09-30：提示开头写的是 `agent-runtime-loopback` 这样的内部 key，真用户该看到 APIMart / 自己起的来源名称。
describe('the notice names the vendor by its display name, not its id', () => {
  const options = [
    { vendor: 'vendor-a', vendorName: 'APIMart' },
    { vendor: 'vendor-b' },
    { vendor: 'vendor-c', vendorName: '   ' },
  ]

  it('reads the display name the model options carry', () => {
    expect(vendorLabelFor(options, 'vendor-a')).toBe('APIMart')
  })

  it('falls back to the key only when no option carries a name for that vendor', () => {
    expect(vendorLabelFor(options, 'vendor-b')).toBe('vendor-b')
    expect(vendorLabelFor(options, 'vendor-c')).toBe('vendor-c')
    expect(vendorLabelFor(options, 'vendor-z')).toBe('vendor-z')
  })

  it('the failure notice values carry the label and drop the reason’s own full stop', () => {
    expect(providerFailedValues('APIMart', { reason: 'The provider said no.', hint: 'Try again.' })).toEqual({ vendor: 'APIMart', reason: 'The provider said no', hint: 'Try again.' })
  })
})

describe('lifecycle on the real store and the real toast owner', () => {
  beforeEach(() => {
    notifications.clean()
    notificationsStore.setState({ ...notificationsStore.getState(), limit: 2 })
    store().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  })

  it('stays while the card is still failing at that pair, even through unrelated canvas edits', () => {
    const { nodeId } = showFailureNotice()
    const other = store().addNode({ kind: 'image', prompt: 'other' })
    store().moveNode(other.id, { x: 500, y: 500 })
    store().updateNodePrompt(nodeId, 'a longer prompt') // 同一次失败，提示词改了不算「前提变了」
    expect(items()).toHaveLength(1)
  })

  it('is withdrawn when the user switches the card to another vendor', () => {
    const { nodeId } = showFailureNotice()
    store().updateNode(nodeId, { meta: { ...nodeState(nodeId)?.meta, modelVendor: 'vendor-b' } })
    expect(items()).toHaveLength(0)
  })

  it('is withdrawn when the card runs again', () => {
    const { nodeId } = showFailureNotice()
    store().appendNodeRun(nodeId, { status: 'queued', attempt: A })
    expect(items()).toHaveLength(0)
  })

  it('is withdrawn when the card succeeds — the "it failed, switch vendors" line must not outlive the failure', () => {
    const { nodeId } = showFailureNotice()
    const run = store().appendNodeRun(nodeId, { status: 'queued', attempt: { vendorKey: 'vendor-b', modelKey: A.modelKey } })
    // 结果按交出它的那次运行的号收账（docs/plan/2026-11-07-shot-result-ownership.md D4 / D6）。
    store().addNodeResult(nodeId, { id: 'r1', type: 'image', url: 'nomi-local://asset/p/a.png', createdAt: 1 }, undefined, run.id)
    expect(nodeState(nodeId)?.status).toBe('success')
    expect(items()).toHaveLength(0)
  })

  it('is withdrawn when the card is deleted', () => {
    const { nodeId } = showFailureNotice()
    store().deleteNode(nodeId)
    expect(items()).toHaveLength(0)
  })

  it('a withdrawn notice is not resurrected for the same failure, but the next failure of the card shows again', () => {
    const { nodeId, failed } = showFailureNotice()
    store().updateNode(nodeId, { meta: { ...nodeState(nodeId)?.meta, modelVendor: 'vendor-b' } })
    expect(items()).toHaveLength(0)
    // 同一次失败被重新宣布（effect 重跑）——不再冒出来。
    useToastStore.getState().push({ id: nodeRecoveryToastId(nodeId), occurrence: failed.occurrence, reason: 'server', message: 'again', type: 'warning', ttl: false })
    expect(items()).toHaveLength(0)
    // 下一次失败（新的一次运行）是另一件事。
    store().updateNode(nodeId, { meta: { ...nodeState(nodeId)?.meta, modelVendor: A.vendorKey } })
    store().appendNodeRun(nodeId, { status: 'queued', attempt: A })
    store().setNodeStatus(nodeId, 'error', 'failed again')
    const next = failedAttemptOf(nodeState(nodeId))!
    expect(next.occurrence).not.toBe(failed.occurrence)
    useToastStore.getState().push({ id: nodeRecoveryToastId(nodeId), occurrence: next.occurrence, reason: 'server', message: 'failed again', type: 'warning', ttl: false })
    expect(items()).toHaveLength(1)
    expect(items()[0]['data-notification-count']).toBe(1)
  })

  it('the model-list half of the premise (React state) reaches the owner through alsoRecheckOn', () => {
    const node = store().addNode({ kind: 'image', prompt: 'x', meta: { modelVendor: A.vendorKey, modelKey: A.modelKey } })
    let missing = true
    const listeners = new Set<() => void>()
    useToastStore.getState().push({
      id: nodeRecoveryToastId(node.id), occurrence: 'disconnected', reason: 'provider-disconnected', message: 'vendor-a is unavailable', type: 'warning', ttl: false,
      validWhile: nodeNoticeValidity({
        nodeId: node.id,
        holds: (current) => disconnectionNoticeStillHolds(current, A, missing),
        alsoRecheckOn: (recheck) => { listeners.add(recheck); return () => { listeners.delete(recheck) } },
      }),
    })
    expect(items()).toHaveLength(1)
    missing = false // 供应商重新连上，下拉里又有这个模型
    for (const recheck of [...listeners]) recheck()
    expect(items()).toHaveLength(0)
    expect(listeners.size).toBe(0)
  })
})
