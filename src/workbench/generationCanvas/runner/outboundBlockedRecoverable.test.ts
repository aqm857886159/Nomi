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
import { authorizeOutboundDestination } from '../../../../electron/networkOutboundPolicy'
import { classifyGenerationError } from '../../observability/classifyError'
import { recoverNodeResult } from './recoverTaskActions'
import { fetchWorkbenchTaskResultByVendor, mintSpendGrant } from '../../api/taskApi'
import { VendorRequestError, encodeVendorErrorMessage } from '../../../../electron/vendor/vendorHttp'
import { RecoverableTimeoutError } from './recoverableTimeout'

vi.mock('../../api/taskApi', () => ({
  mintSpendGrant: vi.fn(async () => 'grant-test'),
  fetchWorkbenchTaskResultByVendor: vi.fn(),
}))

/**
 * 真实那条：取片时 DNS 落进 RFC 2544 段、又没有 fake-ip 阳性证据 → 主进程拒绝下载。
 *
 * 判据不是手写的：地址、环境事实喂给**真分类器**（`authorizeOutboundDestination`），
 * 拿它吐出来的拒绝去驱动整条链。否则这份夹具只能证明「我能拼出一条长得像的错误」，
 * 而真正会悄悄坏掉的是分类器与状态机之间那根线。零额度：DNS 与环境探针全部注入。
 */
async function outboundBlockedError(): Promise<Error> {
  const authorization = await authorizeOutboundDestination({
    url: new URL('https://api.apimart.ai/result.mp4'),
    route: 'direct',
    readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: '' }),
    resolve: async () => [{ address: '198.18.0.140', family: 4 as const }],
  })
  if (authorization.allowed) throw new Error('夹具失效：真分类器居然放行了无证据的 198.18/15')
  return new Error(
    describeOutboundRefusal({
      reason: authorization.reason,
      hostname: authorization.hostname,
      observedAddress: authorization.observedAddress,
      syntheticResolver: authorization.syntheticResolver,
      stage: 'retrieval',
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
        throw await outboundBlockedError()
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
        throw await outboundBlockedError()
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
        throw await outboundBlockedError()
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

// 上面那组止步于「节点落进了 recoverable」。这一组把最后一段走完：**那颗免费按钮真的按得下去，
// 而且真的免费**。少了它，状态字段可以永远是绿的，而用户点下去只拿到「找不到任务」——
// 界面照旧在骗人，只是骗得更晚一点。
describe('被拦之后：免费重取片可达（零额度夹具）', () => {
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
    useGenerationQueueStore.setState({ entries: [], batches: {} })
    __resetCanvasUndoJournalForTests()
    setCanvasEventSinkForTests(() => {})
    resetModelHealthMemory()
    vi.mocked(fetchWorkbenchTaskResultByVendor).mockReset()
    vi.mocked(mintSpendGrant).mockClear()
  })

  it('取回侧被拦 → recoverable → recoverNodeResult 走查询拿回成片，全程不铸付费令牌', async () => {
    const id = useGenerationCanvasStore.getState().addNode({
      kind: 'image',
      prompt: '镜头 1',
      meta: { modelVendor: 'apimart', modelKey: 'MiniMax-H3' },
    }).id
    await runGenerationNodesBatch([id], {
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async (node) => {
        useGenerationCanvasStore.getState().setNodeProgress(node.id, { phase: 'still-generating', taskId: 'task-paid-free-1' })
        throw await outboundBlockedError()
      },
    }).catch(() => undefined)
    expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)?.status).toBe('recoverable')

    // 用户修好代理后点「重新拉取结果」：走的是 query（同一个 taskId），不是重新下单。
    vi.mocked(fetchWorkbenchTaskResultByVendor).mockResolvedValue({
      result: {
        id: 'task-paid-free-1',
        status: 'succeeded',
        kind: 'text_to_image',
        assets: [{ url: 'https://cdn.example.com/shot-1.png', type: 'image' }],
      },
    } as never)
    await recoverNodeResult(id)

    const query = vi.mocked(fetchWorkbenchTaskResultByVendor).mock.calls[0]?.[0]
    expect(query).toMatchObject({ taskId: 'task-paid-free-1', vendor: 'apimart' })
    const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)
    expect(node?.status).toBe('success')
    expect(node?.result?.url).toBe('https://cdn.example.com/shot-1.png')
    // 「免费」这两个字的机器判据：找回全程一次付费令牌都没有铸过。
    expect(vi.mocked(mintSpendGrant)).not.toHaveBeenCalled()
  })

  it('【阳性对照】节点上没有 taskId 时，同一颗按钮报「找不到任务」而不是假装拉到了', async () => {
    const id = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: '镜头 2' }).id
    await recoverNodeResult(id)
    expect(vi.mocked(fetchWorkbenchTaskResultByVendor)).not.toHaveBeenCalled()
    expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)?.status).toBe('error')
  })
})

