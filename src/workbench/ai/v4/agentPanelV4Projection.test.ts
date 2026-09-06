// 宿主快照 → 8 个积木的投影，逐条断言。
//
// 这份测试是接线的**主要证据**：57 张设计实验室基线证明「同样的 view model 长同样的样子」，
// 这里证明「同样的宿主真相产出同样的 view model」。两头接上，接线才算被证明过一次。
//
// 每条 `it` 只钉一件事，且都是这一层容易悄悄坏掉的那一件：
//   · 七态 join 的判定顺序（冷重启后登记表是空的，只剩宿主快照）
//   · 缺字段时**不渲染**而不是 `?? 0`（现役那句「还能聊 ~40 轮」就是糊出来的反面教材）
//   · 用户气泡三种 chip 的三个来源
//   · 队列行的位置身份（删第 2 条不能删错人）
import { describe, expect, it } from 'vitest'
import type {
  ProjectAgentItem,
  ProjectAgentQueueItem,
  ProjectAgentStatus,
  ProjectAgentTurn,
} from '../../../../electron/shared/projectAgentContracts'
import {
  assistantStatusOf,
  chipsForTurn,
  projectV4Context,
  projectV4Flow,
  projectV4Queue,
  toolStatusOf,
  type V4FlowInput,
  type V4PendingTool,
} from './agentPanelV4Projection'

