import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const stripComments = (value: string): string => value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (relative: string): string => stripComments(fs.readFileSync(path.join(process.cwd(), relative), 'utf8'))
const chip = read('src/ui/app-shell/CollapsedAiChip.tsx')
const appBar = read('src/ui/app-shell/NomiAppBar.tsx')

describe('顶栏收起角标 · C-03 + 09-01 定稿 §11.2', () => {
  it('拆解移入画布后只保留常驻面板角标，不再互斥占用右栏', () => {
    expect(chip).toContain('reason="resident-collapsed"')
    expect(chip.match(/<AgentTopbarChip/g)).toHaveLength(1)
    expect(chip).not.toContain('deconstruction-exclusive')
    expect(chip).not.toContain('videoDeconstruction')
    expect(read('src/workbench/NomiStudioApp.tsx')).not.toContain('DeconstructionPanelHost')
    expect(read('src/workbench/generationCanvas/nodes/NodeVideoFrameToolbar.tsx')).toContain('deconstructToShotTable')
    expect(chip.indexOf('if (dockStatus)')).toBeLessThan(chip.indexOf('reason="resident-collapsed"'))
  })

  it('落位是顶栏右簇「浏览器」与「设置」之间那一格', () => {
    const assist = appBar.indexOf("nomi-appbar__group--assist")
    const badge = appBar.indexOf('<CollapsedAiChip')
    const config = appBar.indexOf("nomi-appbar__group--config")
    expect(assist).toBeGreaterThan(-1)
    expect(badge).toBeGreaterThan(assist)
    expect(config).toBeGreaterThan(badge)
  })

  it('常驻角标还原面板，且只在真有动静时冒角标', () => {
    expect(chip).toContain('expandResident(false)')
    expect(chip).not.toContain('expandGeneration')
    expect(chip).toContain("agentTopbarChipBadge(dockUnreadCount, dockPendingCount, dockStatus === 'failed')")
    expect(chip).not.toContain('generationMessageCount')
  })

  it('收起角标不再画在面板自己的地盘上（P1：加新必删旧）', () => {
    const dock = read('src/workbench/ai/v4/AgentPanelV4Dock.tsx')
    const shell = read('src/workbench/ai/ProjectAgentResidentShell.tsx')
    expect(dock).not.toContain('V4CollapsedLogoDock')
    expect(dock).not.toContain('V4CollapsedRail')
    expect(shell).not.toContain('V4CollapsedLogoDock')
  })
})
