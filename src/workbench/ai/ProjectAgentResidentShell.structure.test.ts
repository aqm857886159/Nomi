import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const resident = fs.readFileSync(
  path.join(process.cwd(), 'src/workbench/ai/ProjectAgentResidentShell.tsx'),
  'utf8',
)
const shell = fs.readFileSync(
  path.join(process.cwd(), 'src/workbench/WorkbenchShell.tsx'),
  'utf8',
)
const creation = fs.readFileSync(
  path.join(process.cwd(), 'src/workbench/creation/CreationWorkspace.tsx'),
  'utf8',
)
const generation = fs.readFileSync(
  path.join(process.cwd(), 'src/workbench/generation/GenerationWorkspace.tsx'),
  'utf8',
)
const preview = fs.readFileSync(
  path.join(process.cwd(), 'src/workbench/preview/PreviewWorkspace.tsx'),
  'utf8',
)

describe('ProjectAgentResidentShell production contract', () => {
  it('projects one Host timeline and keeps busy queue actions in the shell', () => {
    expect(resident).toContain('useProjectAgentSnapshot')
    expect(resident).toContain('role="log"')
    expect(resident).toContain('editProjectAgentQueueItem')
    expect(resident).toContain('stopProjectAgentTurn')
    expect(resident).toContain('pending.call.confirm')
    expect(resident).toContain('clearResidentPendingTools(turnId)')
    expect(resident).toContain('residentResolvingTools.has(key)')
    expect(resident).toContain("t('agentResident.task'")
    expect(resident).toContain("t('agentResident.artifact'")
    expect(resident).toContain("t('agentResident.changeModelRetry'")
  })

  it('mounts the same resident projection at each surface slot', () => {
    expect(shell).toContain('createPortal(<ProjectAgentResidentShell surface={agentSurface} />, agentDock)')
    expect(shell).toContain('agentDockRefs.creation')
    expect(shell).toContain('agentDockRefs.generation')
    expect(shell).toContain('agentDockRefs.preview')
    expect(shell).not.toContain('CanvasAssistantEntry')
    expect(shell).not.toContain('generationAi')
  })

  it('keeps PR194 controls separate and routes actions through the Host boundary', () => {
    for (const control of [
      'data-agent-attachment-trigger',
      'data-agent-mention-trigger',
      'data-agent-skill-trigger',
      'data-agent-prompt-trigger',
      'data-agent-mode-trigger',
      'data-agent-model-trigger',
      'data-agent-send',
      'data-agent-context',
      'data-agent-queue-item',
    ]) expect(resident).toContain(control)
    expect(resident).toContain('editProjectAgentQueueItem')
    expect(resident).toContain('stopProjectAgentTurn')
    expect(resident).toContain('pending.call.confirm')
    expect(resident).toContain('setAssistantModelPref')
    expect(resident).toContain('projectAgentReferences')
    for (const icon of ['IconPaperclip', 'IconAt', 'IconTool', 'IconPencil', 'IconAdjustmentsHorizontal', 'IconRobot', 'IconArrowUp', 'IconChevronLeft']) {
      expect(resident).toContain(icon)
    }
    expect(resident).not.toContain('IconSparkles')
    expect(resident).not.toContain('IconNotes')
    expect(resident).not.toContain('IconStack2')
    expect(resident).toContain('motion-safe:hover:-translate-y-px')
    expect(resident).not.toContain("t('agentResident.addToRound')")
    expect(resident).not.toContain("t('agentResident.promptMenuHint')")
    expect(resident).not.toContain("t('agentResident.modeMenuHint')")
    expect(resident).toContain('title={t(\'agentResident.attachTitle\')}')
    expect(resident).toContain('aria-haspopup="menu"')
    expect(resident).toContain('data-agent-resident-collapsed="true"')
    expect(resident).toContain('rounded-pill border border-nomi-line')
    expect(resident).not.toContain('CreationPromptPicker')
    expect(resident).not.toContain('AssistantModelPicker')
    expect(resident).not.toContain('<select')
  })

  it('overlays the collapsed affordance without reserving a sidebar column', () => {
    expect(creation).not.toContain('grid-cols-[240px_minmax(0,1fr)_36px]')
    expect(creation).toContain("'pointer-events-none absolute inset-0 z-40 overflow-visible'")
    expect(generation).toContain("aiCollapsed ? '0px' : assistantTargetWidth")
    expect(generation).toContain("data-ai-layout={hasAssistant ? (aiCollapsed ? 'overlay' : 'sidebar') : 'none'}")
    expect(generation).toContain('pointer-events-none absolute inset-0 z-40 overflow-visible')
    expect(preview).toContain("aiCollapsed ? '0px' : `${assistantWidth}px`")
    expect(preview).toContain("'relative min-w-0 min-h-0 grid overflow-hidden'")
    expect(preview).toContain('pointer-events-none absolute inset-0 z-40 overflow-visible')
  })
})
