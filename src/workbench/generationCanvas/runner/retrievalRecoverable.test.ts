// 结果取回那一步没成时，节点必须落 `recoverable` 而不是 `error`——这条测的是**钱**，不是状态字段。
//
// 为什么它值一个独立文件：取回族的人话明写着「用『重新取回』免费取回，不用重新生成」，而那颗按钮
// **只在 `recoverable` 态出现**。文案和状态机住在两个模块里，谁都不认识谁：状态机这边随手改回
// `error`，文案照旧说得漂亮，用户照着做却只看得见付费重试那颗按钮——界面在骗人，而且骗的是钱。
// 所以断言写在「按钮存在的前提」这一层，不是写在文案上。
//
// 反向那条同样重要：拿不到 taskId 就没有可续查的东西，免费按钮按下去也只会报「找不到任务」。
// 那种情况下 `error` 才是诚实的——不许为了让状态好看而给出一颗按不动的按钮。
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { runGenerationNodesBatch } from './generationRunController'
import { useGenerationQueueStore } from './generationQueueStore'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { resetModelHealthMemory } from './modelHealthMemory'
import { tagNomiError } from '../../../../electron/shared/nomiErrorCodes'
import { recoverNodeResult } from './recoverTaskActions'
import { withProjectAction } from '../../project/projectCanvasReadSurface'
import { fetchWorkbenchTaskResultByVendor, mintSpendGrant } from '../../api/taskApi'
import { RecoverableTimeoutError } from './recoverableTimeout'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import type { ProjectBinding } from '../../../../electron/shared/projectBinding'

vi.mock('../../api/taskApi', () => ({
  canvasOpenRuns: vi.fn(async () => []),
  mintSpendGrant: vi.fn(async () => 'grant-test'),
  fetchWorkbenchTaskResultByVendor: vi.fn(),
  // 这里是令牌路交出去的旧记录（没有单镜 Run）：Run 那一侧回 null。
  pollCanvasShotRun: vi.fn(async () => null),
}))

/** 下载结果那一步确定性没成（对方答 403）：任务号在、钱已花，丢的只是取回。 */
function retrievalDownloadError(): Error {
  return new Error(tagNomiError('retrieval-download', '取回卡在「下载结果」这一步：HTTP 403'))
}

function addNode(): string {
  return useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: '镜头 1' }).id
}

let projectSession: ProjectSessionTestHarness
let projectTarget: ProjectBinding
beforeEach(async () => {
  projectSession = createProjectSessionTestHarness()
  projectTarget = await projectSession.open('project-test')
})
afterEach(() => projectSession.dispose())

