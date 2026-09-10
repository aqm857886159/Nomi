// 视图投影：一份有序段 → v4 的 8 个积木。**组件一行不改**，它们只是终于按发生顺序出现。
//
// 这一族测试守的是三条「不做什么」——不排序、不 join 第二真相、不缓存正文。
// 「不做什么」很难用正面断言证，所以每条都配一个会暴露它的场景。
import { describe, expect, it } from 'vitest'

import type {
  LaneMetric, LaneMetricUnknownReason, LanePart, LaneProjection, LaneUsage,
} from '../../../../electron/shared/agentLane/laneContracts'
import { LANE_APPROVAL_NOTE_TYPE } from '../../../../electron/shared/agentLane/laneContracts'
import { laneInterventionSource, laneViewModel, type LaneViewModelLabels } from './laneViewModel'
import { humanizeToolFailure, readableToolName, readableToolSummary } from '../resident/residentToolDisplay'

const labels: LaneViewModelLabels = {
  toolLabel: (name) => `[${name}]`,
  toolSummary: () => undefined,
  toolFailure: () => undefined,
  thinkingLabel: '[thinking]',
  formatTokens: (value) => `${value}t`,
  formatCost: (usd) => `$${usd.toFixed(4)}`,
  retryLabel: (attempt, maxAttempts) => `[retry ${attempt}/${maxAttempts}]`,
  // 这两句在生产里是 i18n 的 `contextUnknown` / `contextCostFree`。测试里写成醒目的假串，
  // 是为了让「本层自己编了一个字」当场露馅——占位符长什么样是调用方的事，不是这一层的。
  unknown: '[unknown]',
  free: '[free]',
  taskTitle: '[task]',
  formatStages: (done, total) => `${done}/${total} stages`,
  formatMoney: (currency, amount) => `${currency} ${amount.toFixed(2)}`,
  taskUnknown: '[task-unknown]',
  skillLabel: (key) => `[skill:${key}]`,
}

/** 三态的常用取值。写成构件是因为下面几乎每条都要摆一次。 */
const UNKNOWN = (reason: LaneMetricUnknownReason): LaneMetric => ({ state: 'unknown', reason })
const KNOWN = (value: number): LaneMetric => ({ state: 'known', value })

/** 一份「什么都还没量到」的用量：三行全是 `unknown`，token 那几列是真实累计。 */
const usageOf = (overrides: Partial<LaneUsage> = {}): LaneUsage => ({
  inputTokens: 120, outputTokens: 40, cacheReadTokens: 900, cacheWriteTokens: 0, totalTokens: 160,
  cost: UNKNOWN('no-settled-turn'),
  contextTokens: UNKNOWN('no-settled-turn'),
  reasoningTokens: UNKNOWN('no-settled-turn'),
  ...overrides,
})

const THINKING: LaneProjection['thinking'] = { supportedLevels: ['off'], level: 'off', canTurnOff: true }

let next = 0
const part = (input: Omit<LanePart, 'sequence' | 'entrySeq' | 'contentIndex'> & Partial<LanePart>): LanePart =>
  ({ sequence: next++, entrySeq: next, contentIndex: 0, ...input }) as LanePart

function projection(parts: LanePart[], overrides: Partial<LaneProjection> = {}): LaneProjection {
  return { lane: 'main', parts, running: false, usage: usageOf(), thinking: THINKING, queues: [], ...overrides }
}

