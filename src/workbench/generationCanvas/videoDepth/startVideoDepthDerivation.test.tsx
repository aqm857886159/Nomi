import React, { type JSX } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from '../../ai/v4/testReactRenderer'
import type { DesktopBridge } from '../../../desktop/bridge'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { __resetGenerationCanvasHistoryForTests, useGenerationCanvasStore } from '../store/generationCanvasStore'
import { abandonPendingCanvasWrite } from '../events/canvasWriteBoundary'
import { ensureDeconstructionShotTable } from '../nodes/shotTable/factBridge'
import { requestTaskCancel } from '../runner/localTaskControl'
import i18n from '../../../i18n'

const mounts = vi.hoisted(() => ({
  composerNodeIds: new Set<string>(),
  shotTableToolbarNodeIds: new Set<string>(),
  shotTableComposerNodeIds: new Set<string>(),
}))

vi.mock('../reactFlow/canvasViewportScale', async () => ({
  ...(await vi.importActual<typeof import('../reactFlow/canvasViewportScale')>('../reactFlow/canvasViewportScale')),
  useCanvasLiveZoom: () => 2,
}))

vi.mock('../../../design/tooltip', () => {
  const pass = ({ children }: { children?: unknown }) => children ?? null
  return { Tooltip: pass, TooltipContent: () => null, TooltipProvider: pass, TooltipTrigger: pass }
})

vi.mock('../nodes/DeferredNodeMedia', () => ({
  DeferredNodeImage: () => null,
  DeferredNodeVideo: () => null,
}))

vi.mock('../nodes/NodeFloatingToolbar', async () => ({
  ...(await vi.importActual<typeof import('../nodes/NodeFloatingToolbar')>('../nodes/NodeFloatingToolbar')),
  FloatingToolbarShell: ({ children }: { children?: unknown }) => children ?? null,
  EmptyNodeVariantToolbar: () => null,
}))

vi.mock('../nodes/ToolbarActionMenu', () => ({
  ToolbarActionMenu: () => null,
}))

vi.mock('../nodes/LazyNodeGenerationComposer', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    default: function StubLazyComposer({ node }: { node: { id: string } }) {
      ReactActual.useLayoutEffect(() => {
        mounts.composerNodeIds.add(node.id)
        return () => {
          mounts.composerNodeIds.delete(node.id)
        }
      }, [node.id])
      return null
    },
  }
})

vi.mock('../nodes/shotTable/ShotTableToolbar', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    ShotTableToolbar: function StubShotTableToolbar({ nodeId }: { nodeId: string }) {
      ReactActual.useLayoutEffect(() => {
        mounts.shotTableToolbarNodeIds.add(nodeId)
        return () => {
          mounts.shotTableToolbarNodeIds.delete(nodeId)
        }
      }, [nodeId])
      return null
    },
  }
})

vi.mock('../nodes/shotTable/ShotTableComposer', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    ShotTableComposer: function StubShotTableComposer({ nodeId }: { nodeId: string }) {
      ReactActual.useLayoutEffect(() => {
        mounts.shotTableComposerNodeIds.add(nodeId)
        return () => {
          mounts.shotTableComposerNodeIds.delete(nodeId)
        }
      }, [nodeId])
      return null
    },
  }
})

vi.mock('../runner/runProjectDelivery', async () => {
  const store = await import('../store/generationCanvasStore')
  return {
    isRunTargetLoaded: () => true,
    whenRunTargetLoaded: (_target: unknown, apply: () => void) => {
      apply()
      return true
    },
    deliverRunOutcome: async (
      _target: unknown,
      nodeId: string,
      outcome: { kind: string; result?: never; status?: never; error?: string },
    ) => {
      const state = store.useGenerationCanvasStore.getState()
      if (outcome.kind === 'result') state.addNodeResult(nodeId, outcome.result as never)
      else state.setNodeStatus(nodeId, 'error', outcome.error)
      return true
    },
  }
})

import BaseGenerationNode from '../nodes/BaseGenerationNode'
import ShotTableNode from '../nodes/shotTable/ShotTableNode'
import { startVideoDepthDerivation } from './startVideoDepthDerivation'
import type { ProjectExecutionContext } from '../../project/projectCanvasReadSurface'

