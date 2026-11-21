import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentOfferFrom, NO_CURRENT_OFFER, resolveNamedGenerationShots, resolveUndecidedGenerationShotScope, planGenerationScope, hasSelectableScopeRow, type GenerationScopeIntent } from './generationShotScope'
import { currentPresentation, generationPresentationOutcome } from '../productionGenerationPresentation'
import { presentGenerationPlan } from '../../productionRun/productionGenerationPresentationEdits'
import { sealScopeOf } from '../../productionRun/productionGenerationSeal'
import { presentStoryboardAuthoring, resolveGateScope } from '../../capabilityCore/mcpGenerationMultiShot'
import { createPiGenerationTransportAdapter } from '../../capabilityCore/generationTransportAdapters'
import { GENERATION_METHODS } from './generation'
import { OPERATION_ID, PROJECT_ID, callTool, lease, now, resetSpendFixture, shotsDraft, spendWorld, type SpendWorld } from '../../capabilityCore/agentPanelSpendConfirmTestUtils'
import { scopeFactsOf, planCanvasGenerationScope, storyboardRowScopeItem } from '../../../src/workbench/generationCanvas/runner/generationScopeFacts'
import { groupGenerateRows, hasGroupGenerateCandidates, runGroupGenerate } from '../../../src/workbench/generationCanvas/components/groupGenerate'
import { useGenerationCanvasStore } from '../../../src/workbench/generationCanvas/store/generationCanvasStore'
import { useProductionCanvasLandingStore } from '../../../src/workbench/production/productionCanvasLandingStore'
import { createGenerationNode } from '../../../src/workbench/generationCanvas/model/graphOps'
import { deriveStoryboardBatch, type StoryboardRowWithExec } from '../../../src/workbench/creation/storyboard/exec/storyboardRowStatus'
import { presentStoryboard } from '../../../src/workbench/capability/storyboardPresent'
import { useWorkbenchStore } from '../../../src/workbench/workbenchStore'
import * as rowActions from '../../../src/workbench/creation/storyboard/exec/storyboardRowActions'
import * as modelOptions from '../../../src/config/useModelOptions'
import * as projectActions from '../../../src/workbench/project/projectCanvasReadSurface'
import * as projectDelivery from '../../../src/workbench/generationCanvas/runner/runProjectDelivery'

const confirmation = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => 'declined'))
vi.mock('../../../src/workbench/generationCanvas/components/batchPlanPreview', () => ({ confirmAndRunPlan: confirmation }))

afterEach(() => {
  vi.restoreAllMocks()
  resetSpendFixture()
  confirmation.mockClear()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  useProductionCanvasLandingStore.setState({ runs: {} })
})

