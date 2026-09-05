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
const residentMenus = readSource(
  path.join(process.cwd(), 'src/workbench/ai/resident/ResidentMenus.tsx'),
)
const residentUi = `${resident}\n${residentMenus}`
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
const residentExceptions = readSource(
  path.join(process.cwd(), 'src/workbench/ai/resident/ResidentExceptionStates.tsx'),
)
const residentGenerationEditor = readSource(
  path.join(process.cwd(), 'src/workbench/ai/resident/GenerationProposalEditor.tsx'),
)
const reconcileCard = readSource(
  path.join(process.cwd(), 'src/workbench/generationCanvas/components/ReconcileDeviationCard.tsx'),
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
    expect(resident).toContain('data-agent-usage-pill')
    expect(resident).toContain('data-agent-compaction-line')
    expect(resident).toContain('runtimeContext?.compactions')
    expect(resident).not.toContain('resultRef ?? t(\'agentResident.waitingApproval\')')
    expect(resident).toContain("t('agentResident.task'")
    expect(resident).toContain("t('agentResident.artifact'")
    expect(resident).toContain("t('agentResident.changeModelRetry'")
  })

  it('registers the creation storyboard action on the resident Agent lifecycle', () => {
    expect(resident).toContain('const sendTurn = React.useCallback')
    expect(resident).toContain("toolProfile: 'storyboard'")
    expect(resident).toContain("t('agentResident.storyboardRequest')")
    expect(resident).toContain('setStoryboardPlannerLauncher(launch)')
    expect(resident).toContain('return () => setStoryboardPlannerLauncher(null)')
  })

  it('renders the formal stopped marker on a retained assistant item', () => {
    expect(resident).toContain("item.kind === 'assistant' ? <><div data-agent-reply")
    expect(resident).toContain("item.status === 'stopped' ? <span data-agent-status-label=\"stopped\"")
    expect(resident).toContain('data-agent-status-label="stopped"')
    expect(resident).toContain('statusLabel(t, item.status)')
  })

  it('exposes only allowlisted failure diagnostics for truthful runner classification', () => {
    expect(resident).toContain('safeAgentFailureCode')
    expect(resident).toContain('agentFailureCategory')
    expect(resident).toContain('data-agent-error-code={failureCode}')
    expect(resident).toContain('data-agent-error-message-category={failureCategory}')
    expect(resident).not.toContain('data-agent-error-message={item.message}')
  })

  it('mounts the same resident projection at each surface slot', () => {
    expect(shell).toContain('createPortal(<ProjectAgentResidentShell surface={agentSurface} />, agentDock)')
    expect(shell).toContain('agentDockRefs.creation')
    expect(shell).toContain('agentDockRefs.generation')
    expect(shell).toContain('agentDockRefs.preview')
    expect(shell).not.toContain('CanvasAssistantEntry')
    expect(shell).not.toContain('generationAi')
  })

  it('keeps direct workspace mode actions reflected in the URL projection', () => {
    expect(shell).toContain('writeWorkspaceModeToUrl(workspaceMode)')
    expect(shell).toMatch(/useEffect\(\(\) => \{\s*writeWorkspaceModeToUrl\(workspaceMode\)/)
  })

  it('keeps PR194 controls separate and routes actions through the Host boundary', () => {
    for (const control of [
      'data-agent-composer-attach',
      'data-agent-composer-prompt',
      'data-agent-composer-mode',
      'data-agent-composer-model',
      'data-agent-composer-send',
    ]) expect(resident).toContain(control)
    expect(resident).toContain('data-agent-queue-row')
    expect(resident).toContain('data-agent-queue-actions')
    expect(residentPrimitives).toContain('data-agent-tool-header')
    expect(residentPrimitives).toContain('ToolActionIcon')
    expect(residentPrimitives).toContain('data-agent-approval-details')
    expect(resident).toContain('editProjectAgentQueueItem')
    expect(resident).toContain('stopProjectAgentTurn')
    expect(resident).toContain('pending.call.confirm')
    expect(resident).toContain('setAssistantModelPref')
    expect(resident).toContain("window.addEventListener('nomi-model-catalog-changed', loadModels)")
    expect(resident).toContain("window.removeEventListener('nomi-model-catalog-changed', loadModels)")
    expect(resident).toContain('projectAgentReferences')
    for (const icon of ['IconPaperclip', 'IconBolt', 'IconTool', 'IconPencil', 'IconRobot', 'IconArrowUp', 'IconPlayerStopFilled', 'IconChevronLeft', 'IconFocusCentered']) {
      expect(resident).toContain(icon)
    }
    expect(resident).toContain("event.key === '@'")
    expect(resident).toContain('data-agent-references')
    expect(resident).toContain('data-agent-model-alert')
    expect(resident).not.toContain('data-agent-mention-trigger')
    expect(resident).not.toContain('data-agent-skill-trigger')
    expect(resident).not.toContain('data-agent-context')
    expect(resident).not.toContain('IconSparkles')
    expect(resident).not.toContain('IconNotes')
    expect(resident).not.toContain('IconStack2')
    expect(residentUi).toContain('motion-safe:hover:-translate-y-px')
    expect(resident).not.toContain("t('agentResident.addToRound')")
    expect(resident).not.toContain("t('agentResident.promptMenuHint')")
    expect(resident).not.toContain("t('agentResident.modeMenuHint')")
    expect(resident).not.toContain('data-agent-action="approve-plan"')
    expect(resident).toContain('title={t(\'agentResident.attachTitle\')}')
    expect(resident).toContain('aria-haspopup="menu"')
    expect(residentUi).toContain('BodyPortal')
    expect(residentUi).toContain('anchorRef')
    expect(resident).toContain('data-agent-resident-collapsed="true"')
    expect(resident).toContain('rounded-pill border border-nomi-line')
    expect(resident).not.toContain('CreationPromptPicker')
    expect(resident).not.toContain('AssistantModelPicker')
    expect(resident).not.toContain('<select')
  })

  it('keeps the capability picker complete and tool history progressively disclosed', () => {
    expect(resident).toContain('setSkills(listWorkbenchSkills())')
    expect(resident).toContain('const filteredSkills = skills')
    expect(resident).toContain('skillCapabilityFor(skill, availableSkillProviders)')
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
    expect(resident).toContain('data-agent-queue')
    expect(resident).toContain('data-agent-queue-remove')
    expect(residentPrimitives).toContain('data-agent-tool-detail')
    expect(resident).toContain('data-agent-stop')
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
    // 2026-09-05：状态→文案从三目链改成整键查表（拼 `agentResident.${key}` 会让死键门岗
    // 对整棵 agentResident 失明）。断言跟着搬到查表项上，钉的还是「declined 有自己的文案」。
    expect(resident).toContain("declined: 'agentResident.declined'")
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

  it('covers the approved P0 exception hooks and thresholds', () => {
    for (const hook of [
      'data-agent-plan-card', 'data-agent-spend-card', 'data-agent-write-failure',
      'data-agent-artifact-card', 'data-agent-deviation-card', 'data-agent-candidates-card',
      'data-agent-question-card', 'data-agent-at-picker', 'data-at-search',
    ]) expect(residentExceptions + residentUi).toContain(hook)
    for (const contract of [
      "data-state=\"loading\"", "data-state=\"failed\"", 'data-state={state}',
      'data-state={amount === null ? \'price-failed\' : \'ready\'}',
      'max-h-[220px]', 'max-h-[280px]', 'slice(0, 5)', 'slice(0, 4)',
      'candidates.length > 3', 'assets.length > 50', 'activeQueue.length > 3',
    ]) expect(residentExceptions + residentUi + resident).toContain(contract)
    expect(resident).toContain('activeQueue.slice(0, queueExpanded ? activeQueue.length : 3)')
    expect(residentExceptions).toContain('data-agent-write-failure="true"')
  })

  it('keeps usage details behind the resident header pill', () => {
    expect(resident).toContain('data-agent-usage-pill')
    expect(resident).toContain('usagePopoverRound')
    expect(resident).toContain('usagePopoverTotal')
    expect(resident).toContain('usagePopoverCost')
    expect(resident).toContain('onMouseEnter={() => setUsageOpen(true)}')
  })

  it('exposes the stream cursor only while an assistant item is live', () => {
    expect(resident).toContain('data-agent-stream-cursor="true"')
    expect(resident).toContain('isLive(item.status)')
  })

  it('mounts canvas shot verification deviations in the resident Host surface', () => {
    expect(resident).toContain("import ReconcileDeviationCard from '../generationCanvas/components/ReconcileDeviationCard'")
    expect(resident).toContain("useShotVerifyStore((state) => state.deviations)")
    expect(resident).toContain('data-agent-shot-verify="true"')
    expect(reconcileCard).toContain('data-reconcile-deviation-card="true"')
    expect(resident).toContain('onAiFix={requestContentFix}')
    expect(resident).toContain('buildContentFixMessage(current)')
    expect(resident).toContain('useShotVerifyStore.getState().markFixing()')
    expect(resident).toContain("surface === 'generation' && contentDeviations.length > 0")
  })

  it('keeps completed proposal receipts compact and locator-aware', () => {
    expect(resident).toContain('data-agent-proposal-receipt')
    expect(resident).toContain("item.status === 'done' ? t('agentResident.approved')")
    expect(resident).toContain('data-agent-action="focus-receipt"')
    expect(resident).toContain('hasContextLocator ?')
  })

  it('keeps the durable committed result visible in the fixed resident area', () => {
    expect(resident).toContain('ResidentPinnedResultCard')
    expect(resident).toContain('data-agent-result-card-area')
    expect(resident).toContain("summaryLabel={(total, selected) => t('agentResident.planSummary', { total, selected })}")
    expect(resident).toContain("openLabel={t('agentResident.pinnedOpen')}")
    expect(resident).toContain("collapseLabel={t('agentResident.pinnedCollapse')}")
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
