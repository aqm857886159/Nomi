import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function readSource(file: string): string {
  return stripComments(fs.readFileSync(file, 'utf8'))
}

const resident = readSource(
  path.join(process.cwd(), 'src/workbench/ai/ProjectAgentResidentShell.tsx'),
)
const residentPrimitives = readSource(
  path.join(process.cwd(), 'src/workbench/ai/resident/ResidentUiPrimitives.tsx'),
)
const residentProjection = readSource(
  path.join(process.cwd(), 'src/workbench/ai/resident/residentToolProjection.ts'),
)
const residentDisplay = readSource(
  path.join(process.cwd(), 'src/workbench/ai/resident/residentToolDisplay.ts'),
)
const residentReference = readSource(
  path.join(process.cwd(), 'src/workbench/ai/resident/ResidentReferenceChip.tsx'),
)
const residentGenerationEditor = readSource(
  path.join(process.cwd(), 'src/workbench/ai/resident/GenerationProposalEditor.tsx'),
)
const residentBatchStack = readSource(
  path.join(process.cwd(), 'src/workbench/ai/resident/ResidentBatchStack.tsx'),
)
const residentTiming = readSource(
  path.join(process.cwd(), 'src/workbench/ai/resident/residentToolTiming.ts'),
)
const agentContracts = readSource(
  path.join(process.cwd(), 'electron/shared/projectAgentContracts.ts'),
)
const shell = readSource(
  path.join(process.cwd(), 'src/workbench/WorkbenchShell.tsx'),
)
const creation = readSource(
  path.join(process.cwd(), 'src/workbench/creation/CreationWorkspace.tsx'),
)
const generation = readSource(
  path.join(process.cwd(), 'src/workbench/generation/GenerationWorkspace.tsx'),
)
const preview = readSource(
  path.join(process.cwd(), 'src/workbench/preview/PreviewWorkspace.tsx'),
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
    expect(resident).toContain('activeQueue')
    expect(resident).toContain('readableToolSummary')
    expect(resident).toContain('readableToolPreview')
    expect(resident).toContain('useAgentUsageStore')
    expect(resident).toContain('data-agent-usage')
    expect(resident).not.toContain('resultRef ?? t(\'agentResident.waitingApproval\')')
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
      'data-agent-stop',
      'data-agent-context',
      'data-agent-context-focus',
    ]) expect(resident).toContain(control)
    expect(residentPrimitives).toContain('data-agent-queue-item')
    expect(residentPrimitives).toContain('data-agent-tool-header')
    expect(residentPrimitives).toContain('ToolActionIcon')
    expect(residentPrimitives).toContain('data-agent-approval-details')
    expect(resident).toContain('editProjectAgentQueueItem')
    expect(resident).toContain('stopProjectAgentTurn')
    expect(resident).toContain('pending.call.confirm')
    expect(resident).toContain('setAssistantModelPref')
    expect(resident).toContain('projectAgentReferences')
    for (const icon of ['IconPaperclip', 'IconAt', 'IconTool', 'IconPencil', 'IconAdjustmentsHorizontal', 'IconRobot', 'IconArrowUp', 'IconPlayerStopFilled', 'IconChevronLeft', 'IconFocusCentered']) {
      expect(resident).toContain(icon)
    }
    expect(resident).not.toContain('IconSparkles')
    expect(resident).not.toContain('IconNotes')
    expect(resident).not.toContain('IconStack2')
    expect(resident).toContain('motion-safe:hover:-translate-y-px')
    expect(resident).not.toContain("t('agentResident.addToRound')")
    expect(resident).not.toContain("t('agentResident.promptMenuHint')")
    expect(resident).not.toContain("t('agentResident.modeMenuHint')")
    expect(resident).not.toContain('data-agent-action="approve-plan"')
    expect(resident).toContain('title={t(\'agentResident.attachTitle\')}')
    expect(resident).toContain('aria-haspopup="menu"')
    expect(resident).toContain('BodyPortal')
    expect(resident).toContain('anchorRef')
    expect(resident).toContain('data-agent-resident-collapsed="true"')
    expect(resident).toContain('rounded-pill border border-nomi-line')
    expect(resident).not.toContain('CreationPromptPicker')
    expect(resident).not.toContain('AssistantModelPicker')
    expect(resident).not.toContain('<select')
  })

  it('keeps the capability picker complete and tool history progressively disclosed', () => {
    expect(resident).toContain('setSkills(listWorkbenchSkills())')
    expect(resident).not.toContain('listWorkbenchSkills().filter((item) => item.isPlaybook)')
    expect(resident).toContain('item.name} ${item.directoryName} ${item.label}')
    expect(residentPrimitives).toContain("normalized.includes('load_skill')")
    expect(residentPrimitives).toContain('<IconRobot size={13}')
    expect(residentPrimitives).toContain('items.length <= 1 || hasRunningItem')
    expect(residentPrimitives).toContain('if (!nextOpen) setOpenId(null)')
  })

  it('keeps review cards actionable and progressively discloses technical detail', () => {
    expect(resident).toContain('hasContextLocator')
    expect(resident).toContain('data-agent-proposal')
    expect(resident).toContain('proposal={')
    expect(residentDisplay).toContain('readableProposalModel')
    expect(residentDisplay).toContain("replace(/16:9/g")
    expect(residentPrimitives).toContain('data-agent-tool-effect')
    expect(residentPrimitives).toContain('data-agent-tool-target')
    expect(residentPrimitives).toContain('data-agent-tool-result')
    expect(residentPrimitives).toContain('technicalDetails')
    expect(residentPrimitives).toContain('data-agent-proposal-compact')
    expect(residentPrimitives).toContain('data-agent-proposal-estimate')
    expect(residentPrimitives).toContain('data-agent-proposal-details')
    expect(residentPrimitives).toContain('data-agent-proposal-editor-slot')
    expect(residentPrimitives).toContain('data-agent-approval-variant="generation"')
    expect(residentPrimitives).toContain('compactGeneration')
    expect(resident).toContain('isGenerationProposalTool')
    expect(resident).toContain('compactGeneration={compactGeneration}')
    expect(residentPrimitives).toContain('partitionResidentProposalFields')
    expect(residentPrimitives).toContain('queueSummaryLabel')
    expect(residentPrimitives).toContain('queueHiddenLabel')
    expect(residentPrimitives).toContain('whitespace-nowrap')
    expect(residentPrimitives).toContain('aria-label={stopLabel}')
    expect(resident).toContain('ResidentReferenceChip')
    expect(resident).toContain('contextHandleForResidentReference')
    expect(resident).toContain('mergeResidentContextHandles')
    expect(resident).toContain('contextSnapshot,')
    expect(residentReference).toContain('data-agent-reference-role')
    expect(residentReference).toContain('data-agent-reference-kind')
    expect(residentReference).toContain('data-agent-reference-context-bound')
    expect(residentReference).toContain('title={presentation.accessibleLabel}')
    expect(residentPrimitives).toContain('data-agent-tool-active')
    expect(residentPrimitives).toContain('data-agent-tool-elapsed')
    expect(residentTiming).toContain('residentToolElapsedMs')
    expect(resident).toContain("status === 'declined' ? 'declined'")
    expect(residentPrimitives).toContain('data-agent-proposal-prompt')
    expect(residentPrimitives).toContain('<IconMessage')
    expect(residentGenerationEditor).toContain('ResidentBatchStack')
    expect(residentGenerationEditor).toContain('InlineParameterBar')
    expect(residentGenerationEditor).toContain('panelMode="inline"')
    expect(residentGenerationEditor).not.toContain('<select')
    expect(residentBatchStack).toContain('data-agent-batch-stack-peek')
    expect(residentBatchStack).toContain('Math.min(3')
  })

  it('keeps completed tool receipts useful without persisting raw arguments', () => {
    expect(resident).toContain('readResidentToolProjections')
    expect(resident).toContain('writeResidentToolProjections')
    expect(resident).toContain('residentToolProjectionForCall')
    expect(resident).toContain('residentToolProjectionKey')
    expect(residentProjection).toContain('redactResidentSensitiveText')
    expect(residentProjection).toContain('MAX_ENTRIES')
    expect(residentProjection).toContain('MAX_TEXT_LENGTH')
    expect(residentProjection).toContain('Object.fromEntries(entries.map')
    expect(residentProjection).not.toContain('apiKey')
  })

  it('keeps completed proposal receipts compact and locator-aware', () => {
    expect(resident).toContain('data-agent-proposal-receipt')
    expect(resident).toContain("item.status === 'done' ? t('agentResident.approved')")
    expect(resident).toContain('data-agent-action="focus-receipt"')
    expect(resident).toContain('hasContextLocator ?')
  })

  it('keeps queue mutations Host-owned while exposing the typed mutation seam', () => {
    for (const mutation of [
      '"queue.delete"',
      '"queue.move_up"',
      '"queue.move_down"',
      '"queue.pause"',
      '"queue.resume"',
    ]) {
      expect(agentContracts).toContain(mutation)
    }
    expect(resident).not.toContain('projectAgentClient.command')
  })

  it('surfaces generation plan patches only in the disclosed detail layer', () => {
    expect(residentDisplay).toContain('const patch = asRecord(record.patch)')
    expect(residentDisplay).toContain('patch?.prompt')
    expect(residentDisplay).toContain('patch?.modelId')
    expect(residentDisplay).toContain('nestedParameterRecords')
    expect(residentDisplay).toContain('Array.isArray(record.shots)')
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

describe('按钮类入口的意图必须显式声明，不留给猜', () => {
  // 2026-09-03 真实付费复验：拆镜头入口修好了「拿不拿得到分镜工具」（toolProfile），
  // 却漏了「执行还是聊天」（isAgentActionIntent）——同一类机制的第三次复发。
  // Agent 收到指令后回「我先读全文…」然后一次工具都没调，因为它被判成 chat 模式。
  // 两张判据表都必须显式给：我们自己知道用户点了什么，没有任何理由去猜。
  it('sendTurn 的 action 选项压过 isAgentActionIntent 词表', () => {
    expect(resident).toContain('options?.action ?? isAgentActionIntent(text)')
  })

  it('拆镜头 launcher 同时声明 toolProfile 与 action', () => {
    const launcher = resident.slice(resident.indexOf('setStoryboardPlannerLauncher(launch)') - 1200, resident.indexOf('setStoryboardPlannerLauncher(launch)'))
    expect(launcher).toContain("toolProfile: 'storyboard'")
    expect(launcher).toContain('action: true')
  })
})