describe('laneViewModel', () => {
  it('maps a durable aborted partial to the existing interrupted assistant card', () => {
    const partial = { ...part({ kind: 'assistant-text', text: 'Actual partial', streaming: false }), interrupted: true as const,
      continuationEntryId: 'native-stopped-entry' }
    expect(laneViewModel(projection([partial]), labels).items).toEqual([
      { kind: 'assistant', text: 'Actual partial', status: 'interrupted', continuationEntryId: 'native-stopped-entry' },
    ])
  })

  it('shows undo only on the successful tool selected by the durable receipt join', () => {
    next = 0
    const parts = [
      part({ kind: 'tool-call', toolCallId: 'c1', toolName: 'nomi_canvas_write', args: {}, running: false }),
      part({ kind: 'tool-result', toolCallId: 'c1', toolName: 'nomi_canvas_write', text: 'Created.', isError: false }),
      part({ kind: 'tool-call', toolCallId: 'c2', toolName: 'nomi_canvas_write', args: {}, running: false }),
      part({ kind: 'tool-result', toolCallId: 'c2', toolName: 'nomi_canvas_write', text: 'Failed.', isError: true }),
    ]
    const items = laneViewModel(projection(parts), labels, 'c1').items
    expect(items[0]).toMatchObject({ kind: 'tool', receipt: { toolCallId: 'c1', undoable: true } })
    expect(items[1]).toMatchObject({ kind: 'tool', receipt: { toolCallId: 'c2' } })
    expect(JSON.stringify(laneViewModel(projection(parts), labels, 'c2').items)).not.toContain('undoable')
    expect(JSON.stringify(laneViewModel(projection(parts), labels).items)).not.toContain('undoable')
  })

  it('keeps the actual canvas effect visible and replaces it on failure or refusal', () => {
    const translate = (key: string) => key
    const display: LaneViewModelLabels = {
      ...labels,
      toolLabel: (name, args) => readableToolName(translate, name, args),
      toolSummary: (name, args) => readableToolSummary(translate, name, args),
      toolFailure: text => humanizeToolFailure(translate, text),
    }
    const receipt = (isError: boolean, denied = false) => {
      next = 0
      const model = laneViewModel(projection([
        ...(denied ? [part({ kind: 'host-note', noteType: LANE_APPROVAL_NOTE_TYPE,
          data: { toolCallId: 'c1', toolName: 'nomi_canvas_write', decision: 'denied', reason: 'Declined.' } })] : []),
        part({ kind: 'tool-call', toolCallId: 'c1', toolName: 'nomi_canvas_write',
          args: { operation: 'create_canvas_nodes', nodes: [{ kind: 'shot', title: 'Opening' }] }, running: false }),
        part({ kind: 'tool-result', toolCallId: 'c1', toolName: 'nomi_canvas_write',
          text: isError ? 'Validation failed for tool "nomi_canvas_write":\n  - nodes: Expected array\n\nReceived arguments:\n{}' : 'Created.', isError }),
      ]), display)
      const item = model.items[0]
      if (item.kind !== 'tool') throw new Error('missing receipt')
      return item.receipt
    }
    expect(receipt(false)).toMatchObject({ label: 'agentResident.toolCanvasCreate', action: 'canvas', status: 'output-available' })
    expect(receipt(false).summary).toContain('agentResident.toolNoGeneration')
    expect(receipt(true).summary).not.toContain('agentResident.toolNoGeneration')
    expect(receipt(true).summary).toContain('agentResident.issueExpected')
    expect(receipt(true).output).toBe('Validation failed for tool "nomi_canvas_write":\n  - nodes: Expected array\n\nReceived arguments:\n{}')
    expect(receipt(true, true)).toMatchObject({ status: 'output-denied' })
    expect(receipt(true, true).summary).toBeUndefined()
  })

  it('任务卡：状态 / 进度 / 金额全部来自 join 出来的领域事实，卡本身只有两个 id', () => {
    next = 0
    const model = laneViewModel(projection([
      part({
        kind: 'task', productionRunId: 'run-7', operationId: 'call-1',
        facts: {
          status: 'running', progress: 33, stagesDone: 1, stagesTotal: 3,
          currency: 'CNY', spent: 0.24, estimated: 0.48, candidates: ['a1', 'a2'].map(artifactId => ({
            artifactId, projectId: 'project-a', productionRunId: 'run-7', thumbnailUrl: `nomi-local://asset/project-a/${artifactId}.png`, adopted: false, canAdopt: true,
          })),
        },
      }),
    ]), labels)

    expect(model.items).toEqual([{
      kind: 'task',
      task: {
        title: '[task]', action: 'video', status: 'running',
        trailing: '1/3 stages', progress: 33,
        candidates: ['a1', 'a2'].map((artifactId, index) => ({
          artifactId, projectId: 'project-a', productionRunId: 'run-7', thumbnailUrl: `nomi-local://asset/project-a/${artifactId}.png`, adopted: false, canAdopt: true, tag: String(index + 1),
        })),
        // 「预估」上卡头，「已花」上卡尾——与画布 FlowGeneration 板拍板过的位置一致。
        cost: 'CNY 0.48', footnoteTrailing: 'CNY 0.24',
      },
    }])
  })

  it('任务卡 join 不到领域事实：只画标题 + 一句「详情在别处」，不给一个假的「排队中」', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'task', productionRunId: 'run-7' }),
    ]), labels)
    const [item] = model.items
    expect(item.kind === 'task' && item.task).toEqual({
      title: '[task]', action: 'video', status: 'queued', footnote: '[task-unknown]',
    })
    // 阳性对照：上一条同样是 `status: queued` 的卡**带着进度和金额**。两张卡状态字面相同、
    // 意思相反（「排着队」vs「不知道」），区别只在有没有 footnote —— 所以这条断言查的是整张卡。
    expect(item.kind === 'task' && item.task.progress).toBeUndefined()
  })

  it('没有币种就不印金额：一个没有币种的数字看起来完全正常，而它可能是另一种钱', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'task', productionRunId: 'run-7', facts: { status: 'complete', spent: 0.24 } }),
    ]), labels)
    const [item] = model.items
    expect(item.kind === 'task' && item.task.footnoteTrailing).toBeUndefined()
  })

  it('队列原样带出去：不合并、不去重、不改顺序——pi 的 FIFO 就是用户打字的顺序', () => {
    next = 0
    const queues = [
      { entryId: 'q1', kind: 'steer' as const, text: '一句' },
      { entryId: 'q2', kind: 'follow-up' as const, text: '两句' },
    ]
    const model = laneViewModel(projection([], { queues }), labels)
    expect(model.queues).toBe(queues)
    // 队列**不进流**：它是还没发生的事。混进去用户会看到自己刚打的话排在模型的回答后面，
    // 像是模型已经读过它了。
    expect(model.items).toEqual([])
  })

  it('一回合里被工具行隔开的助手文本合成一个气泡，工具行仍按序内联', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'user', text: 'Append a closing line.' }),
      part({ kind: 'thinking', text: 'The document ends abruptly.', streaming: false }),
      part({ kind: 'assistant-text', text: 'Reading it first.', streaming: false }),
      part({ kind: 'tool-call', toolCallId: 'c1', toolName: 'read_full_text', args: {}, running: false }),
      part({ kind: 'tool-result', toolCallId: 'c1', toolName: 'read_full_text', text: 'The opening scene.', isError: false }),
      part({ kind: 'assistant-text', text: 'Done.', streaming: false }),
    ]), labels)

    // 三段文本 + 一次调用 = **一个**气泡，不是两个：一轮回复在传输上是「一条消息里的若干块」，
    // 一块一个气泡就是把一个人说的一段话切成两句话（2026-09-10 用户反馈 #7）。
    expect(model.items.map((item) => item.kind)).toEqual(['user', 'thinking', 'tool', 'assistant'])
    const bubble = model.items[3]
    // 段与段之间是空行：Markdown 里空行才是段落分隔，直接拼会把两段粘成一段。
    expect(bubble.kind === 'assistant' && bubble.text).toBe('Reading it first.\n\nDone.')
    // 工具结果**并回它自己那一行**，不新开一行——收据是一行，不是两行（v4 定稿）。
    const tool = model.items[2]
    expect(tool.kind === 'tool' && tool.receipt.status).toBe('output-available')
    expect(tool.kind === 'tool' && tool.receipt.output).toBe('The opening scene.')
  })

  it('回合以用户消息为界：上一轮的文本绝不并进下一轮的气泡', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'user', text: '第一句。' }),
      part({ kind: 'assistant-text', text: '好的。', streaming: false }),
      part({ kind: 'user', text: '第二句。' }),
      part({ kind: 'assistant-text', text: '我先看看。', streaming: false }),
      part({ kind: 'tool-call', toolCallId: 'c1', toolName: 'read_full_text', args: {}, running: false }),
      part({ kind: 'tool-result', toolCallId: 'c1', toolName: 'read_full_text', text: '开场。', isError: false }),
      part({ kind: 'assistant-text', text: '看完了。', streaming: true }),
    ]), labels)
    expect(model.items.map((item) => item.kind)).toEqual(['user', 'assistant', 'user', 'tool', 'assistant'])
    expect(model.items[1].kind === 'assistant' && model.items[1].text).toBe('好的。')
    const second = model.items[4]
    // 落点是**最后**一段：还在流的是它，气泡跟着字往下长，不会跑到已经发生的工具行上面去。
    expect(second.kind === 'assistant' && second.text).toBe('我先看看。\n\n看完了。')
    expect(second.kind === 'assistant' && second.status).toBe('streaming')
  })

  it('技能随消息落盘：用户气泡带 chip，这一轮的回复头上带凭据', () => {
    next = 0
    const model = laneViewModel(projection([
      { ...part({ kind: 'user', text: '拆分镜。' }), skillKey: 'workbench.storyboard.planner' } as LanePart,
      part({ kind: 'assistant-text', text: '好的。', streaming: false }),
      part({ kind: 'user', text: '再来一句。' }),
      part({ kind: 'assistant-text', text: '这轮没挂技能。', streaming: false }),
    ]), labels)
    expect(model.items[0]).toEqual({ kind: 'user', text: '拆分镜。',
      chips: [{ kind: 'skill', label: '[skill:workbench.storyboard.planner]' }] })
    expect(model.items[1]).toMatchObject({ kind: 'assistant', skill: '[skill:workbench.storyboard.planner]' })
    // 没挂技能的那一轮**整行不出**：印一个空凭据等于说「用了个说不出名字的技能」。
    expect(model.items[2]).toEqual({ kind: 'user', text: '再来一句。' })
    expect(JSON.stringify(model.items[3])).not.toContain('skill')
  })

  it('refuses a projection whose parts are out of order instead of quietly sorting them', () => {
    // 悄悄排序是今天那把假尺子（`sortedItems()`）的做法。面板上「先做了、后说要做」
    // 在截图里非常像「模型自己顺序乱」，所以这里必须**炸**，不许自己修好。
    const bad = projection([
      { sequence: 1, entrySeq: 1, contentIndex: 0, kind: 'user', text: 'second' },
      { sequence: 0, entrySeq: 0, contentIndex: 0, kind: 'user', text: 'first' },
    ])
    expect(() => laneViewModel(bad, labels)).toThrow(/out of order/)
  })

  it('marks a running tool as running, without a second registry to ask', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'tool-call', toolCallId: 'c1', toolName: 'append_to_end', args: { content: 'x' }, running: true }),
    ], { running: true }), labels)
    const tool = model.items[0]
    expect(tool.kind === 'tool' && tool.receipt.status).toBe('input-available')
    expect(model.running).toBe(true)
    // 今天这件事要靠 `agentPanelV4PendingTools` 那张易失登记表，冷重启就空。
    // 这里它来自投影本身，所以重启后依然对。
  })

  it('separates a policy denial from a broken tool — they are two different sentences', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'host-note', noteType: LANE_APPROVAL_NOTE_TYPE,
        data: { toolCallId: 'c1', toolName: 'append_to_end', decision: 'denied', reason: 'The document is locked.' } }),
      part({ kind: 'tool-call', toolCallId: 'c1', toolName: 'append_to_end', args: { content: 'x' }, running: false }),
      part({ kind: 'tool-result', toolCallId: 'c1', toolName: 'append_to_end', text: 'The document is locked.', isError: true }),
      part({ kind: 'tool-call', toolCallId: 'c2', toolName: 'read_full_text', args: {}, running: false }),
      part({ kind: 'tool-result', toolCallId: 'c2', toolName: 'read_full_text', text: 'boom', isError: true }),
    ]), labels)

    // 「点了不要」显示成「已确认」是真机上出过的 bug（G6 判据④）。denied 与 error
    // 折进同一态，用户就分不出「我拒绝了」和「它坏了」。
    const denied = model.items[0]
    const broken = model.items[1]
    expect(denied.kind === 'tool' && denied.receipt.status).toBe('output-denied')
    expect(broken.kind === 'tool' && broken.receipt.status).toBe('output-error')
  })

  it('does not turn a host note into a second bubble saying the same thing twice', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'host-note', noteType: LANE_APPROVAL_NOTE_TYPE,
        data: { toolCallId: 'c1', toolName: 'append_to_end', decision: 'denied', reason: 'Locked.' } }),
      part({ kind: 'tool-call', toolCallId: 'c1', toolName: 'append_to_end', args: {}, running: false }),
      part({ kind: 'tool-result', toolCallId: 'c1', toolName: 'append_to_end', text: 'Locked.', isError: true }),
    ]), labels)
    expect(model.items).toHaveLength(1)
    // 拍板过的那一格（`v4-tool-output-denied`）行尾只有「已拒绝」：理由既不进行尾也不进展开体，
    // 它住在用户填它的介入槽里。设计实验室 P6 把这一格接上真投影时，"trailing = 理由 + 展开体 = 理由"
    // 那版当场和基线红了——修投影，不动基线。
    expect(JSON.stringify(model.items).split('Locked.').length - 1).toBe(0)
    const denied = model.items[0]
    expect(denied.kind === 'tool' && denied.receipt.status).toBe('output-denied')
    expect(denied.kind === 'tool' && denied.receipt.trailing).toBeUndefined()
    expect(denied.kind === 'tool' && denied.receipt.output).toBeUndefined()
  })

  it('never invents a bubble for a result whose call it cannot see', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'tool-result', toolCallId: 'orphan', toolName: 'read_full_text', text: 'x', isError: false }),
    ]), labels)
    // 一条没有起因的结果会让用户以为漏看了什么。安静地多画一行只会把上游的 bug 藏起来。
    expect(model.items).toEqual([])
  })

  // ── G3d · 三行三态的**渲染这一半** ───────────────────────────────────────────
  //
  // 上游那一半（投影产出什么态）在 `tests/agent-runtime/lane-cost.test.mts`。这里问的是
  // 另一个问题：**拿到「不可知」的时候，屏幕上出现的是什么。** 两者分开是因为
  // 「投影说 unknown」和「面板印了一个 0」可以同时成立——中间这一层就是它们分家的地方。
  it('G3d · 不可知：印占位符，绝不印 0——那三种「没有数」在屏幕上都不许长成一个数字', () => {
    next = 0
    // 三夹具之一：**首轮**（一条回合都还没结算）。
    const firstTurn = laneViewModel(projection([]), labels)
    expect(firstTurn.usage.cost).toBe('[unknown]')
    expect(firstTurn.usage.reasoning).toBe('[unknown]')
    // 环的分子也必须缺席：`used: 0` 会画出一个「上下文是空的」的断言，而我们只是没量。
    expect(firstTurn.usage.used).toBeUndefined()
    expect(firstTurn.usage.max).toBeUndefined()
    // 阳性对照：同一次调用里 token 那几列**确实有数**。少了这一行，一个「什么都印占位符」
    // 的实现也能全绿。
    expect(firstTurn.usage.input).toBe('120t')
    // 缓存命中单独一列：并进 input 就看不出前缀合同有没有被自己抖坏。
    expect(firstTurn.usage.cache).toBe('900t')

    next = 0
    // 三夹具之二：**刚压缩完**。上下文那一行的旧数字描述的是压缩前，不能拿来回答「现在装了多少」。
    const compacted = laneViewModel(projection([], {
      usage: usageOf({ cost: KNOWN(0.0123), contextTokens: UNKNOWN('just-compacted') }),
    }), labels)
    expect(compacted.usage.used).toBeUndefined()
    // 花费这一行不受压缩影响——它是累计的，压缩不会把已经花掉的钱变回来。
    expect(compacted.usage.cost).toBe('$0.0123')

    next = 0
    // 三夹具之三：**这个模型没有价目**。花费印占位符，不是 $0.0000。
    const unpriced = laneViewModel(projection([], {
      usage: usageOf({ cost: UNKNOWN('model-has-no-pricing'), contextTokens: KNOWN(1_024) }),
    }), labels)
    expect(unpriced.usage.cost).toBe('[unknown]')
    expect(unpriced.usage.cost).not.toBe('$0.0000')
    expect(unpriced.usage.used).toBe(1_024)
  })

  it('G3d · 不适用：免费模型说「免费」，不会思考的模型整行不画——两者都不是「不可知」', () => {
    next = 0
    const model = laneViewModel(projection([], {
      usage: usageOf({
        cost: { state: 'not-applicable', reason: 'model-is-free' },
        reasoningTokens: { state: 'not-applicable', reason: 'model-has-no-reasoning' },
      }),
    }), labels)
    // 「查过了，不花钱」是一个答案，和「我们不知道」是两句不同的话。
    expect(model.usage.cost).toBe('[free]')
    // 推理没有这么一句更好的话可说，所以整行不渲染——画一个永远是 `—` 的行只会占地方。
    expect(model.usage.reasoning).toBeUndefined()
  })

  it('G3d · known 的 0 照印——那是量到的，不是编的', () => {
    next = 0
    // 这一条守的是反向：三态不是「把所有 0 都藏起来」。真花了不到半分钱、真没思考，
    // 屏幕上就该出现那个 0；藏掉它等于把「便宜」也说成「不知道」。
    const model = laneViewModel(projection([], {
      usage: usageOf({ cost: KNOWN(0), reasoningTokens: KNOWN(0), contextTokens: KNOWN(0) }),
    }), labels)
    expect(model.usage.cost).toBe('$0.0000')
    expect(model.usage.reasoning).toBe('0t')
    expect(model.usage.used).toBe(0)
  })

  it('G3d · 上下文的分子是「现在装了多少」，不是累计用量', () => {
    next = 0
    // 累计（totalTokens: 160）会随聊天次数一路涨到超过窗口，画出一个 300% 的环。
    // 这里刻意让两者不相等，好让「不小心又拿了累计」当场翻红。
    const model = laneViewModel(projection([], {
      usage: usageOf({ contextTokens: KNOWN(4_096), contextWindow: 128_000 }),
    }), labels)
    expect(model.usage.used).toBe(4_096)
    expect(model.usage.max).toBe(128_000)
  })

  it('maps a known capability alias to its icon family, and refuses to guess for an unknown one', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'tool-call', toolCallId: 'c1', toolName: 'read_full_text', args: {}, running: false }),
      part({ kind: 'tool-call', toolCallId: 'c2', toolName: 'not_a_registered_alias', args: {}, running: false }),
    ]), labels)
    expect(model.items[0].kind === 'tool' && model.items[0].receipt.action).toBe('document')
    // 猜一个具体 icon 会在收据上印一个我们没量过的断言。
    expect(model.items[1].kind === 'tool' && model.items[1].receipt.action).toBe('write')
  })

  it('takes every visible word from the caller, so no UI string is born in this layer', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'thinking', text: 'hm', streaming: true }),
      part({ kind: 'tool-call', toolCallId: 'c1', toolName: 'read_full_text', args: {}, running: false }),
    ]), labels)
    expect(model.items[0].kind === 'thinking' && model.items[0].label).toBe('[thinking]')
    expect(model.items[1].kind === 'tool' && model.items[1].receipt.label).toBe('[read_full_text]')
  })

  it('says “retrying 2/4” while pi is backing off, and says nothing at all when it is not', () => {
    // 这条守的是用户那边最贵的一个体感：一次 429 或网络抖动今天长成「它卡住了」——
    // 面板既不动也不报错，而底下 pi 正在 1s / 2s / 4s 地退避。三个数字上屏之后，
    // 同一件事变成一句「正在重试 2/4」，用户知道该等还是该按停。
    next = 0
    const retrying = laneViewModel(projection([
      part({ kind: 'user', text: 'Say something.' }),
    ], { running: true, retry: { attempt: 2, maxAttempts: 4, nextAttemptAt: 1_757_000_000_000 } }), labels)
    expect(retrying.retry).toBe('[retry 2/4]')

    // 阳性对照：**缺失 = 没在重试**，不是重试了 0 次。一个恒存在的「重试 0/4」
    // 会把「一切正常」说成「它在挣扎」，那比不显示更糟。
    next = 0
    const calm = laneViewModel(projection([part({ kind: 'user', text: 'Say something.' })], { running: true }), labels)
    expect(calm.retry).toBeUndefined()
  })

  it('reports a streaming assistant part as streaming, so the cursor is real and not a timer', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'assistant-text', text: 'Half a sen', streaming: true }),
    ], { running: true }), labels)
    expect(model.items[0].kind === 'assistant' && model.items[0].status).toBe('streaming')
  })
})

