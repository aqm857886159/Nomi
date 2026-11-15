import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NomiAgentFace } from '../../../design'
import { AgentBallFace } from './AgentBallFace'
import { agentBallLook, BALL_CLICK_SLOP_PX, createBallDragClickGuard } from './agentFormStore'
import { AGENT_EYE_FOLLOW_RADIUS_PX, agentEyeLook } from './useAgentBallEyeFollow'

// 用 createElement 而不是 JSX：这份测试是 .ts。
const ball = (props: Partial<React.ComponentProps<typeof AgentBallFace>> = {}): string =>
  renderToStaticMarkup(React.createElement(AgentBallFace, { status: 'idle', pendingCount: 0, label: '打开 Nomi', ...props }))

describe('Agent 小球的未读点（10-08 协调拍板：原有功能一个不少）', () => {
  it('收起期间有未读：右上冒一颗强调色小点（外壳共用的 DotMark），条数写进走查锚', () => {
    const markup = ball({ unreadCount: 3 })
    expect(markup).toContain('data-dot-mark')
    expect(markup).toContain('data-agent-dock-unread="3"')
  })

  it('没有未读就安安静静一颗球，不制造假紧迫', () => {
    expect(ball()).not.toContain('data-dot-mark')
  })

  it('「等你确认 N」优先：同时有未读也只出胶囊，不叠点', () => {
    const markup = ball({ status: 'needs-confirm', pendingCount: 2, unreadCount: 3, label: '等你确认 2' })
    expect(markup).toContain('data-agent-ball="pending"')
    expect(markup).not.toContain('data-dot-mark')
  })

  it('出错点占同一个角：出错时不再叠未读点（坏消息由出错点和无障碍名说）', () => {
    const markup = ball({ status: 'failed', unreadCount: 2 })
    expect(markup).toContain('data-agent-ball="failed"')
    expect(markup).not.toContain('data-dot-mark')
  })
})

