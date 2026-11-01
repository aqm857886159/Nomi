import { encodeStructuredErrorMessage } from '../../../electron/vendor/vendorHttp'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MantineProvider } from '@mantine/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import * as classifier from './classifyError'
import { GENERATION_ERROR_KINDS, narrateErrorActionLabel, narrateGenerationError, narrateGenerationErrorActions } from './narrate'
import { generationFailureActions } from './generationFailureActions'
import { NodeFailureReport } from '../generationCanvas/nodes/NodeErrorReport'
import { ListCardMedia } from '../generation/list/GenerationListParts'
import { GenerationListCardView } from '../generation/list/GenerationListCard'
import { GenerationListDetail, DetailRail } from '../generation/list/GenerationListDetail'
import { deriveGenerationList } from '../generation/list/generationListModel'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useGenerationQueueStore } from '../generationCanvas/runner/generationQueueStore'
import { createGenerationNode } from '../generationCanvas/model/graphOps'
import { deriveAnchorCardRuntimes, deriveShotRowExec } from '../creation/storyboard/exec/storyboardRowStatus'
import StoryboardAnchorRow from '../creation/storyboard/anchorZone/StoryboardAnchorRow'
import StoryboardFrameActions from '../creation/storyboard/shotRow/StoryboardFrameActions'
import StoryboardShotFrame from '../creation/storyboard/shotRow/StoryboardShotFrame'

vi.mock('../generationCanvas/nodes/LazyNodeGenerationComposer', () => ({ default: () => <div data-composer-probe /> }))
const noop = () => {}
const plan = { title: 'fixture', anchors: [{ id: 'a', name: 'role', kind: 'character' as const, carrier: 'visual' as const, prompt: 'role' }], shots: [{ shotId: 's', index: 1, shotKind: 'image' as const, durationSec: 5, anchorIds: [], prompt: 'fixture' }] }
const render = (element: React.ReactNode) => renderToStaticMarkup(<MantineProvider>{element}</MantineProvider>)
beforeEach(async () => { await i18n.changeLanguage('en'); useGenerationQueueStore.setState({ entries: [], batches: {} }) })
afterEach(() => vi.restoreAllMocks())

describe('every kind × all five failure surfaces', () => {
  it.each(GENERATION_ERROR_KINDS)('%s has one reason/retry answer and no dead end', (kind) => {
    const report = { kind, ...narrateGenerationError(kind), ...narrateGenerationErrorActions(kind), raw: 'Error invoking remote method: fixture', vendorSide: false }
    vi.spyOn(classifier, 'classifyGenerationError').mockReturnValue(report)
    const node = { ...createGenerationNode({ id: 'surface-node', kind: 'image' }), status: 'error' as const, error: report.raw, meta: { storyboardDesignId: 'd', shotId: 's' }, runs: [{ id: 'canvas-record', status: 'error' as const, startedAt: 1, updatedAt: 1 }] }
    const anchor = { ...node, id: 'anchor-node', meta: { storyboardDesignId: 'd', anchorId: 'a' } }
    const exec = deriveShotRowExec({ plan, shot: plan.shots[0], designId: 'd', nodes: [node], mode: null })
    const runtime = deriveAnchorCardRuntimes({ plan, designId: 'd', nodes: [anchor] })[0]
    const store = useGenerationCanvasStore.getState()
    store.restoreSnapshot({ nodes: [node], edges: [], groups: [], selectedNodeIds: [] })
    const server = useGenerationCanvasStore.getInitialState()
    const saved = server.nodes
    server.nodes = useGenerationCanvasStore.getState().nodes
    try {
      const model = deriveGenerationList({ nodes: [node], edges: [], groups: [], designsByDocumentId: {}, imageModelOptions: [], videoModelOptions: [] })
      const surfaces = [
        render(<NodeFailureReport node={node} onFeedback={noop} />),
        render(<GenerationListDetail card={model.sections[0].cards[0]} onBack={noop} />),
        render(<ListCardMedia node={node} kind="image" height={200} />),
        render(<><StoryboardShotFrame shot={plan.shots[0]} exec={exec} aspect="16:9" box={{ width: 136, height: 77 }} /><StoryboardFrameActions exec={exec} variants={[]} onGenerate={noop} /></>),
        render(<StoryboardAnchorRow runtime={runtime} aspect="16:9" onUpdate={noop} onChangeKind={noop} onRemove={noop} onGenerate={noop} onRegenerate={noop} onToggleLock={noop} />),
      ]
      const decision = generationFailureActions(report.raw, node.runs[0])
      const escapedReason = renderToStaticMarkup(<span>{decision.reason}</span>).slice(6, -7)
      for (const [index, html] of surfaces.entries()) {
        expect(html, `surface ${index} reason`).toContain(escapedReason)
        if (index === 2) { expect(html).not.toContain('<button'); continue }
        expect(html, `surface ${index} action`).toContain('<button')
        if (index < 2) expect(html).toContain('role="alert"')
        if (index >= 3) expect(html).toContain('data-storyboard-failure-actions')
        if (index >= 3 && decision.primary === 'reconcile') expect(html).toContain(renderToStaticMarkup(<span>{narrateErrorActionLabel('reconcile', 'primary')}</span>).slice(6, -7))
        if (decision.secondary === 'release-regenerate') expect(html).toContain(renderToStaticMarkup(<span>{i18n.t('generationCommon.observability.action.releaseRegenerate.alt')}</span>).slice(6, -7))
        const retry = index >= 3 ? 'data-storyboard-retry-state=' : decision.primary === 'retry' ? `aria-label="${i18n.t('generationCommon.observability.action.retry.main')}"` : `>${i18n.t('generationCommon.observability.action.retry.alt')}<`
        expect(html.includes(retry), `surface ${index} retry`).toBe(decision.canRetry)
      }
    } finally { server.nodes = saved }
  })

  it('E3: rejected/failed row retry becomes clickable again when its action settles', () => {
    const node = { ...createGenerationNode({ id: 'retry-node', kind: 'image' }), status: 'error' as const, error: '429 rate limit', meta: { storyboardDesignId: 'd', shotId: 's' } }
    const exec = deriveShotRowExec({ plan, shot: plan.shots[0], designId: 'd', nodes: [node], mode: null })
    const row = (busy: boolean) => render(<StoryboardFrameActions exec={exec} variants={[]} onGenerate={noop} actionBusy={busy} />)
    expect(row(true)).toContain('data-storyboard-retry-state="busy"')
    expect(row(true)).toContain('disabled=""')
    expect(row(false)).toContain('data-storyboard-retry-state="idle"')
    expect(row(false)).not.toContain('disabled=""')
  })
})

