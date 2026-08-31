import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const panel = fs.readFileSync(path.join(process.cwd(), 'src/workbench/production/ProductionStatusPanel.tsx'), 'utf8')
const assistant = fs.readFileSync(path.join(process.cwd(), 'src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx'), 'utf8')
const activeRun = fs.readFileSync(path.join(process.cwd(), 'src/workbench/production/useActiveProductionRun.ts'), 'utf8')

describe('production status panel structure', () => {
  it('renders one status, one preview, one primary action, and one details disclosure', () => {
    expect((panel.match(/data-production-status-title/g) ?? []).length).toBe(1)
    expect((panel.match(/data-production-preview/g) ?? []).length).toBe(1)
    expect((panel.match(/data-production-primary-action/g) ?? []).length).toBe(1)
    expect(panel).toContain('<ProductionDetails')
  })

  it('keeps the approval recovery path visible for missing budgets', () => {
    expect(panel).toContain('disabled={actionInFlight}')
    expect(panel).toContain('data-production-focused-artifact')
  })

  it('does not fabricate progress and sits before assistant chat history', () => {
    expect(panel).toContain("typeof view.percent === 'number'")
    expect(panel).not.toContain('?? 0')
    expect(assistant.indexOf('<ProductionStatusPanel')).toBeGreaterThan(-1)
    expect(assistant.indexOf('<ProductionStatusPanel')).toBeLessThan(assistant.indexOf('<AssistantTimeline'))
  })

  it('reacts to the authoritative desktop project instead of waiting for persistence binding', () => {
    expect(activeRun).toContain('useSyncExternalStore')
    expect(activeRun).toContain('subscribeDesktopActiveProjectIdChange')
    expect(activeRun).toContain('getDesktopActiveProjectId')
    expect(activeRun).not.toContain('getActiveWorkbenchProjectId')
  })
})