// 提交侧那半边：被拦时钱**根本没花**，所以正确的下一步与取回侧相反。
// 这一组盯的是两条链没有被接错线——接错的代价是一句方向完全相反的假话。
describe('提交侧被拦 = 没扣费（与取回侧刻意分家）', () => {
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
    useGenerationQueueStore.setState({ entries: [], batches: {} })
    __resetCanvasUndoJournalForTests()
    setCanvasEventSinkForTests(() => {})
    resetModelHealthMemory()
  })

  /** 同一个真分类器，换成提交侧的阶段——判据一致，人话与码不同。 */
  async function submitBlockedError(): Promise<Error> {
    const authorization = await authorizeOutboundDestination({
      url: new URL('https://api.apimart.ai/v1/tasks'),
      route: 'direct',
      readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: '' }),
      resolve: async () => [{ address: '198.18.0.140', family: 4 as const }],
    })
    if (authorization.allowed) throw new Error('夹具失效：真分类器居然放行了无证据的 198.18/15')
    return new Error(
      describeOutboundRefusal({
        reason: authorization.reason,
        hostname: authorization.hostname,
        observedAddress: authorization.observedAddress,
        syntheticResolver: authorization.syntheticResolver,
        stage: 'submit',
      }),
    )
  }

  it('提交被拦即使已有 taskId 也落 error —— 不给一颗「免费重取」的假按钮', async () => {
    const id = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: '镜头 3' }).id
    await runGenerationNodesBatch([id], {
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async (node) => {
        // 故意把上一轮遗留的 taskId 留在节点上：只有码分家才能挡住这一格，光看 taskId 挡不住。
        useGenerationCanvasStore.getState().setNodeProgress(node.id, { phase: 'still-generating', taskId: 'stale-task' })
        throw await submitBlockedError()
      },
    }).catch(() => undefined)
    expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)?.status).toBe('error')
  })

  it('用户读到的是「没扣费、重新生成」，而不是取回侧那句「钱已经付过」', async () => {
    const report = classifyGenerationError((await submitBlockedError()).message)
    expect(report.kind).toBe('outbound-blocked-submit')
    // 主动作把用户送去「模型接入 → 网络」那一行——那是这堵墙唯一的开关所在。
    expect(report.primary).toBe('open-model-access')
    expect(report.hint).toMatch(/没有扣费|nothing was charged/i)
    // 阳性对照：取回侧那条必须仍然是另一个 kind、另一套说法。
    const retrieval = classifyGenerationError((await outboundBlockedError()).message)
    expect(retrieval.kind).toBe('outbound-blocked')
    expect(retrieval.hint).not.toBe(report.hint)
  })

  // 上一条喂的是**裸**拒绝串，而生产里到达渲染层的从来不是它：vendorHttp 先包一层
  // `Provider request refused by outbound policy at …`，taskIpcGuard 再前缀
  // `NOMI_VENDOR_ERR_B64::<base64>::`，Electron 的 invoke 还会外套一层 remote method 壳。
  // 机器码活不活得过这三层包装，是整条链唯一真正脆的地方——所以按生产形状再断一次。
  it('穿过 vendorHttp 包装 + IPC base64 标记后，码仍然被认出来', async () => {
    const refusal = (await submitBlockedError()).message
    const wrapped = encodeVendorErrorMessage(
      new VendorRequestError(`Provider request refused by outbound policy at apimart POST https://api.apimart.ai/v1/tasks: ${refusal}`, {
        vendorKey: 'apimart',
        method: 'POST',
        url: 'https://api.apimart.ai/v1/tasks',
        upstreamMsg: refusal,
        category: 'network',
        retryable: false,
      }),
    )
    const report = classifyGenerationError(`Error invoking remote method 'nomi:tasks:run': Error: ${wrapped}`)
    expect(report.kind).toBe('outbound-blocked-submit')
    // structured.category 是 network（传输层这么记账没错），但它**不能**赢过机器码——
    // 赢了用户就会拿到「稍等重试」，而重试是确定性再撞同一堵墙。
    expect(report.primary).toBe('open-model-access')
    // 也不许把我们自己的拒绝塞进「服务商说：」那个框——那家根本没被请求到。
    expect(report.providerMessage || '').toBe('')
  })
})
