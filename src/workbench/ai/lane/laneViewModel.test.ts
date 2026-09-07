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

const labels: LaneViewModelLabels = {
  toolLabel: (name) => `[${name}]`,
  thinkingLabel: '[thinking]',
  formatTokens: (value) => `${value}t`,
  formatCost: (usd) => `$${usd.toFixed(4)}`,
  // 这两句在生产里是 i18n 的 `contextUnknown` / `contextCostFree`。测试里写成醒目的假串，
  // 是为了让「本层自己编了一个字」当场露馅——占位符长什么样是调用方的事，不是这一层的。
  unknown: '[unknown]',
  free: '[free]',
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
  return { lane: 'main', parts, running: false, usage: usageOf(), thinking: THINKING, ...overrides }
}

describe('laneViewModel', () => {
  it('emits one flow item per part, in the order the transcript recorded', () => {
    next = 0
    const model = laneViewModel(projection([
      part({ kind: 'user', text: 'Append a closing line.' }),
      part({ kind: 'thinking', text: 'The document ends abruptly.', streaming: false }),
      part({ kind: 'assistant-text', text: 'Reading it first.', streaming: false }),
      part({ kind: 'tool-call', toolCallId: 'c1', toolName: 'read_full_text', args: {}, running: false }),
      part({ kind: 'tool-result', toolCallId: 'c1', toolName: 'read_full_text', text: 'The opening scene.', isError: false }),
      part({ kind: 'assistant-text', text: 'Done.', streaming: false }),
    ]), labels)

    expect(model.items.map((item) => item.kind)).toEqual(['user', 'thinking', 'assistant', 'tool', 'assistant'])
    // 工具结果**并回它自己那一行**，不新开一行——收据是一行，不是两行（v4 定稿）。
    const tool = model.items[3]
    expect(tool.kind === 'tool' && tool.receipt.status).toBe('output-available')
    expect(tool.kind === 'tool' && tool.receipt.output).toBe('The opening scene.')
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