describe('取回没成 = 已付费但没取回来', () => {
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
    useGenerationQueueStore.setState({ entries: [], batches: {} })
    __resetCanvasUndoJournalForTests()
    setCanvasEventSinkForTests(() => {})
    resetModelHealthMemory()
  })

  it('已拿到 taskId 时落 recoverable —— 用户看到的是免费续查，不是付费重试', async () => {
    const id = addNode()
    await runGenerationNodesBatch([id], { target: projectTarget,
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async (node) => {
        // 轮询已经报回任务号（钱在这一刻就花掉了），随后下载结果没成。
        useGenerationCanvasStore.getState().setNodeProgress(node.id, { phase: 'still-generating', taskId: 'task-paid-1' })
        throw retrievalDownloadError()
      },
    }).catch(() => undefined)

    const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)
    expect(node?.status).toBe('recoverable')
    expect(node?.runs?.[0]?.taskId).toBe('task-paid-1')
  })

  it('没有 taskId 时仍落 error —— 不给一颗按不动的免费按钮', async () => {
    const id = addNode()
    await runGenerationNodesBatch([id], { target: projectTarget,
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async () => {
        throw retrievalDownloadError()
      },
    }).catch(() => undefined)

    expect(useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)?.status).toBe('error')
  })

  // 阳性对照：把同一条断言喂给一个**普通**上游失败，它必须仍然是 error。少了这条，
  // 上面那条绿灯也可能只是因为「什么都落 recoverable」。
  it('阳性对照：普通上游失败照旧落 error（付费重试才是对的下一步）', async () => {
    const id = addNode()
    await runGenerationNodesBatch([id], { target: projectTarget,
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async (node) => {
        useGenerationCanvasStore.getState().setNodeProgress(node.id, { phase: 'still-generating', taskId: 'task-paid-2' })
        throw new Error('上游模型返回 500')
      },
    }).catch(() => undefined)

    expect(useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)?.status).toBe('error')
  })

  // 取回没成与「超时可找回」共用 recoverable 这一个态，但刹车语义**相反**：超时时上游是健康的，
  // 继续跑没有额外风险；取回确定性失败时后面每一条多半在同一处失败，而提交侧照旧扣费——让队列停下来
  // 才是省钱的那一边。这条把两者的分叉钉住，防止有人图省事把它并进超时那个分支。
  // 断言看刹车计数（`consecutiveFailures`）而不是 `paused`：计数是连续的，一个节点就量得出方向，
  // 不必凑够阈值把队列真的停住（那会让 worker 挂着等人拿主意，测试还得替用户点取消）。
  it('取回没成计入刹车，超时可找回不计——两者的省钱方向相反', async () => {
    const blockedId = addNode()
    await runGenerationNodesBatch([blockedId], { target: projectTarget,
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async (node) => {
        useGenerationCanvasStore.getState().setNodeProgress(node.id, { phase: 'still-generating', taskId: 'blocked-1' })
        throw retrievalDownloadError()
      },
    }).catch(() => undefined)
    expect(Object.values(useGenerationQueueStore.getState().batches)[0]?.consecutiveFailures).toBe(1)

    useGenerationQueueStore.setState({ entries: [], batches: {} })
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })

    const timeoutId = addNode()
    await runGenerationNodesBatch([timeoutId], { target: projectTarget,
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
describe('取回没成之后：免费重取片可达（零额度夹具）', () => {
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
    useGenerationQueueStore.setState({ entries: [], batches: {} })
    __resetCanvasUndoJournalForTests()
    setCanvasEventSinkForTests(() => {})
    resetModelHealthMemory()
    vi.mocked(fetchWorkbenchTaskResultByVendor).mockReset()
    vi.mocked(mintSpendGrant).mockClear()
  })

  it('取回没成 → recoverable → recoverNodeResult 走查询拿回成片，全程不铸付费令牌', async () => {
    const id = useGenerationCanvasStore.getState().addNode({
      kind: 'image',
      prompt: '镜头 1',
      meta: { modelVendor: 'apimart', modelKey: 'MiniMax-H3' },
    }).id
    await runGenerationNodesBatch([id], { target: projectTarget,
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async (node) => {
        useGenerationCanvasStore.getState().setNodeProgress(node.id, { phase: 'still-generating', taskId: 'task-paid-free-1' })
        throw retrievalDownloadError()
      },
    }).catch(() => undefined)
    expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)?.status).toBe('recoverable')

    // 用户点「重新取回」：走的是 query（同一个 taskId），不是重新下单。
    vi.mocked(fetchWorkbenchTaskResultByVendor).mockResolvedValue({
      result: {
        id: 'task-paid-free-1',
        status: 'succeeded',
        kind: 'text_to_image',
        assets: [{ url: 'https://cdn.example.com/shot-1.png', type: 'image' }],
      },
    } as never)
    await withProjectAction((project) => recoverNodeResult(id, project))

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
    await withProjectAction((project) => recoverNodeResult(id, project))
    expect(vi.mocked(fetchWorkbenchTaskResultByVendor)).not.toHaveBeenCalled()
    expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)?.status).toBe('error')
  })
})

// 老数据（2026-11-13 删掉按地址拒绝的那一层之前存下的节点）：升级后读到已删掉的码，各落该落的地方。
describe('老数据：已删掉的 outbound-blocked / outbound-blocked-submit', () => {
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
    useGenerationQueueStore.setState({ entries: [], batches: {} })
    __resetCanvasUndoJournalForTests()
    setCanvasEventSinkForTests(() => {})
    resetModelHealthMemory()
  })

  // 形状照旧版 networkOutboundMessage（tagNomiError + desktopStrings outbound.fakeIpBlocked / submitFakeIpBlocked）原样抄，修前 main facb9e5d7。
  const OLD_RETRIEVAL = 'NOMI_ERR::outbound-blocked:: 取片被安全策略拦下：api.apimart.ai 解析到 198.18.0.x（RFC 2544 段，本地代理 fake-ip 常用它做合成地址），Nomi 无法确认这是代理而不是内网，于是拒绝了下载。**任务没有丢**，上游多半已经生成好了——请到「模型设置 → 网络」确认本地代理已开启，再用「重新拉取」取回，不用重新生成。'
  const OLD_SUBMIT = 'NOMI_ERR::outbound-blocked-submit:: 这次生成**没有发出去**：api.apimart.ai 解析到 198.18.0.x（RFC 2544 段，本地代理 fake-ip 常用它做合成地址），Nomi 无法确认这是代理而不是内网，于是在请求发出前就拦下了。请到「模型接入 → 网络」确认本地代理已开启（那一行会写「检测到本地代理」），然后重新生成。'

  it('取回侧旧码 + 有 taskId → recoverable（重新取回现在能取到）', async () => {
    const id = addNode()
    await runGenerationNodesBatch([id], { target: projectTarget,
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async (node) => {
        useGenerationCanvasStore.getState().setNodeProgress(node.id, { phase: 'still-generating', taskId: 'task-old-1' })
        throw new Error(OLD_RETRIEVAL)
      },
    }).catch(() => undefined)
    expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)?.status).toBe('recoverable')
  })

  it('提交侧旧码即使节点上留着 taskId 也落 error —— 没花钱，重新生成即可', async () => {
    const id = addNode()
    await runGenerationNodesBatch([id], { target: projectTarget,
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async (node) => {
        useGenerationCanvasStore.getState().setNodeProgress(node.id, { phase: 'still-generating', taskId: 'stale-task' })
        throw new Error(OLD_SUBMIT)
      },
    }).catch(() => undefined)
    expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)?.status).toBe('error')
  })
})

