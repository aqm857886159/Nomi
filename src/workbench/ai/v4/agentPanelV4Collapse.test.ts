// 折叠层：把「同一件事失败了六次」读成一件事，而不是六件事。
//
// 夹具直接照 2026-09-06 打包版那次真实使用：用户让 Agent 从原稿重拆 10 镜，
// 「创建或修改镜头卡」连续失败 6 次，中间夹着模型的三段自我纠正，最后它放弃工具改口。
import { describe, expect, it } from 'vitest'
import { collapseV4Flow } from './agentPanelV4Collapse'
import type { ToolReceipt, V4FlowItem, V4ToolStatus } from './agentPanelV4Types'

const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}(${Object.values(options).join(',')})` : key

const receipt = (label: string, status: V4ToolStatus, summary?: string): ToolReceipt =>
  Object.freeze({ label, action: 'canvas' as const, status, ...(summary ? { summary } : {}) })

const tool = (label: string, status: V4ToolStatus, summary?: string): V4FlowItem =>
  ({ kind: 'tool', receipt: receipt(label, status, summary) })

const assistant = (text: string): V4FlowItem => ({ kind: 'assistant', text, status: 'complete' })

describe('③ 同一个工具连着调 N 次 → 一行', () => {
  it('六次失败折成一行，带次数、「全部失败」和第一条原因', () => {
    const flow = collapseV4Flow(
      Array.from({ length: 6 }, (_, index) =>
        tool('创建或修改镜头卡', 'output-error', index === 0 ? 'nodes：必须是数组（收到 字符串）' : '同一个错'),
      ),
      t,
    )
    expect(flow.map(item => item.kind)).toEqual(['process', 'error'])
    const group = flow[0]?.kind === 'process' ? flow[0].details?.[0]?.item : undefined
    if (!group) throw new Error('missing process detail')
    expect(group.kind).toBe('tool-group')
    if (group.kind !== 'tool-group') return
    expect(group.count).toBe(6)
    expect(group.status).toBe('output-error')
    expect(group.trailing).toBe('agentPanelV4.toolGroupAllFailed')
    // 原因取**第一条**：后面五条是复读，第一条才是模型撞上的那堵墙。
    expect(group.reason).toBe('nodes：必须是数组（收到 字符串）')
    expect(group.receipts).toHaveLength(6)
  })

  it('单次工具也收进过程，回答始终展开', () => {
    const flow = collapseV4Flow([tool('修改文稿', 'output-available'), assistant('改好了')], t)
    expect(flow.map((item) => item.kind)).toEqual(['process', 'assistant'])
  })

  it('不同工具不合并：相邻同名才是一段', () => {
    const flow = collapseV4Flow(
      [tool('读取文稿', 'output-available'), tool('创建或修改镜头卡', 'output-error'), tool('创建或修改镜头卡', 'output-error')],
      t,
    )
    expect(flow.map((item) => item.kind)).toEqual(['process', 'error'])
  })

  it('有成功有失败时不写「全部失败」——那是两件事', () => {
    const flow = collapseV4Flow(
      [tool('创建或修改镜头卡', 'output-error'), tool('创建或修改镜头卡', 'output-available')],
      t,
    )
    const group = flow[0]?.kind === 'process' ? flow[0].details?.[0]?.item : undefined
    if (!group) throw new Error('missing process detail')
    if (group.kind !== 'tool-group') throw new Error('应折成一组')
    expect(group.trailing).toBe('agentPanelV4.toolGroupSomeFailed(1)')
    expect(group.status).toBe('output-available')
  })
})

describe('② 过程自述折起来，最终回答摊开', () => {
  it('没有可靠正文边界时，每段助手文本都保留可见', () => {
    const flow = collapseV4Flow(
      [
        tool('创建或修改镜头卡', 'output-error', '必须是数组'),
        assistant('我看到参数需要是数组而不是字符串，让我修正'),
        tool('创建或修改镜头卡', 'output-error', '必须是数组'),
        assistant('我把 JSON 字符串化两次了'),
        tool('创建或修改镜头卡', 'output-error', '必须是数组'),
        assistant('看起来工具调用有问题，我直接把分镜写进文稿。'),
      ],
      t,
    )
    expect(flow.map((item) => item.kind)).toEqual(['process', 'error', 'assistant', 'assistant', 'assistant'])
    const final = flow[4]!
    if (final.kind !== 'assistant') throw new Error('最终回答必须留在流里')
    expect(final.text).toContain('直接把分镜写进文稿')
  })

  it('切不开正文时，开头那段话留在流里——绝不能一条摊开的回答都不剩', () => {
    // 宿主把整回合的助手正文合并成一条，拿不到调用偏移量就切不开，那一条会整段落在
    // 工具**前面**。这时候若把它也折进过程行，用户一个字的回答都看不到——比平铺更糟。
    const flow = collapseV4Flow(
      [
        assistant('我先看看画布。已经按脚本排好了。'),
        tool('创建或修改镜头卡', 'output-error'),
        tool('创建或修改镜头卡', 'output-error'),
      ],
      t,
    )
    expect(flow.map((item) => item.kind)).toEqual(['process', 'error', 'assistant'])
  })

  it('夹在两次调用之间的助手文本不按位置猜成过程', () => {
    const flow = collapseV4Flow(
      [
        tool('创建或修改镜头卡', 'output-error'),
        assistant('让我修正。'),
        tool('创建或修改镜头卡', 'output-error'),
      ],
      t,
    )
    expect(flow.map((item) => item.kind)).toEqual(['process', 'error', 'assistant'])
  })

  it('没有中间自述时仍用同一个过程摘要', () => {
    const flow = collapseV4Flow(
      [tool('创建或修改镜头卡', 'output-error'), tool('创建或修改镜头卡', 'output-error'), assistant('失败了')],
      t,
    )
    expect(flow.map((item) => item.kind)).toEqual(['process', 'error', 'assistant'])
  })

  it('用户气泡截断一段：下一轮的收据不会被折进上一轮', () => {
    const flow = collapseV4Flow(
      [
        tool('创建或修改镜头卡', 'output-error'),
        tool('创建或修改镜头卡', 'output-error'),
        { kind: 'user', text: '换个方式' },
        tool('修改文稿', 'output-available'),
      ],
      t,
    )
    expect(flow.map((item) => item.kind)).toEqual(['process', 'error', 'user', 'process'])
  })

  it('思考行接在流尾时收入同一过程明细', () => {
    const flow = collapseV4Flow(
      [
        tool('创建或修改镜头卡', 'output-error'),
        tool('创建或修改镜头卡', 'output-error'),
        { kind: 'thinking', label: '正在想…', meta: '4s' },
      ],
      t,
    )
    expect(flow.map((item) => item.kind)).toEqual(['process', 'error'])
  })
})

describe('process retry summary', () => {
  it.each([0, 1, 2])('selects a complete localized summary for %i retries', async retries => {
    const { createInstance } = await import('i18next')
    const { zhAgentPanelV4, enAgentPanelV4 } = await import('../../../i18n/locales/agentPanelV4')
    for (const [lng, locale, expected] of [
      ['zh-CN', zhAgentPanelV4, retries ? `用了 ${retries + 1} 个工具 · ${retries} 次重试` : '用了 1 个工具'],
      ['en', enAgentPanelV4, retries ? `${retries + 1} tools · ${retries} retries` : '1 tools'],
    ] as const) {
      const i18n = createInstance()
      await i18n.init({ lng, resources: { [lng]: { translation: { agentPanelV4: locale } } } })
      const flow = collapseV4Flow([
        ...Array.from({ length: retries }, () => tool('读取文稿', 'output-error')),
        tool('读取文稿', 'output-available'),
      ], (key, options) => String(i18n.t(key, options)))
      expect(flow[0]).toMatchObject({ kind: 'process', retries, label: expected })
    }
  })
})


describe('C77 process thinking projection', () => {
  const thoughts = Array.from({ length: 5 }, (_, i): V4FlowItem => ({
    kind: 'thinking', label: '思考中…', meta: `${i + 1}s`, text: `思考正文 ${i}`, streaming: false,
  }))
  const calls = [tool('读取文稿', 'output-available'), tool('保存分镜', 'output-error'),
    tool('保存分镜', 'output-available'), tool('读取分镜', 'output-available')]
  const input = thoughts.flatMap((thought, i) => calls[i] ? [thought, calls[i]!] : [thought])

  it('N thoughts and M tools retain one complete disclosure before every tool', () => {
    const process = collapseV4Flow(input, t)[0]
    if (process?.kind !== 'process') throw new Error('missing process')
    const details = process.details!
    expect(details.filter(detail => detail.item.kind === 'thinking')).toHaveLength(1)
    expect(details[0]?.item).toMatchObject({ kind: 'thinking', streaming: false,
      text: thoughts.map(thought => thought.kind === 'thinking' ? thought.text : '').join('\n\n') })
    expect(details.slice(1).every(detail => ['tool', 'tool-group'].includes(detail.item.kind))).toBe(true)
    expect(process).toMatchObject({ toolCount: 4, retries: 1 })
    expect(details.slice(1).map(detail => detail.index)).toEqual([1, 3, 7])
  })

  it('running process uses only its live summary even with completed thoughts', () => {
    const live = [...input, tool('读取分镜', 'input-streaming')]
    const process = collapseV4Flow(live, t)[0]
    if (process?.kind !== 'process') throw new Error('missing process')
    expect(process.running).toBe(true)
    expect(process.details!.filter(detail => detail.item.kind === 'thinking')).toHaveLength(0)
  })

  it('streaming thought after settled receipts still belongs to the live summary', () => {
    const process = collapseV4Flow([...input, { kind: 'thinking', label: '思考中…', meta: '', text: '继续核对', streaming: true }], t)[0]
    expect(process).toMatchObject({ kind: 'process', running: true })
    if (process?.kind !== 'process') throw new Error('missing process')
    expect(process.details!.some(detail => detail.item.kind === 'thinking')).toBe(false)
  })

  it('metadata-only thoughts leave no empty disclosure and tools remain intact', () => {
    const process = collapseV4Flow([{ kind: 'thinking', label: '思考中…', meta: '4s', streaming: false }, ...calls], t)[0]
    if (process?.kind !== 'process') throw new Error('missing process')
    expect(process.details!.map(detail => detail.item.kind)).toEqual(['tool', 'tool-group', 'tool'])
    expect(process).toMatchObject({ toolCount: 4, retries: 1 })
  })

  it('streaming answer keeps the process live until the turn settles', () => {
    const process = collapseV4Flow([...input, { kind: 'assistant', text: '已保存', status: 'streaming' }], t)[0]
    expect(process).toMatchObject({ kind: 'process', running: true })
    if (process?.kind !== 'process') throw new Error('missing process')
    expect(process.details!.some(detail => detail.item.kind === 'thinking')).toBe(false)
  })

  it('turn boundaries keep separate thought bodies without mutating replay input', () => {
    const before = JSON.stringify(input)
    const flow = collapseV4Flow([...input, { kind: 'user', text: '下一轮' }, ...input], t)
    const processes = flow.filter(item => item.kind === 'process')
    expect(processes).toHaveLength(2)
    for (const process of processes) {
      expect(process.details!.filter(detail => detail.item.kind === 'thinking')).toHaveLength(1)
    }
    expect(JSON.stringify(input)).toBe(before)
  })
})
