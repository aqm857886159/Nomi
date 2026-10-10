import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentBallFace } from './AgentBallFace'

// `.tsx` 的测试文件不在 vitest 的 include 里（只收 `.test.ts`），所以用 createElement 而不是 JSX。
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