describe('Agent 形象：状态 → 长相（2026-10-27 拍板，docs/design/boards/2026-10-27-agent-persona/）', () => {
  it('五个状态各一副长相，未读是叠加的点，不是第六种状态', () => {
    expect(agentBallLook('idle', 0, 0)).toEqual({ pose: 'idle', dot: null })
    expect(agentBallLook(null, 0, 0)).toEqual({ pose: 'idle', dot: null })
    expect(agentBallLook('running', 0, 0)).toEqual({ pose: 'running', dot: null })
    expect(agentBallLook('needs-confirm', 2, 0)).toEqual({ pose: 'confirm', dot: null })
    expect(agentBallLook('done', 0, 0)).toEqual({ pose: 'done', dot: null })
    expect(agentBallLook('failed', 0, 0)).toEqual({ pose: 'failed', dot: 'failed' })
    expect(agentBallLook('idle', 0, 3)).toEqual({ pose: 'unread', dot: 'unread' })
  })

  it('优先级照现状：等你确认 > 出错 > 未读；在跑、刚做完时有未读照样挂点（设计卡「实现时的取舍」第 3 条）', () => {
    expect(agentBallLook('needs-confirm', 1, 4)).toEqual({ pose: 'confirm', dot: null })
    expect(agentBallLook('failed', 0, 2)).toEqual({ pose: 'failed', dot: 'failed' })
    expect(agentBallLook('running', 0, 2)).toEqual({ pose: 'running', dot: 'unread' })
    expect(agentBallLook('done', 0, 2)).toEqual({ pose: 'done', dot: 'unread' })
  })

  it('等你确认但条数是 0 不成胶囊：落回空闲（有未读就是有新消息），和 agentBallIsPill 同一个判定', () => {
    expect(agentBallLook('needs-confirm', 0, 0)).toEqual({ pose: 'idle', dot: null })
    expect(agentBallLook('needs-confirm', 0, 1)).toEqual({ pose: 'unread', dot: 'unread' })
  })

  it('画出来的长相跟映射一致，探针语义照旧（data-agent-ball / -dock-status / -dock-count / -dock-unread / -ball-progress）', () => {
    const cases: Array<[Partial<React.ComponentProps<typeof AgentBallFace>>, string, string]> = [
      [{ status: 'idle' }, 'idle', 'idle'],
      [{ status: 'running' }, 'running', 'running'],
      [{ status: 'needs-confirm', pendingCount: 2, label: '等你确认 2' }, 'pending', 'confirm'],
      [{ status: 'done' }, 'done', 'done'],
      [{ status: 'failed' }, 'failed', 'failed'],
      [{ status: 'idle', unreadCount: 3 }, 'idle', 'unread'],
    ]
    for (const [props, probe, pose] of cases) {
      const markup = ball(props)
      expect(markup).toContain(`data-agent-ball="${probe}"`)
      expect(markup).toContain(`data-nomi-agent-face="${pose}"`)
      expect(markup).toMatch(/data-agent-dock-status="[a-z-]+"/)
      expect(markup).toMatch(/data-agent-dock-count="\d+"/)
      expect(markup).toMatch(/data-agent-dock-unread="\d+"/)
      // 在跑那段弧只在真在跑时挂（走查拿它判「在跑」）。
      if (pose === 'running') expect(markup).toContain('data-agent-ball-progress="true"')
      else expect(markup).not.toContain('data-agent-ball-progress')
    }
  })

  it('旧脸删干净：小球里不再有 logo 标（N 字），脸只有一层；按钮仍是唯一能点的原生 button', () => {
    for (const status of ['idle', 'running', 'done', 'failed'] as const) {
      const markup = ball({ status })
      expect(markup).not.toContain('nomi-logo-mark')
      expect(markup.match(/<button/g)).toHaveLength(1)
      expect(markup).toContain('aria-hidden="true" data-nomi-agent-face=')
      expect(markup).toMatch(/class="nomi-agent-face [^"]*pointer-events-none/)
    }
  })

  it('胶囊里写「等你确认 N」，眼睛是 warning 深色；别的长相是白眼、胶囊字不出现', () => {
    const pill = ball({ status: 'needs-confirm', pendingCount: 2, label: '等你确认 2' })
    expect(pill).toContain('等你确认 2</span>')
    expect(pill).toContain('bg-nomi-warning-ink')
    const idle = ball({ status: 'idle', label: '打开 Nomi' })
    expect(idle).not.toContain('打开 Nomi</span>')
    expect(idle).not.toContain('bg-nomi-warning-ink')
    expect(idle).toContain('bg-nomi-media-ink')
  })

  it('减弱动效：形变、跳、扫眼、眨眼、转圈都有 motion-reduce 关掉；在跑那段弧留着（不藏 accent 边）', () => {
    const running = ball({ status: 'running' })
    expect(running).toContain('animate-nomi-agent-spin motion-reduce:animate-none')
    expect(running).toContain('animate-nomi-agent-scan motion-reduce:animate-none')
    expect(running).not.toContain('motion-reduce:border-t-transparent')
    expect(running).toContain('duration-nomi-morph ease-nomi-morph motion-reduce:transition-none')
    expect(ball({ status: 'done' })).toContain('animate-nomi-agent-hop motion-reduce:animate-none')
    expect(ball({ status: 'idle' })).toContain('group-data-[blink]/agent-face:animate-nomi-agent-blink motion-reduce:animate-none')
  })

  it('空闲时没有一直在跑的动画：只有眨眼那条挂在 data-blink 上（定时器加、眨完摘）', () => {
    const idle = ball({ status: 'idle' })
    expect(idle).not.toMatch(/(?<![:\w-])animate-(?!none)/)
    expect(idle).not.toContain('data-blink')
  })
})

describe('身份行的静态脸（AgentIdentityRow 板）', () => {
  const mark = renderToStaticMarkup(React.createElement(NomiAgentFace, { variant: 'mark', size: 16 }))
  it('16px、logo 底色、25% 圆角、两只白眼（与小球空闲同一套几何）', () => {
    expect(mark).toContain('width="16" height="16" viewBox="0 0 22 22"')
    expect(mark).toContain('rx="5.5" fill="var(--nomi-logo-ground)"')
    expect(mark.match(/fill="white"/g)).toHaveLength(2)
    expect(mark).toContain('x="6.2" y="6.6" width="3.4" height="6.6" rx="1.7"')
    expect(mark).toContain('x="12.4" y="6.6" width="3.4" height="6.6" rx="1.7"')
  })
  it('完全静止：没有动画、过渡、眨眼，不带状态', () => {
    expect(mark).not.toMatch(/animate-|transition|data-blink|duration-/)
    expect(mark).toContain('data-nomi-agent-face="mark"')
  })
})

