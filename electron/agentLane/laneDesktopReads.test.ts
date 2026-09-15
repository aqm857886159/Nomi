import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { DesktopCanvasReadRuntime } from '../capabilityCore/canvasReadMainRuntime'
import type { DocumentReadPort, TimelineReadPort } from '../capabilityCore/capabilityExecutorRegistry'
import { createMainCapabilityExecutorRegistry } from '../capabilityCore/capabilityExecutorRegistry'
import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority } from '../capabilityCore/canvasReadSurfaceRegistry'
import { createProjectAgentProposalReceiptService } from '../capabilityCore/projectAgentProposalReceiptStore'
import { formatCanvasForAgent } from '../shared/agentCapabilities/canvasReadCompact'
import { projectCanvasRead } from '../shared/agentCapabilities/canvasRead'
import type { TimelineReadInput } from '../shared/agentCapabilities/timelineRead'
import { createDesktopLaneTools } from './laneDesktopTools'
import { openLane } from './laneHost.mjs'
import { createHttpFixture } from '../../tests/agent-runtime/httpFixture.mjs'

const desktopRuntime = vi.hoisted(() => ({ registry: undefined as unknown }))
vi.mock('../capabilityCore/canvasReadSurfaceRuntime', () => ({ canvasReadSurfaceRuntime: desktopRuntime }))
vi.mock('../productionRun/productionRunRuntime', () => ({ getProductionRunService: () => ({}) }))
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

const canvasSource = { nodes: [{ id: 'shot-a', kind: 'image', title: 'Opening shot', prompt: 'Fixture prompt',
  position: { x: 0, y: 0 }, status: 'success', result: { id: 'result-a', url: 'https://private.invalid/image.png',
    raw: { credential: 'private-fixture-value' } } }], edges: [], groups: [], selectedNodeIds: ['shot-a'] }

async function fixture(toolName: string, args: Record<string, unknown>, stale = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nomi-desktop-lane-reads-'))
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }))
  const binding = { projectId: 'reads-fixture', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1 }
  const ownerAuthority = createSurfaceOwnerAuthority()
  const owner = ownerAuthority.capture({ contents: {}, frame: {}, webContentsId: 1, processId: 2, frameRoutingId: 3,
    origin: 'file://', isLive: () => true })
  const registry = createCanvasReadSurfaceRegistry({ ownerAuthority, resolveProjectIdentity: async () => ({ ...binding,
    canonicalRootPath: root, canonicalRootDigest: 'reads-fixture-root' }) })
  const suspension = registry.suspend(owner, { surfaceInstanceId: 'reads-surface' })
  const committed = await registry.commitCanvasRead(owner, { projectId: binding.projectId, suspension })
  const capturedPort = registry.captureCanvasReadPort(owner, committed)
  desktopRuntime.registry = registry
  const canvasRead = vi.fn(async () => canvasSource)
  const documentRead = vi.fn<DocumentReadPort['read']>(async ({ scope }) => ({ text: `${scope} fixture text` }))
  const timelineRead = vi.fn<TimelineReadPort['read']>(async ({ input: raw }) => {
    const input = raw as TimelineReadInput
    if (input.operation === 'inspect_timeline_range') return { ...input, revision: 'deadbeef', tracks: [], textClips: [] }
    return { operation: 'read_timeline', revision: 'deadbeef', fps: 30, scale: 1, playheadFrame: 0,
      durationFrames: 0, valid: true, tracks: [], textClips: [], transitions: [] }
  })
  const executor = createMainCapabilityExecutorRegistry({ resolveCanvasReadPort: async () => ({ read: canvasRead }),
    resolveDocumentReadPort: async () => ({ read: documentRead }), resolveTimelineReadPort: async () => ({ read: timelineRead }) })
  const surface = { executor, surfaceCapture: { captureCommittedCanvasReadPort: () => capturedPort },
    surfacePortRuntime: { createCanvasWritePort: () => ({}) } } as unknown as DesktopCanvasReadRuntime
  const assembly = createDesktopLaneTools({ event: {} as IpcMainInvokeEvent, binding, surface,
    receipts: createProjectAgentProposalReceiptService({ projectRoot: root, binding }),
    context: () => ({ documentId: 'fixture-document', approvalPolicy: { mode: 'safe-auto', spend: 'confirm' } }),
    // 档位和工具审批读**同一份**快照（生产里两者都来自 `composer.approvalPolicy`）。
    approvalPolicy: () => ({ mode: 'safe-auto', spend: 'confirm' }),
    generationFactory: () => undefined, onTaskCreated: async () => undefined })
  cleanups.push(async () => assembly.dispose())
  if (stale) registry.suspend(owner, { surfaceInstanceId: 'another-surface' })
  const http = await createHttpFixture([{ type: 'tool', calls: [{ id: 'read-call', name: toolName, arguments: args }] },
    { type: 'text', text: 'Read complete.' }])
  cleanups.push(http.close)
  const lane = await openLane({ fetch: globalThis.fetch, projectDir: root, model: { kind: 'openai-compatible', providerId: 'fixture', modelId: 'fixture',
    baseURL: http.baseURL, authType: 'api-key', apiKey: 'fixture' }, tools: assembly.tools, toolLifecycle: assembly.toolLifecycle,
    systemPrompt: 'Use the current verified surface.', approval: { hasUserInterface: true,
      policy: () => ({ mode: 'safe-auto', spend: 'confirm' }) } })
  cleanups.push(() => lane.close())
  await lane.execute({ kind: 'prompt', text: 'Read the current surface.' })
  const result = lane.projection().parts.find(part => part.kind === 'tool-result')
  if (!result || result.kind !== 'tool-result') throw new Error('Missing actual lane tool result')
  return { result, lane, timelineRead, canvasRead, documentRead }
}