// #1213：「结果取回」族：查询报错 / 上游说成了却读不出结果 / 下载没成，都是「任务已受理、
// 丢的只是取回」——同一个判据（带 retrieval-* 码）、同一个去处（可找回），绝不落红色失败、绝不重新提交。
describe('结果取回族（#1213）：带阶段码的取回失败一律可找回', () => {
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
    useGenerationQueueStore.setState({ entries: [], batches: {} })
    __resetCanvasUndoJournalForTests()
    setCanvasEventSinkForTests(() => {})
    resetModelHealthMemory()
    vi.mocked(fetchWorkbenchTaskResultByVendor).mockReset()
    vi.mocked(mintSpendGrant).mockClear()
  })

  it.each([
    ['retrieval-query', 'NOMI_ERR::retrieval-query:: 取回卡在「查询任务」这一步：HTTP 503 无可用渠道'],
    ['retrieval-parse', 'NOMI_ERR::retrieval-parse:: 取回卡在「读结果」这一步：上游说任务已完成，但响应里没找到结果地址。'],
    ['retrieval-download', 'NOMI_ERR::retrieval-download:: 取回卡在「下载结果」这一步：HTTP 403'],
  ])('%s → recoverable（带原话），不进红色失败', async (_code, message) => {
    const id = addNode()
    await runGenerationNodesBatch([id], { target: projectTarget,
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async (node) => {
        useGenerationCanvasStore.getState().setNodeProgress(node.id, { phase: 'still-generating', taskId: 'task-paid-retrieval' })
        throw new Error(message)
      },
    }).catch(() => undefined)
    const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)
    expect(node?.status).toBe('recoverable')
    expect(node?.error).toBe(message)
  })

  it('重新取回时上游说成了却仍没地址：留在可找回（带原话），不翻成红色失败', async () => {
    const id = useGenerationCanvasStore.getState().addNode({
      kind: 'video',
      prompt: '镜头 3',
      meta: { modelVendor: 'relay', modelKey: 'doubao-seedance-2-0-fast-260128' },
    }).id
    await runGenerationNodesBatch([id], { target: projectTarget,
      assetUploadConsent: 'not-needed',
      retry: { maxAttempts: 1 },
      executor: async (node) => {
        useGenerationCanvasStore.getState().setNodeProgress(node.id, { phase: 'still-generating', taskId: 'task-paid-parse' })
        throw new Error('NOMI_ERR::retrieval-query:: HTTP 503')
      },
    }).catch(() => undefined)
    expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)?.status).toBe('recoverable')
    vi.mocked(fetchWorkbenchTaskResultByVendor).mockResolvedValue({
      result: { id: 'task-paid-parse', status: 'succeeded', kind: 'text_to_video', assets: [] },
    } as never)
    await withProjectAction((project) => recoverNodeResult(id, project))
    const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)
    expect(node?.status).toBe('recoverable')
    expect(node?.error).toMatch(/NOMI_ERR::retrieval-parse::/)
    expect(vi.mocked(mintSpendGrant)).not.toHaveBeenCalled()
  })

  it('纯等待超时带 retrieval-timeout 阶段码（失败看得见：每次取回失败都说清卡在哪一步）', () => {
    const error = new RecoverableTimeoutError({ taskId: 'timeout-2', vendor: 'relay', taskKind: 'text_to_video', modelKey: 'demo' })
    expect(error.message).toMatch(/^NOMI_ERR::retrieval-timeout::[\s\S]*timeout-2/)
  })
})