describe('selected storyboard · lane, renderer and external Agent receipt', () => {
  it.each([undefined, ['shot-2'], ['shot-3', 'shot-1'], [], ['shot-9'], ['shot-1', 'shot-1']].map(requested => ({ requested })))('requested $requested', async ({ requested }) => {
    const ids = ['shot-1', 'shot-2', 'shot-3']
    const expected = answer(() => resolveUndecidedGenerationShotScope({ door: 'present', planShotIds: ids,
      requested, currentOffer: NO_CURRENT_OFFER, offerable: ids }))
    const selected = answer(() => resolveUndecidedGenerationShotScope({ door: 'present', planShotIds: ['shot-1', 'shot-3'],
      requested, currentOffer: NO_CURRENT_OFFER, offerable: ['shot-1', 'shot-3'] }))
    const planning = vi.fn(async ({ params }: { params: Record<string, unknown> }) => ({ shots: params.shotIds }))
    const adapter = createPiGenerationTransportAdapter({ projectId: PROJECT_ID, immutableProjectUuid: 'uuid-1', projectGeneration: 1 }, { planning, leaseFor: () => lease })
    try {
      const result = await adapter.tryExecute({ toolCallId: 'scope-parity', toolName: GENERATION_METHODS.plan,
        args: { operation: 'present', operationId: 'design', ...(requested === undefined ? {} : { shotIds: requested }) } }, new AbortController().signal,
      { storyboardTarget: { projectId: PROJECT_ID, sourceDocumentId: 'doc', sourceDocumentRevision: 1, sourceDocumentContentHash: 'hash',
        targetKind: 'storyboard', requestId: 'request', plans: [{ id: 'design', title: 'Design' }], designId: 'design', shotIds: ['shot-1', 'shot-3'] } })
      if (selected.error) {
        expect(result).toMatchObject({ ok: false, ...selected.error })
        expect(planning).not.toHaveBeenCalled()
      } else {
        expect(result).toMatchObject({ ok: true, result: { shots: selected.value } })
        expect(planning.mock.calls[0][0].params.shotIds, 'scope sent across the planning boundary').toEqual(selected.value)
      }
    } finally { adapter.dispose() }

    const store = useWorkbenchStore.getState()
    store.hydrateWorkbenchDocuments([{ id: 'doc', version: 1, title: 'Doc', updatedAt: 1, contentJson: { type: 'doc', content: [] } }], 'doc')
    store.hydrateStoryboardDesigns({})
    store.addStoryboardDesign({ initiator: 'agent', documentId: 'doc', identity: { id: 'design', title: 'Design' },
      source: { title: 'Design', anchors: [], shots: ids.map((shotId, index) => ({ index: index + 1, shotId, shotKind: 'image', durationSec: 2, anchorIds: [], prompt: 'A paper boat' })) } })
    vi.spyOn(modelOptions, 'preloadModelOptions').mockResolvedValue([])
    vi.spyOn(projectDelivery, 'isRunTargetLoaded').mockReturnValue(true)
    vi.spyOn(projectActions, 'withProjectAction').mockImplementation((action: unknown) => (action as (value: unknown) => unknown)({
      binding: { projectId: PROJECT_ID }, signal: new AbortController().signal, assertCurrent: () => undefined,
    }))
    const batch = vi.spyOn(rowActions, 'runStoryboardBatch').mockResolvedValue('declined')
    try {
      const result = await presentStoryboardAuthoring({ candidate: { candidateId: 'c' } as Parameters<typeof presentStoryboardAuthoring>[0]['candidate'], sourceDocumentId: 'doc' },
        PROJECT_ID, 'design', requested, async (_op, payload) => presentStoryboard(payload as Record<string, unknown>))
      expect(expected.error).toBeUndefined()
      expect(result.shots, 'external Agent final receipt from the real renderer').toEqual(expected.value)
      expect(batch.mock.calls[0][1].map(row => row.shot.shotId), 'rows actually sent to the storyboard batch action').toEqual(expected.value)
    } catch (error) {
      if (!expected.error) throw error
      expect(answer(() => { throw error })).toEqual(expected)
      expect(batch).not.toHaveBeenCalled()
    }
  })
})

const present = (world: SpendWorld, shotIds?: unknown) => world.handler({ capability: 'present', params: { operationId: OPERATION_ID, ...(shotIds === undefined ? {} : { shotIds }) }, lease })
const cases = [
  { name: 'first offer / unselected shots', initial: undefined, requested: undefined },
  { name: 'selected scope stays narrow while card open', initial: ['shot-1'], requested: undefined },
  { name: 'closed card stays narrow', initial: ['shot-1'], closed: true, requested: undefined },
  { name: 'in flight plus undecided', initial: ['shot-1', 'shot-2', 'shot-3'], sent: ['shot-1'], closed: true, requested: undefined },
  { name: 'all sent refuses rather than offering again', initial: ['shot-1', 'shot-2', 'shot-3'], sent: ['shot-1', 'shot-2', 'shot-3'], requested: undefined },
  { name: 'named retry of a sent shot remains allowed', initial: ['shot-1', 'shot-2', 'shot-3'], sent: ['shot-1'], requested: ['shot-1'] },
  { name: 'R-d closed card with sent and removed shots', initial: ['shot-1', 'shot-2', 'shot-3'], sent: ['shot-1'], removed: 'shot-3', closed: true, requested: undefined },
  { name: 'removed shot is not undecided', initial: ['shot-1', 'shot-2', 'shot-3'], removed: 'shot-2', requested: undefined },
  { name: 'nothing left refuses rather than all', initial: ['shot-1'], removed: 'shot-1', requested: undefined },
  { name: 'named shots follow plan order', initial: ['shot-1'], requested: ['shot-3', 'shot-2'] },
  { name: 'empty named scope refuses', initial: ['shot-1'], requested: [] },
  { name: 'duplicate named scope refuses atomically', initial: ['shot-1'], requested: ['shot-2', 'shot-2'] },
  { name: 'unknown named scope refuses atomically', initial: ['shot-1'], requested: ['shot-9'] },
  { name: 'blank entry refuses atomically', initial: ['shot-1'], requested: ['shot-2', ' '] },
] satisfies Array<{ name: string; initial?: string[]; closed?: boolean; sent?: string[]; removed?: string; requested?: string[] }>