describe('眼睛跟着看（只算方向，不碰 React）', () => {
  const rect = { left: 1000, top: 700, right: 1044, bottom: 744 }
  it('160px 以内往鼠标那边看，以外归位（null）', () => {
    const left = agentEyeLook(rect, 1022 - 100, 722)
    expect(left?.x).toBeLessThan(0)
    expect(left?.y).toBe(0)
    expect(agentEyeLook(rect, 1022 - AGENT_EYE_FOLLOW_RADIUS_PX - 1, 722)).toBeNull()
    const up = agentEyeLook(rect, 1022, 722 - 80)
    expect(up?.x).toBe(0)
    expect(up?.y).toBeLessThan(0)
  })
  it('偏移有上限：左右最多 2.3 个形象单位、上下最多 1.6（44px 舞台上约 3.6 / 2.5px）', () => {
    const far = agentEyeLook(rect, 1022 - 150, 722)!
    expect(Math.abs(far.x)).toBeLessThanOrEqual(3.7)
    const diag = agentEyeLook(rect, 1022 - 50, 722 - 50)!
    expect(Math.abs(diag.x)).toBeLessThanOrEqual(3.7)
    expect(Math.abs(diag.y)).toBeLessThanOrEqual(2.6)
  })
  it('鼠标停在身上：抬眼（只往上 0.8 个单位）', () => {
    expect(agentEyeLook(rect, 1030, 720)).toEqual({ x: 0, y: -1.3 })
  })
  it('胶囊往左长时，看的中心仍是右边那颗球的位置', () => {
    const pill = { left: 912, top: 700, right: 1044, bottom: 744 }
    const look = agentEyeLook(pill, 1022 + 60, 722)
    expect(look?.x).toBeGreaterThan(0)
  })
})

describe('拖完松手不算点击（老 bug：react-rnd 不拦松手时补发的 click；设计卡 ★9 反例「拖完被当成点击」）', () => {
  const manual = () => {
    const pending: Array<() => void> = []
    return { schedule: (reset: () => void) => { pending.push(reset) }, endTask: () => pending.splice(0).forEach((reset) => reset()) }
  }
  it('拖过界：吞掉紧跟的那一次 click、位置该存；下一次正常点击照常开', () => {
    const task = manual()
    const guard = createBallDragClickGuard(task.schedule)
    guard.dragStart({ x: 700, y: 500 })
    expect(guard.dragStop({ x: 580, y: 440 }), '拖了 180px 应算拖动（存位置）').toBe(true)
    expect(guard.takeClick(), '松手补发的那次 click 没被吞，面板会弹开').toBe(false)
    task.endTask()
    expect(guard.takeClick(), '吞完一次之后，下一次正常点击也被吞了').toBe(true)
    expect(guard.takeClick()).toBe(true)
  })
  it('没过界（抖 2–3px）：照常当点击，不存位置', () => {
    const guard = createBallDragClickGuard(manual().schedule)
    guard.dragStart({ x: 700, y: 500 })
    expect(guard.dragStop({ x: 702, y: 501 })).toBe(false)
    expect(guard.takeClick(), '抖一下就不算点击了').toBe(true)
  })
  it('界只有一个数：横纵距离之和到 BALL_CLICK_SLOP_PX 才算拖动', () => {
    const guard = createBallDragClickGuard(manual().schedule)
    guard.dragStart({ x: 0, y: 0 })
    expect(guard.dragStop({ x: BALL_CLICK_SLOP_PX - 2, y: 1 })).toBe(false)
    guard.dragStart({ x: 0, y: 0 })
    expect(guard.dragStop({ x: BALL_CLICK_SLOP_PX - 2, y: 2 })).toBe(true)
  })
  it('拖完指针不在按钮上、没有补发 click：这次松手的任务一结束标记就清掉，下一次真点击不被吞', () => {
    const task = manual()
    const guard = createBallDragClickGuard(task.schedule)
    guard.dragStart({ x: 700, y: 500 })
    expect(guard.dragStop({ x: 400, y: 300 })).toBe(true)
    task.endTask()
    expect(guard.takeClick(), '没补发 click 时，下一次真点击被误吞了').toBe(true)
  })
  it('默认的清标记排在下一个任务（setTimeout 0），不是立刻清', async () => {
    const guard = createBallDragClickGuard()
    guard.dragStart({ x: 0, y: 0 })
    guard.dragStop({ x: 100, y: 0 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(guard.takeClick()).toBe(true)
  })
})
