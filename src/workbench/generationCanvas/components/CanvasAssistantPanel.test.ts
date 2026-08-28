import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx'),
  'utf8',
)
const studioSource = fs.readFileSync(path.join(process.cwd(), 'src/workbench/NomiStudioApp.tsx'), 'utf8')
const creationSource = fs.readFileSync(path.join(process.cwd(), 'src/workbench/creation/CreationAiPanel.tsx'), 'utf8')

describe('CanvasAssistantPanel review-card scrolling', () => {
  it('new content deviations trigger the existing stick-to-bottom effect', () => {
    const effect = source.match(
      /threadBottomRef\.current\?\.scrollIntoView\(\{ block: 'end' \}\)[\s\S]*?\}, \[([^\]]+)\]\)/,
    )
    expect(effect?.[1]).toContain('contentDeviations')
  })

  it('counts a main-executed read from the settled turn instead of renderer pending cards', () => {
    expect(source).toContain('result.response.toolCalls.length === 0')
    expect(source).not.toContain('toolEmittedCount')
  })
})

describe('P2B-RECEIPT-001 production wiring', () => {
  it('passes a prebuilt receipt coordinator into the proposal transaction and has no post-apply writer', () => {
    const coordinator = source.indexOf('const receiptCoordinator = createProposalReceiptCoordinator(')
    const transaction = source.indexOf('const outcome = await applyProposalBatch(')

    expect(coordinator).toBeGreaterThan(-1)
    expect(transaction).toBeGreaterThan(coordinator)
    expect(source.slice(transaction, transaction + 500)).toContain('receiptCoordinator,')
    expect(source).not.toContain('persistCommittedProposal')
  })

  it('recovers an installed durable receipt before project hydration completes', () => {
    const hideStudio = studioSource.indexOf("setView('library')")
    const install = studioSource.indexOf('projectAgentProjectionStore.install(')
    const hydrate = studioSource.indexOf('hydrateCommittedProposalReceipt(opened.proposalReceipt)')
    const recover = studioSource.indexOf('await recoverPendingProposalReceipt()')
    const showStudio = studioSource.indexOf("setView('studio')", recover)

    expect(hideStudio).toBeGreaterThan(-1)
    expect(install).toBeGreaterThan(-1)
    expect(hydrate).toBeGreaterThan(install)
    expect(recover).toBeGreaterThan(hydrate)
    expect(showStudio).toBeGreaterThan(recover)
  })
})

describe('P2B-OWNER-001 / P2B-SHELL-001 Host-derived shell', () => {
  it('uses the shared Host-filtered pending registry in both surfaces', () => {
    expect(source).toContain('createProjectAgentPendingToolRegistry')
    expect(source).toContain("select(projectAgentProjectionStore.getState(), 'canvas')")
    expect(creationSource).toContain('createProjectAgentPendingToolRegistry')
    expect(creationSource).toContain("select(projectAgentProjectionStore.getState(), 'document')")
    expect(creationSource).not.toContain('useCreationTurnStore((state) => state.pendingToolCalls)')
    expect(source).not.toContain('useState<PendingToolCall[]>([])')
  })

  it('derives busy and pending visibility from active Host thread while preserving shell contracts', () => {
    expect(source).toContain('activeCanvasTurnId')
    expect(source).toContain('turn.threadId !== hostSnapshot.activeThreadId')
    for (const token of [
      'attachmentClaims',
      'history: launchHistory',
      'approveCalls={approveCalls}',
      'rejectPending={rejectPending}',
      'runProposalUndo',
      'deviationReport={deviationReport}',
      'onClick={() => {',
    ]) expect(source).toContain(token)
  })
})