async function prepare(input: (typeof cases)[number]) {
  const world = spendWorld()
  await shotsDraft(world, [{}, {}, {}], false)
  if (input.initial) await present(world, input.initial)
  if (input.sent) { await world.generate(input.sent); await world.renderer.drain() }
  if (input.removed) await world.remove(input.removed)
  if (input.closed) await world.cancel()
  return world
}

function answer(action: () => unknown) {
  try { return { value: action() } }
  catch (error) {
    if (!(error instanceof Error)) throw error
    return { error: { code: (error as Error & { code?: string }).code, message: error.message } }
  }
}

describe('generation scope at final consumer outputs', () => {
  describe.each(['reducer', 'store', 'handler', 'lane'] as const)('%s · Agent card and receipt', endpoint => {
    it.each(cases)('$name', async input => {
      const world = await prepare(input)
      const before = world.run()
      const plan = before.generationPlan!
      const ids = plan.shots!.map(shot => shot.shotId)
      const expected = answer(() => resolveUndecidedGenerationShotScope({ door: 'present', planShotIds: ids,
        requested: input.requested, currentOffer: currentOfferFrom(generationPresentationOutcome(before)),
        offerable: plan.shots!.filter(shot => shot.included !== false).map(shot => shot.shotId) }))
      const adapter = endpoint === 'lane' ? world.transport('request') : undefined
      try {
        if (endpoint === 'reducer') {
          const result = answer(() => currentPresentation(presentGenerationPlan(before, input.requested, now()).generationPlan)?.shotIds)
          expect(result).toEqual(expected)
        } else {
          let actual: unknown
          let failure: unknown
          try {
            actual = endpoint === 'store' ? await world.operations.present(PROJECT_ID, OPERATION_ID, now(), input.requested)
              : endpoint === 'handler' ? await present(world, input.requested)
                : await callTool(adapter!, GENERATION_METHODS.plan, { operation: 'present', operationId: OPERATION_ID, ...(input.requested === undefined ? {} : { shotIds: input.requested }) })
          } catch (error) { failure = error }
          if (expected.error) {
            if (endpoint === 'lane') {
              expect(actual).toMatchObject({ ok: false, code: expected.error.code })
              // Blank IDs fail the transport schema before reaching the scope owner; their field error has its own wording.
              if (!input.requested?.some(id => !id.trim())) expect(actual).toMatchObject(expected.error)
            }
            else expect(answer(() => { throw failure })).toEqual(expected)
            expect(world.run(), 'refusal changes no durable state').toEqual(before)
          } else {
            if (failure) throw failure
            if (endpoint === 'handler') expect(actual).toMatchObject({ shots: expected.value })
            if (endpoint === 'lane') expect(actual).toMatchObject({ ok: true, result: { shots: expected.value } })
            expect(currentPresentation(world.run().generationPlan)?.shotIds, 'durable card members').toEqual(expected.value)
            expect(world.pending()?.shots.map(shot => shot.shotId), 'data actually handed to the card').toEqual(expected.value)
          }
        }
      } finally { adapter?.dispose() }
    })
  })

  it.each(cases)('$name · external gate and reducer seal', async input => {
    const world = await prepare(input)
    const operation = (await world.operations.read(PROJECT_ID, OPERATION_ID))!
    const shots = operation.shots!
    const expected = answer(() => resolveUndecidedGenerationShotScope({ door: 'gate', planShotIds: shots.map(shot => shot.shotId),
      requested: input.requested, currentOffer: currentOfferFrom(operation.presentationOutcome),
      offerable: shots.filter(shot => shot.included !== false && !shot.contract).map(shot => shot.shotId) }))
    expect(answer(() => {
      const decision = resolveGateScope(operation, input.requested)
      expect(decision.kind).toBe('seal')
      return 'scope' in decision ? decision.scope : undefined
    })).toEqual(expected)
    if (expected.value) {
      expect([...sealScopeOf(world.run(), world.run().generationPlan!, expected.value)!], 'members actually admitted by seal').toEqual(expected.value)
    }
  })

  it.each([undefined, ['shot-1'], ['shot-2'], ['shot-1', 'shot-1'], ['shot-9']].map(requested => ({ requested })))('waiting gate / $requested', ({ requested }) => {
    const ids = ['shot-1', 'shot-2', 'shot-3']
    const expected = answer(() => {
      const named = requested === undefined ? undefined : resolveNamedGenerationShots(ids, requested)
      return !named || named.length === 1 && named[0] === 'shot-1'
        ? { kind: 'reuse', scope: ['shot-1'] } : { kind: 'abandon-then-seal' }
    })
    expect(answer(() => resolveGateScope({ state: 'draft', shots: ids.map(shotId => ({ shotId })),
      authorization: { status: 'waiting', envelope: { jobs: [{ shotId: 'shot-1' }] } } }, requested))).toEqual(expected)
  })
})