describe('desktop lane read adapter contracts', () => {
  it.each([
    ['read_timeline', {}],
    ['read_timeline', { startFrame: 12, endFrame: 24 }],
  ] as const)('%s binds alias operation once and returns a usable revision', async (toolName, args) => {
    const f = await fixture(toolName, args)
    expect(f.result).toMatchObject({ isError: false })
    const range = 'startFrame' in args ? args : undefined
    const operation = range ? 'inspect_timeline_range' : 'read_timeline'
    expect(JSON.parse(f.result.text)).toMatchObject({ operation, revision: 'deadbeef', ...(range ?? {}) })
    expect(f.timelineRead).toHaveBeenCalledExactlyOnceWith({ input: { operation, ...(range ?? {}) },
      target: { kind: 'timeline', clipIds: [] }, preconditions: {}, signal: expect.any(AbortSignal) })
    expect(f.lane.projection().pending).toBeUndefined()
  })

  it('returns the shared safe compact canvas projection without parsing presentation text as domain data', async () => {
    const f = await fixture('look_at_canvas', {})
    expect(f.result).toMatchObject({ isError: false, text: formatCanvasForAgent(projectCanvasRead(canvasSource)) })
    expect(f.canvasRead).toHaveBeenCalledOnce()
    expect(f.result.text).toContain('shot-a')
    expect(f.result.text).toContain('result-a')
    expect(f.result.text).not.toContain('private.invalid')
    expect(f.result.text).not.toContain('private-fixture-value')
  })

  it.each([['read_script', 'full'], ['read_script', 'selection']] as const)(
    '%s keeps the verified document scope with its no-argument alias', async (toolName, scope) => {
      const f = await fixture(toolName, { scope })
      expect(f.result).toMatchObject({ isError: false, text: `${scope} fixture text` })
      expect(f.documentRead).toHaveBeenCalledExactlyOnceWith({ scope, signal: expect.any(AbortSignal) })
    })

  it.each(['read_timeline', 'look_at_canvas', 'read_script'])(
    '%s refuses a rotated surface before domain execution', async toolName => {
      const f = await fixture(toolName, toolName === 'read_script' ? { scope: 'full' } : {}, true)
      expect(f.result).toMatchObject({ isError: true })
      expect(f.timelineRead).not.toHaveBeenCalled()
      expect(f.canvasRead).not.toHaveBeenCalled()
      expect(f.documentRead).not.toHaveBeenCalled()
    })
})
