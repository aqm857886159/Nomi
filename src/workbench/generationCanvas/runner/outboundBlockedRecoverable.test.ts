// 出站被自家策略拦下时，节点必须落 `recoverable` 而不是 `error`——这条测的是**钱**，不是状态字段。
//
// 为什么它值一个独立文件：这次修复里，`electron/networkOutboundMessage.ts` 那几句人话明写着
// 「已付费的任务没有丢……用『重新拉取结果』免费取回，不用重新生成」，而那颗按钮**只在
// `recoverable` 态出现**。文案和状态机住在两个模块里，谁都不认识谁：状态机这边随手改回
// `error`，文案照旧说得漂亮，用户照着做却只看得见付费重试那颗按钮——界面在骗人，而且骗的是钱。
// 所以断言写在「按钮存在的前提」这一层，不是写在文案上。
//
// 反向那条同样重要：拿不到 taskId 就没有可续查的东西，免费按钮按下去也只会报「找不到任务」。
// 那种情况下 `error` 才是诚实的——不许为了让状态好看而给出一颗按不动的按钮。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runGenerationNodesBatch } from './generationRunController'
import { useGenerationQueueStore } from './generationQueueStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { resetModelHealthMemory } from './modelHealthMemory'
import { describeOutboundRefusal } from '../../../../electron/networkOutboundMessage'
import { RecoverableTimeoutError } from './recoverableTimeout'

vi.mock('../../api/taskApi', () => ({
  mintSpendGrant: vi.fn(async () => 'grant-test'),
}))

/** 真实那条：取片时 DNS 落进 RFC 2544 段、又没有 fake-ip 阳性证据 → 主进程拒绝下载。 */
function outboundBlockedError(): Error {
  return new Error(
    describeOutboundRefusal({
      reason: 'private-address',
      hostname: 'api.apimart.ai',
      observedAddress: '198.18.0.140',
      syntheticResolver: false,
    }),
  )
}

function addNode(): string {
  return useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: '镜头 1' }).id
}

describe('出站被拦 = 已付费但没取回来', () => {
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
    useGenerationQueueStore.setState({ entries: [], batches: {} })
    __resetCanvasUndoJournalForTests()
    setCanvasEventSinkForTests(() => {})
    resetModelHealthMemory()
  })

  it('已拿到 taskId 时落 recoverable —— 用户看到的是免费续查，不是付费重试', async () => {
    const id = addNode()
    await runGenerationNodesBatch([id], {
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async (node) => {
        // 轮询已经报回任务号（钱在这一刻就花掉了），随后取片才被自家策略拒下。
        useGenerationCanvasStore.getState().setNodeProgress(node.id, { phase: 'still-generating', taskId: 'task-paid-1' })
        throw outboundBlockedError()
      },
    }).catch(() => undefined)

    const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)
    expect(node?.status).toBe('recoverable')
    expect(node?.runs?.[0]?.taskId).toBe('task-paid-1')
  })

  it('没有 taskId 时仍落 error —— 不给一颗按不动的免费按钮', async () => {
    const id = addNode()
    await runGenerationNodesBatch([id], {
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async () => {
        throw outboundBlockedError()
      },
    }).catch(() => undefined)

    expect(useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)?.status).toBe('error')
  })

  // 阳性对照：把同一条断言喂给一个**普通**上游失败，它必须仍然是 error。少了这条，
  // 上面那条绿灯也可能只是因为「什么都落 recoverable」。
  it('阳性对照：普通上游失败照旧落 error（付费重试才是对的下一步）', async () => {
    const id = addNode()
    await runGenerationNodesBatch([id], {
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async (node) => {
        useGenerationCanvasStore.getState().setNodeProgress(node.id, { phase: 'still-generating', taskId: 'task-paid-2' })
        throw new Error('上游模型返回 500')
      },
    }).catch(() => undefined)

    expect(useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)?.status).toBe('error')
  })

  // 出站被拦与「超时可找回」共用 recoverable 这一个态，但刹车语义**相反**：超时时上游是健康的，
  // 继续跑没有额外风险；出站被拦时后面每一条都会在同一处失败，而提交侧照旧扣费——让队列停下来
  // 才是省钱的那一边。这条把两者的分叉钉住，防止有人图省事把它并进超时那个分支。
  // 断言看刹车计数（`consecutiveFailures`）而不是 `paused`：计数是连续的，一个节点就量得出方向，
  // 不必凑够阈值把队列真的停住（那会让 worker 挂着等人拿主意，测试还得替用户点取消）。
  it('出站被拦计入刹车，超时可找回不计——两者的省钱方向相反', async () => {
    const blockedId = addNode()
    await runGenerationNodesBatch([blockedId], {
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async (node) => {
        useGenerationCanvasStore.getState().setNodeProgress(node.id, { phase: 'still-generating', taskId: 'blocked-1' })
        throw outboundBlockedError()
      },
    }).catch(() => undefined)
    expect(Object.values(useGenerationQueueStore.getState().batches)[0]?.consecutiveFailures).toBe(1)

    useGenerationQueueStore.setState({ entries: [], batches: {} })
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })

    const timeoutId = addNode()
    await runGenerationNodesBatch([timeoutId], {
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async () => {
        throw new RecoverableTimeoutError({
          taskId: 'timeout-1',
          vendor: 'apimart',
          taskKind: 'text_to_image',
          modelKey: 'demo',
        })
      },
    }).catch(() => undefined)
    expect(Object.values(useGenerationQueueStore.getState().batches)[0]?.consecutiveFailures).toBe(0)
  })
})
