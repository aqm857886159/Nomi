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
    expect(flow).toHaveLength(1)
    const group = flow[0]!
    expect(group.kind).toBe('tool-group')
    if (group.kind !== 'tool-group') return
    expect(group.count).toBe(6)
    expect(group.status).toBe('output-error')
    expect(group.trailing).toBe('agentPanelV4.toolGroupAllFailed')
    // 原因取**第一条**：后面五条是复读，第一条才是模型撞上的那堵墙。
    expect(group.reason).toBe('nodes：必须是数组（收到 字符串）')
    expect(group.receipts).toHaveLength(6)
  })

  it('只调一次的工具一个字都不动——折一条只会让用户多点一下', () => {
    const flow = collapseV4Flow([tool('修改文稿', 'output-available'), assistant('改好了')], t)
    expect(flow.map((item) => item.kind)).toEqual(['tool', 'assistant'])
  })

  it('不同工具不合并：相邻同名才是一段', () => {
    const flow = collapseV4Flow(
      [tool('读取文稿', 'output-available'), tool('创建或修改镜头卡', 'output-error'), tool('创建或修改镜头卡', 'output-error')],
      t,
    )
    expect(flow.map((item) => item.kind)).toEqual(['tool', 'tool-group'])
  })

  it('有成功有失败时不写「全部失败」——那是两件事', () => {
    const flow = collapseV4Flow(
      [tool('创建或修改镜头卡', 'output-error'), tool('创建或修改镜头卡', 'output-available')],
      t,
    )
    const group = flow[0]!
    if (group.kind !== 'tool-group') throw new Error('应折成一组')
    expect(group.trailing).toBe('agentPanelV4.toolGroupSomeFailed(1)')
    expect(group.status).toBe('output-available')
  })
})

describe('② 过程自述折起来，最终回答摊开', () => {
  it('最后一次调用之前的助手文本折成一条过程行，之后的留在流里', () => {
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
    expect(flow.map((item) => item.kind)).toEqual(['tool-group', 'process', 'assistant'])
    const process = flow[1]!
    if (process.kind !== 'process') throw new Error('第二条应是过程行')
    expect(process.label).toBe('agentPanelV4.processAttempts(3)')
    expect(process.segments).toHaveLength(2)
    const final = flow[2]!
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
    expect(flow.map((item) => item.kind)).toEqual(['assistant', 'tool-group'])
  })

  it('夹在两次调用之间的那几句照折——即便后面没有回答', () => {
    const flow = collapseV4Flow(
      [
        tool('创建或修改镜头卡', 'output-error'),
        assistant('让我修正。'),
        tool('创建或修改镜头卡', 'output-error'),
      ],
      t,
    )
    expect(flow.map((item) => item.kind)).toEqual(['tool-group', 'process'])
  })

  it('没有中间自述时不凭空造一条过程行', () => {
    const flow = collapseV4Flow(
      [tool('创建或修改镜头卡', 'output-error'), tool('创建或修改镜头卡', 'output-error'), assistant('失败了')],
      t,
    )
    expect(flow.map((item) => item.kind)).toEqual(['tool-group', 'assistant'])
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
    expect(flow.map((item) => item.kind)).toEqual(['tool-group', 'user', 'tool'])
  })

  it('思考行接在流尾时不被算进过程段', () => {
    const flow = collapseV4Flow(
      [
        tool('创建或修改镜头卡', 'output-error'),
        tool('创建或修改镜头卡', 'output-error'),
        { kind: 'thinking', label: '正在想…', meta: '4s' },
      ],
      t,
    )
    expect(flow.map((item) => item.kind)).toEqual(['tool-group', 'thinking'])
  })
})
