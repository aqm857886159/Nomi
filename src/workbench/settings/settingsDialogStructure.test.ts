import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const settingsSource = fs.readFileSync(path.join(process.cwd(), 'src/workbench/settings/SettingsDialog.tsx'), 'utf8')
const taskCenterSource = fs.readFileSync(path.join(process.cwd(), 'src/workbench/taskCenter/TaskCenterPanel.tsx'), 'utf8')

describe('settings dialog structure', () => {
  it('uses the approved five-tab information architecture', () => {
    for (const id of ["'file'", "'ai'", "'automation'", "'general'", "'about'"]) {
      expect(settingsSource).toContain(`id: ${id}`)
    }
    expect(settingsSource).toContain('<AiModelsSection')
    expect(settingsSource).toContain('<AutomationPermissionsSection')
    expect(settingsSource).toContain('sm:flex-row')
    expect(settingsSource).toContain('overflow-x-auto')
  })

  it('keeps video deconstruction permissions in the automation settings surface', () => {
    const automationSource = fs.readFileSync(path.join(process.cwd(), 'src/workbench/settings/AutomationPermissionsSection.tsx'), 'utf8')
    const videoAnalysisSource = fs.readFileSync(path.join(process.cwd(), 'src/workbench/settings/VideoAnalysisSettingsSection.tsx'), 'utf8')
    expect(automationSource)
      .toContain('<VideoAnalysisSettingsSection')
    expect(videoAnalysisSource).toContain('data-settings-section="video-analysis"')
    expect(settingsSource).toContain('initialSection')
    expect(settingsSource).toContain('scrollIntoView')
  })

  it('keeps notification policy in settings instead of duplicating it in task center', () => {
    expect(taskCenterSource).not.toContain('PrefToggle')
    expect(taskCenterSource).not.toContain('writeTaskCenterPrefs')
    expect(settingsSource).toContain('automationPolicy')
  })
})