it('E4: list card and narrow rail show queued from the real queue, never draft/not generated', () => {
  const node = { ...createGenerationNode({ id: 'queued-surface', kind: 'image' }), prompt: 'queue fixture' }
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node], edges: [], groups: [], selectedNodeIds: [] })
  useGenerationQueueStore.getState().enqueueBatch([[node.id]], 'fixture-project')
  const model = deriveGenerationList({ nodes: [node], edges: [], groups: [], designsByDocumentId: {}, imageModelOptions: [], videoModelOptions: [] })
  const serverCanvas = useGenerationCanvasStore.getInitialState(), serverQueue = useGenerationQueueStore.getInitialState()
  const savedNodes = serverCanvas.nodes, savedEntries = serverQueue.entries
  serverCanvas.nodes = [node]; serverQueue.entries = useGenerationQueueStore.getState().entries
  try {
    const card = model.sections[0].cards[0]
    const html = render(<GenerationListCardView card={card} defaultAspect={null} modelLabel={() => ''} onSelect={noop} onOpenInCanvas={noop} />)
    expect(html).toContain(i18n.t('generationCommon.observability.progress.queued'))
    expect(html).not.toContain('data-list-card-kind="draft"')
    expect(html).not.toContain(i18n.t('generationList.notGenerated'))
    const rail = render(<DetailRail sections={model.sections} activeKey={card.key} onSelect={noop} />)
    expect(rail).toContain(i18n.t('generationCommon.observability.progress.queued'))
    expect(rail).not.toContain(i18n.t('generationList.notGenerated'))
  } finally { serverCanvas.nodes = savedNodes; serverQueue.entries = savedEntries }
})

it('E5: a real in-flight refusal in the shot action bar offers task viewing and never retry', () => {
  const error = encodeStructuredErrorMessage({ code: 'node_generation_in_flight', reason: 'in_flight' }, 'active')
  const node = { ...createGenerationNode({ id: 'in-flight-node', kind: 'image' }), status: 'error' as const, error, meta: { storyboardDesignId: 'd', shotId: 's' } }
  const exec = deriveShotRowExec({ plan, shot: plan.shots[0], designId: 'd', nodes: [node], mode: null })
  const html = render(<StoryboardFrameActions exec={exec} variants={[]} onGenerate={noop} />)
  expect(html).not.toContain('data-storyboard-retry-state')
  expect(html).toContain(i18n.t('generationCommon.observability.action.viewTask.main'))
})

it('E7: an anchor with retained media still exposes free retrieval when the latest run is recoverable', () => {
  const node = { ...createGenerationNode({ id: 'retained-anchor', kind: 'image' }), status: 'recoverable' as const,
    meta: { storyboardDesignId: 'd', anchorId: 'a' }, result: { id: 'old-image', type: 'image' as const, url: 'https://fixture.invalid/old.png', createdAt: 1 } }
  const runtime = deriveAnchorCardRuntimes({ plan, designId: 'd', nodes: [node] })[0]
  const html = render(<StoryboardAnchorRow runtime={runtime} aspect="16:9" onUpdate={noop} onChangeKind={noop} onRemove={noop} onGenerate={noop} onRegenerate={noop} onToggleLock={noop} onRecover={noop} />)
  expect(html).toContain('data-anchor-face="recoverable"')
  expect(html).toContain(i18n.t('generationCommon.production.runAction.retry-retrieval'))
})