type EventCallback = Parameters<DesktopBridge['videoDepth']['onEvent']>[0]

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeProject(projectId = 'proj-depth'): ProjectExecutionContext {
  const controller = new AbortController()
  return {
    binding: { projectId, immutableProjectUuid: `uuid-${projectId}`, projectGeneration: 1 },
    signal: controller.signal,
    assertCurrent() {
      if (controller.signal.aborted) throw Object.assign(new Error('stale'), { code: 'project_binding_stale' })
    },
  }
}

const SOURCE_NODE: GenerationCanvasNode = {
  id: 'source-shot',
  kind: 'video',
  title: '推门走进来',
  categoryId: 'shots',
  position: { x: 120, y: 140 },
  size: { width: 420, height: 236 },
  status: 'success',
  result: {
    id: 'res-source',
    type: 'video',
    url: 'nomi-local://asset/proj-depth/source.mp4',
    createdAt: 1,
    durationSeconds: 4,
  },
}

function CanvasHarness(): JSX.Element {
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const selectedNodeIds = useGenerationCanvasStore((state) => state.selectedNodeIds)
  return (
    <ReactFlowProvider>
      {nodes.map((node) =>
        node.kind === 'shot_table' ? (
          <ShotTableNode key={node.id} node={node} selected={selectedNodeIds.includes(node.id)} />
        ) : (
          <BaseGenerationNode key={node.id} node={node} selected={selectedNodeIds.includes(node.id)} />
        ),
      )}
    </ReactFlowProvider>
  )
}

async function inspectMountedCanvas(): Promise<{
  composerNodeIds: string[]
  shotTableToolbarNodeIds: string[]
  shotTableComposerNodeIds: string[]
}> {
  mounts.composerNodeIds.clear()
  mounts.shotTableToolbarNodeIds.clear()
  mounts.shotTableComposerNodeIds.clear()
  const localRenderer = createReactTestRenderer()
  try {
    localRenderer.render(<CanvasHarness />)
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      localRenderer.flushPassiveEffects()
    }
    return {
      composerNodeIds: [...mounts.composerNodeIds],
      shotTableToolbarNodeIds: [...mounts.shotTableToolbarNodeIds],
      shotTableComposerNodeIds: [...mounts.shotTableComposerNodeIds],
    }
  } finally {
    localRenderer.close()
  }
}