const graphCases = [
  { name: 'unselected idle stays out', statuses: ['idle', 'idle'], selected: [0] },
  { name: 'idle with existing result', statuses: ['idle'], result: true, selected: [0] },
  { name: 'settled with existing result', statuses: ['success'], result: true, selected: [0] },
  { name: 'in flight', statuses: ['running', 'queued'], selected: [0, 1] },
  { name: 'recoverable', statuses: ['recoverable'], selected: [0] },
  { name: 'failed beside in flight', statuses: ['error', 'running'], selected: [0, 1] },
  { name: 'empty selection', statuses: ['idle'], selected: [] },
] as const

describe('canvas / generation-list confirmation outputs', () => {
  it.each(graphCases)('$name', async input => {
    const nodes = input.statuses.map((status, index) => ({ ...createGenerationNode({ id: `n${index}`, kind: 'image' }), status,
      ...('result' in input && input.result ? { result: { id: `r${index}`, type: 'image' as const, createdAt: 1, url: `https://fixture.invalid/${index}.png` } } : {}) }))
    const graph = { nodes, edges: [] }
    const selection = input.selected.map(index => `n${index}`)
    useGenerationCanvasStore.setState({ ...graph, selectedNodeIds: selection })
    const facts = scopeFactsOf(graph, { runs: {} })
    for (const intent of ['group', 'single', 'shot-row', 'anchor-wave', 'retry-failed', 'hand-over'] satisfies GenerationScopeIntent[]) {
      const expected = planGenerationScope({ intent, selection, facts })
      expect(planCanvasGenerationScope(intent, selection, graph, { runs: {} })).toEqual(expected)
    }
    const expected = planGenerationScope({ intent: 'group', selection, facts })
    expect(groupGenerateRows(expected).map(({ id, checked, disabled }) => ({ id, checked, disabled })))
      .toEqual(expected.rows.filter(row => row.state !== 'excluded').map(row => ({ id: row.id, checked: row.state === 'checked', disabled: row.state === 'disabled' })))
    const selectedFacts = facts.items.filter(item => selection.includes(item.id))
    const selectable = hasSelectableScopeRow('group', selectedFacts)
    expect(hasGroupGenerateCandidates(selection, nodes, {})).toBe(selectable)
    expect(runGroupGenerate(selection)).toBe(selectable ? 'started' : 'empty')
    if (selectable) expect(confirmation.mock.calls[0][0], 'plan handed to actual confirmation boundary').toEqual(expected)
    else expect(confirmation).not.toHaveBeenCalled()
    await Promise.resolve()
    await Promise.resolve()
  })
})

describe('storyboard footer final runnable rows', () => {
  it.each(['ready', 'anchor-ignored', 'missing-required', 'generating', 'failed', 'recoverable', 'done', 'locked'] as const)('%s', status => {
    const rows = [{ shot: { shotId: 's' }, exec: { status } }] as StoryboardRowWithExec[]
    const facts = { items: [storyboardRowScopeItem('s', status)], edges: [] }
    const expected = planGenerationScope({ intent: 'storyboard-batch', selection: ['s'], facts })
    expect(deriveStoryboardBatch(rows).runnable.map(row => row.shot.shotId)).toEqual(expected.members)
  })
})
