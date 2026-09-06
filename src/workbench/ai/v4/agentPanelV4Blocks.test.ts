// 8 个积木**逐状态**的渲染断言。
//
// 为什么用 renderToStaticMarkup 而不是截图：截图证明「这一格今天长这样」，
// 断言证明的是「这个状态一定带这个东西」——比如失败收据一定带 danger 色和原因，
// 采用的候选一定带 accent 描边而不是把整格填成 accent 底（返工前就是后者）。
// 两者互补：像素归视觉基线，语义归这里。
import { beforeAll, describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { V4Intervention, V4Queue, V4TaskCard } from './AgentPanelV4Cards'
import { V4ContextRing } from './AgentPanelV4Context'
import { V4CollapsedLogoDock } from './AgentPanelV4Dock'
import { V4AssistantMessage, V4Thinking, V4UserBubble } from './AgentPanelV4Message'
import { V4ToolReceipt } from './AgentPanelV4Receipt'
import { AgentPanelV4Composer } from './AgentPanelV4Composer'
import type { InterventionData, ToolReceipt, V4InterventionKind, V4TaskStatus, V4ToolStatus } from './agentPanelV4Types'

const el = React.createElement
const html = (node: React.ReactElement): string => renderToStaticMarkup(node)

const TOOL_STATUSES: readonly V4ToolStatus[] = [
  'input-streaming', 'input-available', 'approval-requested', 'approval-responded',
  'output-available', 'output-denied', 'output-error',
]
const TASK_STATUSES: readonly V4TaskStatus[] = ['queued', 'running', 'complete', 'failed', 'stopped']
const SLOT_KINDS: readonly V4InterventionKind[] = [
  'approval-irreversible', 'approval-reversible', 'reject-reason', 'spend',
  'question', 'plan', 'credential', 'deviation',
]

const taskLabels = {
  status: { queued: '排队', running: '生成中', complete: '完成', failed: '失败', stopped: '已停止' },
  adopt: '采用',
  undo: '撤销',
}
const slotLabels = { confirm: '确认', reject: '不要', escalate: '不再问 →', cancel: '取消', confirmReject: '确认不要', collapsePlan: '收起 ▴' }
// `unknown` 是「这个数我们没有」的那个字（环上写「—」而不是「0%」）。接线后它是必填的，
// 因为缺字段是常态：目录没写 contextWindow、供应商不报推理 token，都会走到它。
const contextLabels = { context: '上下文用量', input: '输入', output: '输出', reasoning: '推理', cache: '缓存命中', threadCost: '本线程花费', unknown: '—' }
const usage = { used: 62400, max: 200000, input: '48.1K', output: '9.8K', reasoning: '2.1K', cache: '2.4K', cost: '¥0.83' }

beforeAll(async () => {
  // i18n 是全局单例，`initReactI18next` 注册后 useTranslation 就能拿到它（无需 Provider）。
  Reflect.set(globalThis, 'window', { localStorage: { getItem: () => null, setItem: () => {} } })
  Reflect.set(globalThis, 'document', { documentElement: { lang: '' } })
  await import('../../../i18n/index')
})

describe('① 用户气泡', () => {
  it('附件 chip 在气泡内，不是气泡外另起一行', () => {
    const markup = html(el(V4UserBubble, { text: '收紧结尾', chips: [{ kind: 'file', label: '参考.png' }] }))
    expect(markup).toContain('data-v4-block="user"')
    // chip 必须在同一个气泡 div 里：截断到 block 结束仍应含 chip。
    expect(markup).toContain('data-v4-chip="file"')
    expect(markup.indexOf('data-v4-chip')).toBeGreaterThan(markup.indexOf('data-v4-block="user"'))
  })

  it('暗色下用 ink-10 底而不是纯 ink（token 翻转后纯 ink 会变浅块）', () => {
    expect(html(el(V4UserBubble, { text: 'x', darkMode: true }))).toContain('bg-nomi-ink-10')
    expect(html(el(V4UserBubble, { text: 'x' }))).toContain('bg-nomi-ink ')
  })
})

describe('② 助手文本', () => {
  const labels = { copy: '复制回复', retry: '重来', continue: '继续' }
  it('流式带光标、完成不带', () => {
    expect(html(el(V4AssistantMessage, { text: 'x', status: 'streaming', labels }))).toContain('bg-nomi-ink-30')
    expect(html(el(V4AssistantMessage, { text: 'x', status: 'complete', labels }))).not.toContain('bg-nomi-ink-30')
  })

  it('完成态的复制/重来 hover 才显（默认透明）', () => {
    const markup = html(el(V4AssistantMessage, { text: 'x', status: 'complete', labels }))
    expect(markup).toContain('data-ai-element="actions"')
    expect(markup).toContain('opacity-0')
    expect(markup).toContain('group-hover:opacity-100')
    expect(markup).toContain('复制回复')
    expect(markup).toContain('重来')
  })

  it('中断态出「继续」，且不出复制/重来', () => {
    const markup = html(el(V4AssistantMessage, { text: 'x', status: 'interrupted', labels }))
    expect(markup).toContain('继续')
    expect(markup).not.toContain('data-ai-element="actions"')
  })

  it('思考行带秒数、不带纯转圈', () => {
    const markup = html(el(V4Thinking, { label: '正在想…', meta: '4s · esc 打断' }))
    expect(markup).toContain('data-v4-block="thinking"')
    expect(markup).toContain('4s · esc 打断')
    expect(markup).not.toContain('animate-spin')
  })
})

describe('③ 一行收据 · 七态', () => {
  const base: ToolReceipt = { label: '读取时间轴', action: 'timeline', status: 'output-available' }

  it.each(TOOL_STATUSES)('%s 渲得出且带自己的 data-status', (status) => {
    const markup = html(el(V4ToolReceipt, { receipt: { ...base, status }, statusLabel: '进行中' }))
    expect(markup).toContain(`data-status="${status}"`)
    expect(markup).toContain('读取时间轴')
  })

  it('失败/拒绝走 danger，完成走 success，其余走 accent', () => {
    const tone = (status: V4ToolStatus) => html(el(V4ToolReceipt, { receipt: { ...base, status }, statusLabel: 'x' }))
    expect(tone('output-error')).toContain('text-nomi-danger')
    expect(tone('output-denied')).toContain('text-nomi-danger')
    expect(tone('output-available')).toContain('text-nomi-success')
    expect(tone('input-streaming')).toContain('text-nomi-accent')
  })

  it('没有展开体的行不给 ›（不该给用户一个空按钮）', () => {
    expect(html(el(V4ToolReceipt, { receipt: base, statusLabel: 'x' }))).not.toContain('<details')
    const withBody = html(el(V4ToolReceipt, { receipt: { ...base, input: '{}', output: 'ok' }, statusLabel: 'x' }))
    expect(withBody).toContain('<details')
  })

  it('可撤销的行在行尾多一个撤销', () => {
    expect(html(el(V4ToolReceipt, { receipt: { ...base, undoable: true }, statusLabel: 'x', undoLabel: '撤销' }))).toContain('撤销')
  })
})

describe('④ 任务卡 · 五态', () => {
  it.each(TASK_STATUSES)('%s 渲得出且带状态词', (status) => {
    const markup = html(el(V4TaskCard, { task: { title: '生成 3 张图片', action: 'image', status }, labels: taskLabels }))
    expect(markup).toContain(`data-status="${status}"`)
    expect(markup).toContain(taskLabels.status[status])
  })

  it('采用的候选是 accent 描边 + 角标，不是把整格填成 accent 底', () => {
    const markup = html(el(V4TaskCard, {
      task: { title: 'x', action: 'image', status: 'complete', candidates: [{ tag: '1', adopted: true }, { tag: '2' }] },
      labels: taskLabels,
    }))
    expect(markup).toContain('outline-nomi-accent')
    expect(markup).toContain('data-adopted="true"')
    // 缩略图格本身仍是灰底占位，没有被 accent-soft 盖掉。
    expect(markup).not.toContain('bg-nomi-accent-soft')
    expect(markup).toContain('采用')
  })

  it('失败态带原因和「未扣费」的动作条', () => {
    const markup = html(el(V4TaskCard, {
      task: { title: 'x', action: 'video', status: 'failed', error: '供应商 500 · 未扣费', errorAction: '换模型重试' },
      labels: taskLabels,
    }))
    expect(markup).toContain('data-v4-block="errorbar"')
    expect(markup).toContain('未扣费')
    expect(markup).toContain('换模型重试')
  })

  it('每张卡都能带花费——这是我们要赢 MiniMax 的地方', () => {
    const markup = html(el(V4TaskCard, {
      task: { title: 'x', action: 'image', status: 'running', params: ['2K'], cost: '≈ ¥0.12' },
      labels: taskLabels,
    }))
    expect(markup).toContain('≈ ¥0.12')
    expect(markup).toContain('bg-nomi-warning-soft')
  })
})

describe('⑤ 介入槽 · 八种内容体', () => {
  const of = (kind: V4InterventionKind): InterventionData => ({ kind, title: '标题' })

  it.each(SLOT_KINDS)('%s 渲得出且带自己的 data-kind', (kind) => {
    const markup = html(el(V4Intervention, { data: of(kind), labels: slotLabels }))
    expect(markup).toContain(`data-kind="${kind}"`)
  })

  it('只有**可撤销的改动**显示「不再问 →」——不可逆和花钱的永远逐次问', () => {
    // 接线后「不再问 →」还多一个条件：**调用方真的能执行它**（给了 `onEscalate`）。
    // 没有去处的钮和有去处的钮长得一样，那就是在假装能按——空态发送钮那条同一个道理。
    const hasEscalate = (kind: V4InterventionKind) =>
      html(el(V4Intervention, { data: of(kind), labels: slotLabels, onEscalate: () => undefined })).includes('不再问')
    expect(hasEscalate('approval-reversible')).toBe(true)
    expect(hasEscalate('approval-irreversible')).toBe(false)
    expect(hasEscalate('spend')).toBe(false)
    expect(hasEscalate('credential')).toBe(false)
    // 计划槽画布上没有「不再问」也没有「不要」：它是清单，不勾就是不做。
    expect(hasEscalate('plan')).toBe(false)
  })

  it('计划槽底栏是「主动作 · 改一下 …… 收起 ▴」，不带「不要」', () => {
    const markup = html(el(V4Intervention, {
      data: { kind: 'plan', title: '拆出 4 镜', confirmLabel: '生成 3 镜', alternateLabel: '改一下' },
      labels: slotLabels,
    }))
    expect(markup).toContain('生成 3 镜')
    expect(markup).toContain('改一下')
    expect(markup).toContain('收起 ▴')
    expect(markup).not.toContain('>不要<')
  })

  it('按钮只有「确认 / 不要」，没有第三个主动作', () => {
    const markup = html(el(V4Intervention, { data: of('approval-irreversible'), labels: slotLabels }))
    expect(markup).toContain('确认')
    expect(markup).toContain('不要')
    expect(markup).not.toContain('取消')
  })

  it('反问只有选项 chip，没有确认/不要——选项本身就是回答', () => {
    const markup = html(el(V4Intervention, {
      data: { kind: 'question', title: '用什么画幅？', options: ['16:9', '9:16'], selectedOption: 0 },
      labels: slotLabels,
    }))
    expect(markup).toContain('16:9')
    expect(markup).not.toContain('不要')
  })

  it('拒绝原因是渐进披露的输入 + 取消/确认不要', () => {
    const markup = html(el(V4Intervention, {
      data: { kind: 'reject-reason', title: 'x', reasonPlaceholder: '拒绝原因（可选）' },
      labels: slotLabels,
    }))
    expect(markup).toContain('拒绝原因（可选）')
    expect(markup).toContain('确认不要')
  })
})

describe('⑥ 队列行', () => {
  it('空队列不渲染——一个空框比没有框更吵', () => {
    expect(html(el(V4Queue, { rows: [], labels: { queued: '排队', running: '进行中', complete: '完成' } }))).toBe('')
  })

  it('完成的划掉，进行中的点是 accent', () => {
    const markup = html(el(V4Queue, {
      rows: [{ title: 'a', status: 'complete' }, { title: 'b', status: 'running' }],
      labels: { queued: '排队', running: '进行中', complete: '完成' },
    }))
    expect(markup).toContain('line-through')
    expect(markup).toContain('bg-nomi-accent')
  })
})

const dockLabels = {
  open: '展开 Nomi',
  idle: 'Nomi 在这儿',
  running: '正在做',
  needsConfirm: (count: number) => `等你确认 ${count} 条`,
  done: '刚做完',
  failed: '有一步没成',
}

describe('⑦ 收起坞 · ⑧ Context 环', () => {
  it('收起态是 Nomi logo 钮：运行中冒呼吸点，无障碍名里带着那句状态话', () => {
    const markup = html(el(V4CollapsedLogoDock, { status: 'running', labels: dockLabels }))
    expect(markup).toContain('data-v4-block="dock"')
    expect(markup).toContain('data-agent-dock-status="running"')
    expect(markup).toContain('nomi-logo-mark')
    expect(markup).toContain('data-agent-dock-badge="running"')
    expect(markup).toContain('展开 Nomi · 正在做')
  })

  it('待确认冒的是**条数**，不是一颗没有信息量的点', () => {
    const markup = html(el(V4CollapsedLogoDock, { status: 'needs-confirm', pendingCount: 3, labels: dockLabels }))
    expect(markup).toContain('data-agent-dock-badge="needs-confirm"')
    expect(markup).toContain('>3<')
    expect(markup).toContain('等你确认 3 条')
  })

  it('空闲什么都不叠——「没事」最好的表达是不说话', () => {
    const markup = html(el(V4CollapsedLogoDock, { status: 'idle', labels: dockLabels }))
    expect(markup).not.toContain('data-agent-dock-badge')
    expect(markup).toContain('data-agent-dock-status="idle"')
  })

  it('缺分母时环写「—」而不是「0%」——0% 是一个我们没资格下的断言', () => {
    const markup = html(el(V4ContextRing, { usage: { used: 62400 }, labels: contextLabels, expanded: true }))
    expect(markup).toContain('—')
    expect(markup).not.toContain('0%')
    // 分项一个都没有时那几行整行不渲染，不留 `0` 也不留占位。
    expect(markup).not.toContain('缓存命中')
  })

  it('环显示真实百分比，展开体给 token 分项与花费', () => {
    const markup = html(el(V4ContextRing, { usage, labels: contextLabels, expanded: true }))
    expect(markup).toContain('31%') // 62400 / 200000
    expect(markup).toContain('48.1K')
    expect(markup).toContain('¥0.83')
    // 画布写的是「62.4K / 200K」——230px 的卡里千分位会把这一行挤成两截。
    expect(markup).toContain('62.4K / 200K')
  })
})

describe('⑧ composer 底栏逐件', () => {
  it('底栏是 [+] [模型名] ｜ [Skill] … [权限] [↑]，且没有语音钮', () => {
    const markup = html(el(AgentPanelV4Composer, {}))
    expect(markup).toContain('data-v4-control="model"')
    expect(markup).toContain('data-v4-control="skill"')
    expect(markup).toContain('data-v4-control="permission"')
    expect(markup).toContain('data-v4-control="send"')
    expect(markup).toContain('添加任意文件')
    // 模型钮只显示模型名，没有 icon 跟着它。
    expect(markup).toContain('GPT-5.6')
    expect(markup.toLowerCase()).not.toContain('microphone')
  })

  it('权限三档写进 data 属性，直接对应仓库合同两个字段', () => {
    const attrs = (tier: 'step' | 'safe-auto' | 'project') => html(el(AgentPanelV4Composer, { permission: tier }))
    expect(attrs('step')).toContain('data-approval-mode="step"')
    expect(attrs('step')).toContain('data-spend-policy="confirm"')
    expect(attrs('safe-auto')).toContain('data-approval-mode="safe-auto"')
    expect(attrs('project')).toContain('data-spend-policy="within-budget"')
  })

  it('运行中变 ■ 停止，占位改「排队发送」', () => {
    const running = html(el(AgentPanelV4Composer, { mode: 'running' }))
    expect(running).toContain('排队发送')
    expect(running).toContain('aria-label="停止"')
    const idle = html(el(AgentPanelV4Composer, {}))
    expect(idle).toContain('aria-label="发送"')
  })

  it('Skill 选中后钮上带 accent 小点', () => {
    expect(html(el(AgentPanelV4Composer, { skillSelected: true }))).toContain('aria-pressed="true"')
    expect(html(el(AgentPanelV4Composer, {}))).toContain('aria-pressed="false"')
  })

  it('高度写进 data-height，随面板高度和内容 derive', () => {
    expect(html(el(AgentPanelV4Composer, { panelHeight: 620 }))).toContain('data-height="86"')
    expect(html(el(AgentPanelV4Composer, { panelHeight: 620, value: 'a\nb\nc\nd\ne\nf\ng\nh' }))).toContain('data-height="178"')
    // 同一段 8 行文本：620 高的面板封在 6 行（178），900 高的面板还没到 40% 上限，长满 218。
    expect(html(el(AgentPanelV4Composer, { panelHeight: 900, value: 'a\nb\nc\nd\ne\nf\ng\nh' }))).toContain('data-height="218"')
  })

  it('没有 onValueChange 时 textarea 只读——受控件不假装自己能编辑', () => {
    expect(html(el(AgentPanelV4Composer, { value: '只读' }))).toContain('readonly')
    expect(html(el(AgentPanelV4Composer, { value: '可编辑', onValueChange: () => undefined }))).not.toContain('readonly')
  })
})
