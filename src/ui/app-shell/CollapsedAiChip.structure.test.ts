import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const stripComments = (value: string): string => value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (relative: string): string => stripComments(fs.readFileSync(path.join(process.cwd(), relative), 'utf8'))
const chip = read('src/ui/app-shell/CollapsedAiChip.tsx')
const appBar = read('src/ui/app-shell/NomiAppBar.tsx')

describe('顶栏收起角标 · C-03 + 09-01 定稿 §11.2', () => {
  it('两个理由共用同一颗钮——「同格只出一颗」不能靠自觉维持', () => {
    // 常驻面板收起（主路，四个面通用）与拆解互斥让位（过渡期）都从这一个组件出去。
    // 拆成两个各自返 null 的组件，双显就只差某一天两边的条件各漂一点。
    expect(chip).toContain('reason="resident-collapsed"')
    expect(chip).toContain('reason="deconstruction-exclusive"')
    expect(chip.match(/<AgentTopbarChip/g)).toHaveLength(2)
    // 主路优先且**提前 return**：判断在第二次渲染之前就已经把分支择掉，两条路不可能同时走。
    expect(chip.indexOf('if (dockStatus)')).toBeLessThan(chip.indexOf('reason="resident-collapsed"'))
    expect(chip.indexOf('reason="resident-collapsed"')).toBeLessThan(chip.indexOf('reason="deconstruction-exclusive"'))
  })

  it('落位是顶栏右簇「浏览器」与「设置」之间那一格', () => {
    const assist = appBar.indexOf("nomi-appbar__group--assist")
    const badge = appBar.indexOf('<CollapsedAiChip')
    const config = appBar.indexOf("nomi-appbar__group--config")
    expect(assist).toBeGreaterThan(-1)
    expect(badge).toBeGreaterThan(assist)
    expect(config).toBeGreaterThan(badge)
  })

  it('两个理由各自还原各自的东西，且只在真有动静时冒角标', () => {
    expect(chip).toContain('expandResident(false)')
    expect(chip).toContain('expandGeneration(false)')
    expect(chip).toContain("agentTopbarChipBadge(dockUnreadCount, dockPendingCount, dockStatus === 'failed')")
    expect(chip).toContain('agentTopbarChipBadge(generationMessageCount, 0)')
  })

  it('收起角标不再画在面板自己的地盘上（P1：加新必删旧）', () => {
    const dock = read('src/workbench/ai/v4/AgentPanelV4Dock.tsx')
    const shell = read('src/workbench/ai/ProjectAgentResidentShell.tsx')
    expect(dock).not.toContain('V4CollapsedLogoDock')
    expect(dock).not.toContain('V4CollapsedRail')
    expect(shell).not.toContain('V4CollapsedLogoDock')
  })
})