/** 翻译在这一层只是「把 key 原样带出来」，断言看的是**结构**不是文案。 */
const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}(${Object.values(options).join(',')})` : key

const CLOCK = '2026-09-06T09:00:00.000Z'

function baseItem(overrides: Partial<ProjectAgentItem> & { itemId: string; kind: ProjectAgentItem['kind'] }) {
  return {
    threadId: 'thread-1',
    turnId: 'turn-1',
    status: 'done' as ProjectAgentStatus,
    retryable: false,
    deviated: false,
    createdAt: CLOCK,
    updatedAt: CLOCK,
    ...overrides,
  } as ProjectAgentItem
}

const userItem = (text: string, turnId = 'turn-1'): ProjectAgentItem =>
  baseItem({ itemId: `user-${turnId}`, kind: 'user', turnId, text } as never)

const assistantItem = (text: string, status: ProjectAgentStatus = 'done'): ProjectAgentItem =>
  baseItem({ itemId: 'assistant-1', kind: 'assistant', text, textRevision: 1, status } as never)

const toolItem = (capabilityId: string, status: ProjectAgentStatus, toolCallId = 'call-1'): ProjectAgentItem =>
  baseItem({
    itemId: `tool-${toolCallId}`,
    kind: 'tool',
    toolCallId,
    invocationId: `inv-${toolCallId}`,
    capability: { id: capabilityId, version: 1 },
    status,
  } as never)

function turn(overrides: Partial<ProjectAgentTurn> = {}): ProjectAgentTurn {
  return {
    turnId: 'turn-1',
    threadId: 'thread-1',
    executionToken: 'token-1',
    model: { id: 'vendor:model', version: 1 },
    skillVersions: [],
    capabilityVersions: [],
    contextRef: {
      binding: { project: { projectId: 'p', immutableProjectUuid: 'u', projectGeneration: 1 }, threadId: 'thread-1', sessionKey: 'nomi:project-agent:u:g1' },
      contextRevision: 1,
      recordId: 'record-1',
    },
    status: 'done',
    retryable: false,
    deviated: false,
    createdAt: CLOCK,
    updatedAt: CLOCK,
    ...overrides,
  } as ProjectAgentTurn
}

function queueItem(overrides: Partial<ProjectAgentQueueItem> = {}): ProjectAgentQueueItem {
  return {
    queueItemId: 'q-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    binding: { projectId: 'p', immutableProjectUuid: 'u', projectGeneration: 1 },
    target: { kind: 'canvas', nodeIds: [] },
    preconditions: {},
    contextRef: turn().contextRef,
    model: { id: 'vendor:model', version: 1 },
    skillVersions: [],
    capabilityVersions: [],
    policyRevision: 1,
    attachmentRefs: [],
    originSurface: { surfaceId: 's', kind: 'canvas' },
    enqueuedAt: CLOCK,
    status: 'queued',
    retryable: false,
    deviated: false,
    updatedAt: CLOCK,
    ...overrides,
  } as ProjectAgentQueueItem
}

function flowInput(overrides: Partial<V4FlowInput> = {}): V4FlowInput {
  return {
    items: [],
    turns: [turn()],
    queue: [],
    pendingTools: [],
    toolArgs: new Map(),
    toolProjections: new Map(),
    taskFacts: new Map(),
    clipLabels: new Map(),
    skillNames: new Map(),
    t,
    ...overrides,
  }
}

describe('③ 一行收据 · 七态 join', () => {
  it('宿主快照永远赢：终态到了就不看登记表', () => {
    // 这是最重要的一条。冷重启后登记表是空的，只剩宿主快照；如果判定顺序反过来，
    // 重开面板会把一条早就完成的调用画成「待确认」，用户对着一个点不动的槽等下去。
    expect(toolStatusOf('done', 'pending')).toBe('output-available')
    expect(toolStatusOf('declined', 'pending')).toBe('output-denied')
    expect(toolStatusOf('failed', 'approved')).toBe('output-error')
  })

  it('拒绝有自己的终态，不并进失败', () => {
    // 宿主侧同 commit 改的那一条（`toolItem` 里 `denied → declined`）的渲染面。
    expect(toolStatusOf('declined', undefined)).toBe('output-denied')
    expect(toolStatusOf('failed', undefined)).toBe('output-error')
    expect(toolStatusOf('declined', undefined)).not.toBe(toolStatusOf('failed', undefined))
  })

  it('宿主还没说话时才看登记表', () => {
    expect(toolStatusOf(undefined, 'pending')).toBe('approval-requested')
    expect(toolStatusOf(undefined, 'approved')).toBe('approval-responded')
    // 拒绝有自己的行尾字。折进 `approval-responded`（印出来是「已确认」）等于在用户
    // 按下「不要」的那一刻把他的拒绝写成同意——真机上撞到过：宿主终态还没回来，
    // 那一行就已经写着「已确认」，而且模型立刻又提了一次，这行「已确认」会一直挂着。
    expect(toolStatusOf(undefined, 'denied')).toBe('output-denied')
    expect(toolStatusOf(undefined, undefined)).toBe('input-available')
  })

  it('input-streaming 永不产出——拿不到的状态不渲染', () => {
    const statuses: (ProjectAgentStatus | undefined)[] = [undefined, 'drafting', 'running', 'queued', 'done', 'failed', 'declined', 'stopped']
    const pendings: (V4PendingTool['state'] | undefined)[] = [undefined, 'pending', 'approved', 'denied']
    for (const host of statuses) {
      for (const pending of pendings) {
        expect(toolStatusOf(host, pending)).not.toBe('input-streaming')
      }
    }
  })

  it('被打断的调用不写「已拒绝」——那是用户没做过的决定', () => {
    const flow = projectV4Flow(flowInput({ items: [toolItem('timeline.read', 'stopped')] }))
    const receipt = flow.find((item) => item.kind === 'tool')
    expect(receipt?.kind).toBe('tool')
    if (receipt?.kind !== 'tool') return
    expect(receipt.receipt.status).toBe('output-error')
    expect(receipt.receipt.trailing).toBe('agentPanelV4.toolStopped')
  })

  it('只有还撤得回来的那一条带「撤销」——别给撤不了的行挂一个按不动的钮', () => {
    const flow = projectV4Flow(flowInput({
      items: [toolItem('document.write', 'done', 'call-1'), toolItem('canvas.write', 'done', 'call-2')],
      undoableToolKey: 'turn-1:call-2',
    }))
    const undoable = flow.flatMap((item) => (item.kind === 'tool' ? [Boolean(item.receipt.undoable)] : []))
    expect(undoable).toEqual([false, true])
  })

  it('没有撤销记录时一条都不带', () => {
    const flow = projectV4Flow(flowInput({ items: [toolItem('document.write', 'done')] }))
    const receipt = flow[0]
    if (receipt.kind !== 'tool') throw new Error('收据没渲出来')
    expect(receipt.receipt.undoable).toBeUndefined()
  })

  it('icon 家族按契约 id 取，不按工具别名', () => {
    const flow = projectV4Flow(flowInput({ items: [toolItem('timeline.read', 'done'), toolItem('canvas.delete', 'done', 'call-2')] }))
    const families = flow.flatMap((item) => (item.kind === 'tool' ? [item.receipt.action] : []))
    expect(families).toEqual(['timeline', 'canvas'])
  })
})

describe('③ 一行收据 · 展开体读的是这一次调用，不是工具描述', () => {
  // 2026-09-06 打包版实测：展开「修改文稿」，输入栏和输出栏都写「将内容写入当前文稿」——
  // 那是 `readableToolSummary` / `readableToolPreview` 的同一句兜底**描述**。
  // 拍板基线 v4-tool-expanded 要的是：输入 = 真实入参 JSON，输出 = 结果摘要。
  it('输入是真实入参 JSON，和工具描述不是同一个东西', () => {
    const args = { operation: 'document_edit', content: '第一场：黄昏的天台' }
    const flow = projectV4Flow(flowInput({
      items: [toolItem('document.write', 'done')],
      pendingTools: [],
      toolArgs: new Map([['turn-1:call-1', args]]),
    }))
    const receipt = flow[0]!.kind === 'tool' ? flow[0]!.receipt : undefined
    expect(receipt?.input).toContain('"content"')
    expect(receipt?.input).toContain('第一场：黄昏的天台')
    // 阳性对照：这一栏**不能**等于摘要那句描述，否则等于什么都没说。
    expect(receipt?.input).not.toBe(receipt?.summary)
  })

  it('输出是宿主回执里的结果，不是入参重算出来的描述', () => {
    const flow = projectV4Flow(flowInput({
      items: [toolItem('document.write', 'done')],
      toolProjections: new Map([['turn-1:call-1', {
        effect: 'agentResident.toolDocumentWriteSummary',
        target: 'agentResident.targetDocument',
        technicalDetails: 'agentResident.toolDocumentWriteSummary',
        input: '{ "content": "第一场" }',
        output: 'document revision 12 · +148 字',
      }]]),
    }))
    const receipt = flow[0]!.kind === 'tool' ? flow[0]!.receipt : undefined
    expect(receipt?.output).toBe('document revision 12 · +148 字')
    expect(receipt?.input).toBe('{ "content": "第一场" }')
    expect(receipt?.input).not.toBe(receipt?.output)
  })

  it('单次失败也带原因，而且摘要不再印「打算做什么」', () => {
    const flow = projectV4Flow(flowInput({
      items: [toolItem('canvas.write', 'failed')],
      toolProjections: new Map([['turn-1:call-1', {
        effect: 'agentResident.toolCanvasWriteSummary',
        target: 'agentResident.targetCanvas',
        technicalDetails: '',
        input: '{ "nodes": "[...]" }',
        output: 'nodes：必须是数组（收到 字符串）\n第二行是同一件事的旁支',
      }]]),
    }))
    const receipt = flow[0]!.kind === 'tool' ? flow[0]!.receipt : undefined
    expect(receipt?.status).toBe('output-error')
    expect(receipt?.summary).toBe('nodes：必须是数组（收到 字符串）')
    expect(receipt?.summary).not.toContain('toolCanvasWriteSummary')
  })

  it('凭证不进展开体：按键名抹掉，不看值长什么样', () => {
    const flow = projectV4Flow(flowInput({
      items: [toolItem('generation.run', 'done')],
      toolArgs: new Map([['turn-1:call-1', { apiKey: 'nomi-live-1234567890', prompt: '天台' }]]),
    }))
    const receipt = flow[0]!.kind === 'tool' ? flow[0]!.receipt : undefined
    expect(receipt?.input).toContain('[redacted]')
    expect(receipt?.input).not.toContain('nomi-live-1234567890')
  })
})

describe('② 助手文本三态', () => {
  it('停止与拒绝都是「已中断」，失败不在这里', () => {
    expect(assistantStatusOf('done')).toBe('complete')
    expect(assistantStatusOf('stopped')).toBe('interrupted')
    expect(assistantStatusOf('declined')).toBe('interrupted')
    expect(assistantStatusOf('running')).toBe('streaming')
  })

  it('空的助手条目不渲染——空气泡是跳动的空白，不是内容', () => {
    const flow = projectV4Flow(flowInput({ items: [assistantItem('   ', 'running')] }))
    expect(flow).toHaveLength(0)
  })
})

describe('① 用户气泡 · chip 的三个来源', () => {
  it('附件来自 attachmentRefs、技能来自 turn.skillVersions、片段来自 target', () => {
    const chips = chipsForTurn(
      turn({ skillVersions: [{ id: 'brand.promo', version: 1 }] }),
      queueItem({
        target: { kind: 'timeline', clipIds: ['clip-a'] },
        attachmentRefs: [{
          assetId: 'a1',
          contentHash: 'h1',
          display: { url: 'nomi-local://x', fileName: '参考.png', contentType: 'image/png', sizeBytes: 1, kind: 'image' },
        }],
      }),
      new Map([['clip-a', '推门近景']]),
      new Map([['brand.promo', '产品短片']]),
      t,
    )
    expect(chips).toEqual([
      { kind: 'file', label: '参考.png' },
      { kind: 'skill', label: '产品短片' },
      { kind: 'clip', label: '推门近景' },
    ])
  })

  it('解不出名字的片段只显示编号，不编一个已经不存在的名字', () => {
    const chips = chipsForTurn(turn(), queueItem({ target: { kind: 'timeline', clipIds: ['clip-deleted-123456'] } }), new Map(), new Map(), t)
    expect(chips[0]).toEqual({ kind: 'clip', label: 'agentPanelV4.clipFallback(123456)' })
  })

  it('技能名字查不到就不出 chip——不把内部 key 当人话印出来', () => {
    const chips = chipsForTurn(turn({ skillVersions: [{ id: 'workbench.internal.thing', version: 1 }] }), queueItem(), new Map(), new Map(), t)
    expect(chips).toHaveLength(0)
  })
})

describe('④ 任务卡 · join 不到就不编', () => {
  const taskItem = baseItem({
    itemId: 'task-1',
    kind: 'task',
    task: { kind: 'production-run', runId: 'run-1' },
  } as never)

  it('拿不到 ProductionRun 事实时只剩标题，不给一个假的进度或金额', () => {
    const flow = projectV4Flow(flowInput({ items: [taskItem] }))
    const card = flow.find((item) => item.kind === 'task')
    if (card?.kind !== 'task') throw new Error('任务卡没渲出来')
    expect(card.task.progress).toBeUndefined()
    expect(card.task.cost).toBeUndefined()
    expect(card.task.footnoteTrailing).toBeUndefined()
    expect(card.task.footnote).toBe('agentPanelV4.taskUnknown')
  })

  it('拿得到就把金额与进度都带上', () => {
    const flow = projectV4Flow(flowInput({
      items: [taskItem],
      taskFacts: new Map([['run-1', { status: 'running' as const, progress: 50, spent: 'USD 0.24', estimated: 'USD 0.48' }]]),
    }))
    const card = flow.find((item) => item.kind === 'task')
    if (card?.kind !== 'task') throw new Error('任务卡没渲出来')
    expect(card.task).toMatchObject({ status: 'running', progress: 50, cost: 'USD 0.48', footnoteTrailing: 'USD 0.24' })
  })

  it('同一个 run 的 artifact 折进那张卡的候选，不另开一条', () => {
    const artifact = baseItem({
      itemId: 'artifact-1',
      kind: 'artifact',
      artifact: { runId: 'run-1', artifactId: 'art-1', version: 1, contentHash: 'h' },
    } as never)
    const flow = projectV4Flow(flowInput({
      items: [taskItem, artifact],
      taskFacts: new Map([['run-1', { status: 'complete' as const }]]),
    }))
    expect(flow).toHaveLength(1)
    const card = flow[0]
    if (card.kind !== 'task') throw new Error('任务卡没渲出来')
    expect(card.task.candidates).toEqual([{ tag: '1' }])
  })
})

describe('⑥ 队列行', () => {
  const labels = { jumpAhead: '插队', remove: '删', interrupt: '立即中断', untitled: '未命名任务' }

  it('标题 join 同 turnId 的 user item；join 不到用「未命名」，不印 turnId', () => {
    const rows = projectV4Queue({
      queue: [queueItem({ turnId: 'turn-1' }), queueItem({ queueItemId: 'q-2', turnId: 'turn-2' })],
      items: [userItem('把结尾收紧', 'turn-1')],
      labels,
    })
    expect(rows.map((row) => row.title)).toEqual(['把结尾收紧', '未命名任务'])
  })

  it('行序即身份：两条一模一样的消息各占一行', () => {
    const rows = projectV4Queue({
      queue: [queueItem({ turnId: 'turn-1' }), queueItem({ queueItemId: 'q-2', turnId: 'turn-2' })],
      items: [userItem('再来一张', 'turn-1'), userItem('再来一张', 'turn-2')],
      labels,
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].title).toBe(rows[1].title)
  })

  it('只有一条正在跑时不渲染队列——那句话的气泡就在上面，别说两遍', () => {
    const rows = projectV4Queue({
      queue: [queueItem({ status: 'running' })],
      items: [userItem('再想想整体节奏', 'turn-1')],
      labels,
    })
    expect(rows).toHaveLength(0)
  })

  it('运行中的那条给「立即中断」，排队的给插队/删', () => {
    const rows = projectV4Queue({
      queue: [queueItem({ status: 'running' }), queueItem({ queueItemId: 'q-2', turnId: 'turn-2', status: 'queued' })],
      items: [],
      labels,
    })
    expect(rows[0]).toMatchObject({ status: 'running', destructiveAction: '立即中断' })
    expect(rows[1]).toMatchObject({ status: 'queued', actions: ['插队', '删'] })
  })
})

describe('⑧ Context 环 · 缺字段就不渲染', () => {
  const formatCost = (amount: number): string => `$${amount.toFixed(2)}`

  it('一个回合都没结算时四个分项全缺——不给 0', () => {
    const usage = projectV4Context({ turns: [turn()], formatCost })
    expect(usage.input).toBeUndefined()
    expect(usage.output).toBeUndefined()
    expect(usage.cache).toBeUndefined()
    expect(usage.used).toBeUndefined()
  })

  it('模型目录没写 contextWindow 时没有 max——环画灰、不给百分比', () => {
    const usage = projectV4Context({
      turns: [turn({ usage: { promptTokens: 1000, completionTokens: 100, cachedPromptTokens: 0, totalTokens: 1100 } })],
      formatCost,
    })
    expect(usage.used).toBe(1000)
    expect(usage.max).toBeUndefined()
  })

  it('供应商没报推理 token 时那一行整行不出现', () => {
    const usage = projectV4Context({
      turns: [turn({ usage: { promptTokens: 1000, completionTokens: 100, cachedPromptTokens: 0, totalTokens: 1100 } })],
      contextWindow: 200_000,
      formatCost,
    })
    expect(usage.reasoning).toBeUndefined()
    expect(usage.cost).toBeUndefined()
    expect(usage.max).toBe(200_000)
  })

  it('报了就逐回合累加；`used` 取末次回合的 prompt，不是累加', () => {
    // `used` 累加是最容易写错的一处：聊得越久环越满，最后画出一个 300% 的环，
    // 而真相是每一回合的上下文都被重新组装过。
    const usage = projectV4Context({
      turns: [
        turn({ turnId: 'a', usage: { promptTokens: 1000, completionTokens: 10, cachedPromptTokens: 5, totalTokens: 1010, reasoningTokens: 200, costUsd: 0.01 } }),
        turn({ turnId: 'b', usage: { promptTokens: 3000, completionTokens: 20, cachedPromptTokens: 5, totalTokens: 3020, reasoningTokens: 300, costUsd: 0.02 } }),
      ],
      contextWindow: 200_000,
      formatCost,
    })
    expect(usage.used).toBe(3000)
    expect(usage.input).toBe('4K')
    expect(usage.reasoning).toBe('0.5K')
    expect(usage.cost).toBe('$0.03')
  })
})

describe('活的工具调用接在流末尾', () => {
  it('宿主已经有这条 tool item 时不重复渲染', () => {
    const pending: V4PendingTool = { turnId: 'turn-1', toolCallId: 'call-1', toolName: 'timeline.read', args: {}, state: 'pending' }
    const flow = projectV4Flow(flowInput({ items: [toolItem('timeline.read', 'done', 'call-1')], pendingTools: [pending] }))
    expect(flow.filter((item) => item.kind === 'tool')).toHaveLength(1)
  })

  it('宿主还没有它时补一条，状态取登记表', () => {
    const pending: V4PendingTool = { turnId: 'turn-1', toolCallId: 'call-9', toolName: 'timeline.read', args: {}, state: 'pending' }
    const flow = projectV4Flow(flowInput({ pendingTools: [pending] }))
    const receipt = flow[0]
    if (receipt?.kind !== 'tool') throw new Error('活收据没渲出来')
    expect(receipt.receipt.status).toBe('approval-requested')
  })
})

describe('对话流的时间顺序', () => {
  // 2026-09-06：实验室 6 张 v4 接线格把用户气泡渲在了它引发的助手文本**下面**。
  // 根因不在夹具——夹具的时间戳是冻结字面量（基线不能随 `new Date()` 漂），于是一个回合的
  // 记录全部同毫秒，投影层「同毫秒按 itemId 排」那一键 100% 生效，而 itemId 和因果毫无关系。
  // 真机上时间戳互不相同所以看不见，但宿主本来就是一次 reduce 批量写入的：只要落在同一毫秒，
  // 真机也会翻。所以这两条钉的是**因果**，不是「今天碰巧的顺序」。
  it('同毫秒时保持宿主给的顺序：用户回合永远在它引发的助手回合之前', () => {
    // itemId 按字典序排是 assistant-1 → tool-call-1 → user-turn-1，正好把因果倒过来。
    const items = [userItem('把这段改短'), toolItem('timeline.read', 'done'), assistantItem('好，我先读一下时间轴')]
    const flow = projectV4Flow(flowInput({ items }))
    expect(flow.map((entry) => entry.kind)).toEqual(['user', 'tool', 'assistant'])
  })

  it('时间戳不同时仍按时间戳排，宿主数组的顺序不能盖过它', () => {
    const later = { createdAt: '2026-09-06T09:00:05.000Z', updatedAt: '2026-09-06T09:00:05.000Z' }
    // 宿主数组把晚发生的那条放在前面（乱序快照），时间戳必须赢。
    const items = [
      { ...assistantItem('这是后说的'), ...later } as ProjectAgentItem,
      userItem('这是先说的'),
    ]
    const flow = projectV4Flow(flowInput({ items }))
    expect(flow.map((entry) => entry.kind)).toEqual(['user', 'assistant'])
  })
})

describe('失败卡上写的是给人看的话', () => {
  // `NOMI_VENDOR_ERR_B64::…::` 是厂商错误穿 IPC 的传输标记，编码那一端的契约就是
  // 「展示串一字未变，标记段在渲染层剥掉」。这条投影以前没剥，用户在失败卡上读到的
  // 第一行是一串 base64——比没有原因更糟：它看起来像 Nomi 自己坏了。
  const encoded =
    'NOMI_VENDOR_ERR_B64::eyJodHRwU3RhdHVzIjo0MDB9:: （HTTP 400）官方算力限制，请等待一段时间后再进行使用'

  it('剥掉传输标记，只留人读得懂的那半句', () => {
    const flow = projectV4Flow(flowInput({
      items: [baseItem({ itemId: 'failure-1', kind: 'failure', code: 'runtime_error', status: 'failed', message: encoded } as never)],
    }))
    const card = flow.find((entry) => entry.kind === 'error')
    if (card?.kind !== 'error') throw new Error('失败卡没渲出来')
    expect(card.reason).toBe('（HTTP 400）官方算力限制，请等待一段时间后再进行使用')
    expect(card.reason).not.toContain('NOMI_VENDOR_ERR_B64')
  })

  it('阳性对照：没有标记的原因原样带出，不被误伤', () => {
    const flow = projectV4Flow(flowInput({
      items: [baseItem({ itemId: 'failure-2', kind: 'failure', code: 'runtime_error', status: 'failed', message: '模型没有返回结果' } as never)],
    }))
    const card = flow.find((entry) => entry.kind === 'error')
    if (card?.kind !== 'error') throw new Error('失败卡没渲出来')
    expect(card.reason).toBe('模型没有返回结果')
  })
})