describe('startVideoDepthDerivation (Task J-2)', () => {
  let listeners: Set<EventCallback>
  let downloadStarts: number
  let activeDownloads: Array<{
    jobId: string
    nodeId: string
    projectId: string
    gate: ReturnType<typeof deferred<void>>
  }>
  let cancelledCalls: Array<Record<string, unknown>>
  let renderer: ReturnType<typeof createReactTestRenderer>

  class StubWorker {
    private readonly handlers = new Set<(event: { data: unknown }) => void>()
    addEventListener(type: string, handler: (event: { data: unknown }) => void): void {
      if (type === 'message') this.handlers.add(handler)
    }
    postMessage(msg: { kind: string; requestId: string; batchId?: string; frames?: ArrayBuffer[] }): void {
      if (msg.kind === 'cancel') return
      queueMicrotask(() => {
        const payload =
          msg.kind === 'warm'
            ? { kind: 'ready', requestId: msg.requestId }
            : {
                kind: 'batchResult',
                requestId: msg.requestId,
                batchId: msg.batchId ?? 'b0',
                rawFrames: (msg.frames ?? []).map(() => new ArrayBuffer(4)),
              }
        for (const handler of this.handlers) handler({ data: payload })
      })
    }
    terminate(): void {
      this.handlers.clear()
    }
  }

  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    abandonPendingCanvasWrite()
    __resetGenerationCanvasHistoryForTests()
    mounts.composerNodeIds.clear()
    mounts.shotTableToolbarNodeIds.clear()
    mounts.shotTableComposerNodeIds.clear()
    listeners = new Set()
    downloadStarts = 0
    activeDownloads = []
    cancelledCalls = []

    const videoDepthBridge: DesktopBridge['videoDepth'] = {
      prepare: async ({ projectId, nodeId }) => {
        downloadStarts += 1
        const jobId = `job-${downloadStarts}`
        const gate = deferred<void>()
        const record = { jobId, nodeId, projectId, gate }
        activeDownloads.push(record)
        for (const listener of listeners) {
          listener({ jobId, nodeId, phase: 'downloading', doneBytes: 10_000_000, totalBytes: 49_600_000 })
        }
        await gate.promise
        return {
          jobId,
          totalFrames: 2,
          outWidth: 518,
          outHeight: 290,
          depthModelUrl: 'nomi-local://model/depth.onnx',
          ortWasmBaseUrl: 'nomi-local://runtime/ort/',
        }
      },
      readFrames: async ({ count }) => ({
        frames: Array.from({ length: count }, () => new Uint8Array([1, 2, 3, 4])),
      }),
      writeFrames: async () => ({ ok: true as const }),
      finish: async () => ({
        url: 'nomi-local://asset/proj-depth/depth.mp4',
        assetId: 'asset-depth',
        frames: 2,
      }),
      cancel: async ({ jobId }) => {
        cancelledCalls.push({ jobId })
        for (const item of activeDownloads) {
          if (item.jobId === jobId || item.nodeId === jobId) {
            item.gate.reject(new Error('cancelled'))
          }
        }
        return { ok: true as const }
      },
      onEvent: (callback) => {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
    }

    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false)
    vi.stubGlobal('Worker', StubWorker)
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      setTimeout,
      clearTimeout,
      nomiDesktop: { videoDepth: videoDepthBridge } as unknown as DesktopBridge,
    })

    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [structuredClone(SOURCE_NODE)],
      edges: [],
      groups: [],
    })
    useGenerationCanvasStore.getState().selectNodes([SOURCE_NODE.id])
    renderer = createReactTestRenderer()
  })

  afterEach(async () => {
    for (const item of activeDownloads) item.gate.resolve()
    await new Promise((resolve) => setTimeout(resolve, 20))
    renderer.close()
    vi.unstubAllGlobals()
  })

  it('Test A: clicking Extract depth a second time while weight download is running keeps ONLY 1 derived card, runs ONLY 1 download, surfaces already-running notice, and unlocks after cancel or failure', async () => {
    const project = makeProject('proj-a')
    const feedbacks: string[] = []
    const first = startVideoDepthDerivation(SOURCE_NODE, project, (msg) => feedbacks.push(msg))
    expect(first).not.toBeNull()

    // Simulate clicking "提取深度" a second time while weight download #1 is still in progress:
    const second = startVideoDepthDerivation(SOURCE_NODE, project, (msg) => feedbacks.push(msg))
    const derivedDuringDownload = useGenerationCanvasStore
      .getState()
      .nodes.filter((n) => n.id !== SOURCE_NODE.id)

    expect(derivedDuringDownload).toHaveLength(1)
    expect(downloadStarts).toBe(1)
    expect(second).toBeNull()
    expect(feedbacks).toEqual([i18n.t('videoDepth.error.already-running')])

    // Cancel during download → empty derived card is removed & lock is released so clicking again succeeds:
    const derivedCard = useGenerationCanvasStore
      .getState()
      .nodes.find((n) => n.id === first!.derivedNodeId)!
    requestTaskCancel(derivedCard, vi.fn())
    await first!.done
    expect(useGenerationCanvasStore.getState().nodes.map((n) => n.id)).toEqual([SOURCE_NODE.id])

    // Click again after cancel: succeeds! Now simulate failure during download → lock also releases:
    const afterCancel = startVideoDepthDerivation(SOURCE_NODE, project, (msg) => feedbacks.push(msg))
    expect(afterCancel).not.toBeNull()
    expect(downloadStarts).toBe(2)
    activeDownloads[1]!.gate.reject(
      Object.assign(new Error('network down'), { code: 'model-download-failed', retryable: true }),
    )
    await afterCancel!.done
    expect(
      useGenerationCanvasStore.getState().nodes.find((n) => n.id === afterCancel!.derivedNodeId)?.status,
    ).toBe('error')

    // Click again after failure: succeeds and completes cleanly!
    const afterFailure = startVideoDepthDerivation(SOURCE_NODE, project, (msg) => feedbacks.push(msg))
    expect(afterFailure).not.toBeNull()
    expect(downloadStarts).toBe(3)
    activeDownloads[2]!.gate.resolve()
    await afterFailure!.done
    expect(
      useGenerationCanvasStore.getState().nodes.find((n) => n.id === afterFailure!.derivedNodeId),
    ).toMatchObject({
      status: 'success',
      result: { type: 'video', url: 'nomi-local://asset/proj-depth/depth.mp4' },
    })
  })

  it('Test B1: starting depth derivation with sourceNode selected keeps sourceNode selected, never mounts NodeGenerationComposer on derived, and undoes card+edge in a single step', async () => {
    const project = makeProject('proj-b1')
    const before = await inspectMountedCanvas()
    expect(before.composerNodeIds).toEqual([SOURCE_NODE.id])

    const handle = startVideoDepthDerivation(SOURCE_NODE, project, vi.fn())
    expect(handle).not.toBeNull()
    const after = await inspectMountedCanvas()

    const state = useGenerationCanvasStore.getState()
    expect(after.composerNodeIds).toEqual([SOURCE_NODE.id])
    expect(after.composerNodeIds).not.toContain(handle!.derivedNodeId)
    expect(state.selectedNodeIds).toEqual([SOURCE_NODE.id])
    expect(state.selectedNodeIds).not.toContain(handle!.derivedNodeId)
    expect(state.edges).toMatchObject([{ source: SOURCE_NODE.id, target: handle!.derivedNodeId, mode: 'reference' }])

    // Single-step undo removes BOTH derived card and provenance edge at once:
    requestTaskCancel(state.nodes.find((n) => n.id === handle!.derivedNodeId)!, vi.fn())
    await handle!.done

    const handle2 = startVideoDepthDerivation(SOURCE_NODE, project, vi.fn())!
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(2)
    useGenerationCanvasStore.getState().undo()
    expect(useGenerationCanvasStore.getState().nodes.map((n) => n.id)).toEqual([SOURCE_NODE.id])
    expect(useGenerationCanvasStore.getState().edges).toEqual([])
    requestTaskCancel({ id: handle2.derivedNodeId, progress: { phase: 'video-depth-downloading' } }, vi.fn())
    await handle2.done
  })

  it('Test B2: starting depth derivation while shot_table is selected keeps shot_table selected with its toolbar & composer engaged, and never mounts NodeGenerationComposer on derived', async () => {
    const project = makeProject('proj-b2')
    const shotTableId = ensureDeconstructionShotTable(SOURCE_NODE.id)!
    expect(useGenerationCanvasStore.getState().selectedNodeIds).toEqual([shotTableId])

    const before = await inspectMountedCanvas()
    expect(before.shotTableToolbarNodeIds).toEqual([shotTableId])
    expect(before.shotTableComposerNodeIds).toEqual([shotTableId])

    const handle = startVideoDepthDerivation(SOURCE_NODE, project, vi.fn())
    expect(handle).not.toBeNull()
    const after = await inspectMountedCanvas()

    const state = useGenerationCanvasStore.getState()
    expect(state.selectedNodeIds).toEqual([shotTableId])
    expect(state.selectedNodeIds).not.toContain(handle!.derivedNodeId)
    expect(after.shotTableToolbarNodeIds).toEqual([shotTableId])
    expect(after.shotTableComposerNodeIds).toEqual([shotTableId])
    expect(after.composerNodeIds).not.toContain(handle!.derivedNodeId)

    requestTaskCancel(state.nodes.find((n) => n.id === handle!.derivedNodeId)!, vi.fn())
    await handle!.done
  })

  it('Test A2: rolls back transient derived card and surfaces already-running notice if main-process prepare rejects with already-running', async () => {
    const project = makeProject('proj-cross-window')
    const bridge = (window as unknown as { nomiDesktop: DesktopBridge }).nomiDesktop.videoDepth
    bridge.prepare = async () => {
      throw Object.assign(new Error('already running in main'), { code: 'already-running', retryable: false })
    }
    const feedbacks: string[] = []
    const handle = startVideoDepthDerivation(SOURCE_NODE, project, (msg) => feedbacks.push(msg))
    expect(handle).not.toBeNull()
    await handle!.done

    expect(useGenerationCanvasStore.getState().nodes.map((n) => n.id)).toEqual([SOURCE_NODE.id])
    expect(feedbacks).toEqual([i18n.t('videoDepth.error.already-running')])
  })
})
