import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '../../design'
import { AgentTopbarChip } from './AgentTopbarChip'
import { agentTopbarChipBadge } from './agentTopbarChipBadge'

// `.tsx` 的测试文件不在 vitest 的 include 里（只收 `.test.ts`），所以用 createElement 而不是 JSX。
const el = React.createElement
const chip = (props: Partial<React.ComponentProps<typeof AgentTopbarChip>> = {}): string =>
  renderToStaticMarkup(el(TooltipProvider, null, el(AgentTopbarChip, {
    reason: 'resident-collapsed',
    label: 'Nomi',
    tooltip: '展开 Nomi · Nomi 在这儿',
    status: 'idle',
    badge: { kind: 'none' },
    onOpen: () => undefined,
    ...props,
  })))

describe('收起角标那一格 · 09-01 定稿 §11.2', () => {
  it('最后一件事坏了：没有新消息也保底冒一颗点，收起不许悄悄吞掉坏消息', () => {
    expect(agentTopbarChipBadge(0, 0, true)).toEqual({ kind: 'dot' })
    // 但它没有条数可言：有真未读时数字仍然只数真未读，不把一个状态算成一条。
    expect(agentTopbarChipBadge(2, 0, true)).toEqual({ kind: 'count', count: 2 })
  })

  it('没动静就安安静静一颗钮，不制造假紧迫', () => {
    expect(agentTopbarChipBadge(0, 0)).toEqual({ kind: 'none' })
    // 负数只可能来自算错，同样按「没动静」处置：宁可少报，不要在顶栏挂一个 -1。
    expect(agentTopbarChipBadge(-3, 0)).toEqual({ kind: 'none' })
  })

  it('一条新动静用一颗蓝点就够', () => {
    expect(agentTopbarChipBadge(1, 0)).toEqual({ kind: 'dot' })
  })

  it('攒了不止一条才值得写出数字', () => {
    expect(agentTopbarChipBadge(2, 0)).toEqual({ kind: 'count', count: 2 })
    expect(agentTopbarChipBadge(7, 0)).toEqual({ kind: 'count', count: 7 })
  })

  it('有待你确认的，哪怕只有一条也写数字——它不点就永远停在那儿', () => {
    expect(agentTopbarChipBadge(1, 1)).toEqual({ kind: 'count', count: 1 })
    expect(agentTopbarChipBadge(4, 2)).toEqual({ kind: 'count', count: 4 })
  })

  it('长相只有两种：一格 8px 分不出五档，分档的活儿归 tooltip', () => {
    const kinds = new Set(
      [[0, 0], [1, 0], [1, 1], [5, 0], [9, 3]].map(([unread, pending]) => agentTopbarChipBadge(unread!, pending!).kind),
    )
    expect([...kinds].sort()).toEqual(['count', 'dot', 'none'])
  })
})

describe('顶栏收起角标的长相 · 09-01 定稿 §11.2', () => {
  it('形态复刻它的邻居：30px 高的 ghost 钮 + 同一枚 NomiLogoMark，窄窗收成方块', () => {
    const markup = chip()
    expect(markup).toContain('nomi-appbar__ghost')
    expect(markup).toContain('h-[30px]')
    expect(markup).toContain('max-[1600px]:w-[30px]')
    // 几何只有一个持有者（P1）：角标不重画一份 N。
    expect(markup).toContain('nomi-logo-mark')
  })

  it('空闲什么都不叠——「没事」最好的表达是不说话', () => {
    // `data-agent-dock-badge-kind="none"` 仍在钮上（走查按它读判断），但那一格本身一个元素都不渲。
    expect(chip()).toContain('data-agent-dock-badge-kind="none"')
    expect(chip()).not.toContain('data-agent-dock-badge="')
  })

  it('一条新动静 = 蓝点 8px（size-2），accent 色', () => {
    const markup = chip({ status: 'running', badge: { kind: 'dot' } })
    expect(markup).toContain('data-agent-dock-badge="dot"')
    expect(markup).toContain('size-2')
    expect(markup).toContain('bg-nomi-accent')
    expect(markup).toContain('data-agent-dock-badge-kind="dot"')
  })

  it('数字徽标复刻 TaskCenterButton 的语法，并把条数写进属性给走查读', () => {
    const markup = chip({ status: 'needs-confirm', badge: { kind: 'count', count: 3 } })
    expect(markup).toContain('data-agent-dock-badge="count"')
    expect(markup).toContain('min-w-4')
    expect(markup).toContain('rounded-pill')
    expect(markup).toContain('tabular-nums')
    expect(markup).toContain('>3<')
    expect(markup).toContain('data-agent-dock-count="3"')
  })

  it('五档状态只进属性与无障碍名，不各画一种图形', () => {
    const markup = chip({ status: 'failed', tooltip: '展开 Nomi · 有一步没成', badge: { kind: 'dot' } })
    expect(markup).toContain('data-agent-dock-status="failed"')
    expect(markup).toContain('aria-label="展开 Nomi · 有一步没成"')
    // 失败也只是那颗蓝点：坏消息由 tooltip 说清，不在 8px 里另画一个警示三角。
    expect(markup).toContain('data-agent-dock-badge="dot"')
  })

  it('首帧不脉冲——一进来就闪一下等于开机自带一条假动静', () => {
    expect(chip({ badge: { kind: 'dot' }, settleKey: 'x' })).not.toContain('data-agent-dock-settle')
  })
})