describe('审批（阶段 3a）', () => {
  const NOTE = (decision: string, reason?: string) => ({
    sequence: 0, entrySeq: 1, contentIndex: 0, kind: 'host-note' as const,
    noteType: LANE_APPROVAL_NOTE_TYPE,
    data: { toolCallId: 'call-1', toolName: 'append_to_end', decision, ...(reason ? { reason } : {}) },
  })
  const CALL = {
    sequence: 1, entrySeq: 2, contentIndex: 0, kind: 'tool-call' as const,
    toolCallId: 'call-1', toolName: 'append_to_end', args: {}, running: false,
  }
  const RESULT = {
    sequence: 2, entrySeq: 3, contentIndex: 0, kind: 'tool-result' as const,
    toolCallId: 'call-1', toolName: 'append_to_end', text: 'no', isError: true,
  }

  it.each(['denied', 'denied-by-policy', 'cancelled'])(
    '%s 的收据画成「被拒了」，不是「坏了」——三种拒收在用户那里都不是工具故障',
    (decision) => {
      const model = laneViewModel(
        projection([NOTE(decision, 'nope'), CALL, RESULT]),
        labels,
      )
      const tool = model.items.find((item) => item.kind === 'tool')
      expect(tool?.kind === 'tool' && tool.receipt.status).toBe('output-denied')
    },
  )

  it('放行的记录不改收据的状态：它没被拒，它只是被批准了', () => {
    const model = laneViewModel(
      projection([NOTE('granted-once'), CALL, { ...RESULT, text: 'ok', isError: false }]),
      labels,
    )
    const tool = model.items.find((item) => item.kind === 'tool')
    expect(tool?.kind === 'tool' && tool.receipt.status).toBe('output-available')
  })

  it('等待中的卡不进流里的任何一行——它住在介入槽，滚上去就没了那才是 bug', () => {
    const pending = {
      toolCallId: 'call-1', toolName: 'append_to_end', args: { content: 'x' },
      effectClass: 'reversible_local' as const, grantable: true, pendingCount: 1,
    }
    const model = laneViewModel(projection([CALL], { pending }), labels)
    expect(model.items.filter((item) => item.kind === 'tool')).toHaveLength(1)
    expect(model.pending).toBe(pending)
    expect(laneInterventionSource(pending)).toEqual({
      toolName: 'append_to_end', args: { content: 'x' }, effectClass: 'reversible_local', pendingCount: 1,
    })
  })
})


describe('thinking content is not status metadata', () => {
  it.each([true, false])('keeps long reasoning in a collapsible body (streaming=%s)', (streaming) => {
    const text = 'I need to check the canvas before delivering. '.repeat(100)
    const model = laneViewModel(projection([
      part({ kind: 'user', text: '查看画布' }),
      part({ kind: 'thinking', text, streaming }),
      part({ kind: 'assistant-text', text: '已完成。', streaming: false }),
    ]), labels)
    expect(model.items[1]).toEqual({ kind: 'thinking', label: '[thinking]', meta: '', text, streaming })
    expect(model.items.map((item) => item.kind)).toEqual(['user', 'thinking', 'assistant'])
  })
})
