/**
 * 点一下卡、生成框挂出来的那一刻的**预算**（不是毫秒，是数得清的次数）：
 *
 * - 挂载时 0 次桌面桥 IO（同步 IPC、项目 / 素材扫描、模型目录、提示词库……一律不许）；
 * - 挂载时 0 次画布 store 写（已经落好默认值的卡）；新卡第一次挂最多 1 次（默认值一次写好，不级联）；
 * - 生成框开着时，别的卡的写入（生成进度、拖动）不让它重渲。
 *
 * 为什么用计数而不用毫秒：本机同时跑多条线，毫秒数是噪声；次数是确定的，修前必红、修后必绿，
 * 就是防回来的门（docs/engineering/perf-scenarios.md「A 类」）。
 *
 * 测试宿主没有 DOM：用仓库已有的 react-reconciler 测试渲染器，把 TipTap 的 DOM 适配器换成计数桩
 * （和 agentPanelV4Performance.test 同一手法）；生成框本体、三份参数控件、它们的 hook、画布 store、
 * 模型目录缓存全是现役代码。桌面桥是一个**记账代理**：页面碰到的每一次调用都记下名字。
 */
import React, { type JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from '../../ai/v4/testReactRenderer'

const probe = vi.hoisted(() => ({
  /** 每一次桌面桥调用（订阅类 on* 不算 IO，单独记）。 */
  io: [] as string[],
  listeners: [] as string[],
  editorRenders: 0,
  editorCreates: 0,
  leafRenders: 0,
}))

vi.mock('../../common/useNomiRichTextEditor', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    useNomiTiptapEditor: () => {
      const created = ReactActual.useRef(false)
      if (!created.current) { created.current = true; probe.editorCreates += 1 }
      probe.editorRenders += 1
      return null
    },
  }
})

// 和真的 react-i18next 一样：同一语言下 t 是同一个引用（每次渲染新建 t 会让依赖它的 effect 每次都重跑）。
const translation = vi.hoisted(() => ({ t: (key: string) => key, i18n: { language: 'zh-CN', resolvedLanguage: 'zh-CN' } }))
vi.mock('react-i18next', async () => ({
  ...(await vi.importActual<typeof import('react-i18next')>('react-i18next')),
  useTranslation: () => translation,
}))

// 画布缩放来自 React Flow 的 transform；这里没有 ReactFlowProvider，钉成 1。
vi.mock('../reactFlow/canvasViewportScale', () => ({ useCanvasLiveZoom: () => 1 }))

// 只把「要真 DOM / Mantine 主题」的纯展示叶子换成计数桩：它们拿到的数据（模型清单、参数、参考槽）全是现役链路算出来的。
vi.mock('./InlineParameterBar', () => ({ default: () => { probe.leafRenders += 1; return null } }))
vi.mock('../../assets/AssetReference', () => ({ default: () => { probe.leafRenders += 1; return null } }))
vi.mock('./NodeEffectRecommendations', () => ({ NodeEffectRecommendations: () => null }))
vi.mock('../../../design/tooltip', () => {
  const pass = ({ children }: { children?: unknown }) => children ?? null
  return { Tooltip: pass, TooltipContent: () => null, TooltipProvider: pass, TooltipTrigger: pass }
})

import NodeGenerationComposer from './NodeGenerationComposer'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { selectCanvasNodeById } from '../store/canvasNodeGenerationIndex'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { notifyModelOptionsRefresh } from '../../../config/modelCatalogCache'
import { resetGenerationModelDefaultsForTest } from '../model/generationModelDefaults'

const VENDORS = [{ key: 'apimart', name: 'APIMart', enabled: true, hasApiKey: true, authType: 'bearer' }]
const usable = { usable: true }
const MODELS = [
  { modelKey: 'gpt-image-2', vendorKey: 'apimart', labelZh: 'GPT Image 2', kind: 'image', enabled: true, published: true, publishedModes: ['text_to_image', 'image_edit'], availability: usable },
  { modelKey: 'seedance-2', modelAlias: 'bytedance/seedance-2', vendorKey: 'apimart', labelZh: 'Seedance 2', kind: 'video', enabled: true, published: true, publishedModes: ['text_to_video', 'image_to_video'], availability: usable },
]
const HEALTH = { ok: true, counts: { vendors: 1, enabledVendors: 1, models: 2, enabledModels: 2, mappings: 0, enabledMappings: 0, enabledApiKeys: 1 }, byKind: [], issues: [] }
const PROJECTS = [{ id: 'project-a', name: 'A' }, { id: 'project-b', name: 'B' }, { id: 'project-c', name: 'C' }]

/** 每个方法的应答；没登记的方法照样记账、回 undefined。 */
const ANSWERS: Record<string, (...args: unknown[]) => unknown> = {
  'modelCatalog.listVendors': () => VENDORS,
  'modelCatalog.listModels': (params) => MODELS.filter((row) => !(params as { kind?: string } | undefined)?.kind || row.kind === (params as { kind: string }).kind),
  'modelCatalog.listMappings': () => [],
  'modelCatalog.health': () => HEALTH,
  'projects.list': () => PROJECTS,
  'projects.listAsync': async () => PROJECTS,
  'assets.list': async (payload) => ({
    items: [{ id: `${(payload as { projectId: string }).projectId}-a1`, projectId: (payload as { projectId: string }).projectId, name: 'a1.png', createdAt: '2026-10-01', updatedAt: '2026-10-01', data: { relativePath: 'assets/a1.png', mediaType: 'image' } }],
    cursor: null,
  }),
  'settings.generationModelDefaults.get': async () => ({ schemaVersion: 1, byTaskKind: {} }),
  'promptLibrary.list': async () => ({ ok: true, prompts: [] }),
  'promptLibrary.userList': async () => ({ ok: true, prompts: [] }),
}

function recordingBridge(): unknown {
  const make = (path: string[]): unknown => new Proxy(function bridgeMember() {}, {
    get: (_target, key) => (typeof key === 'symbol' || key === 'then' ? undefined : make([...path, key])),
    apply: (_target, _self, args: unknown[]) => {
      const name = path.join('.')
      if (/(^|\.)on[A-Z]/.test(name)) { probe.listeners.push(name); return () => undefined }
      probe.io.push(name)
      return ANSWERS[name]?.(...args)
    },
  })
  return make([])
}

function installWindow(): void {
  const listeners = new Map<string, Set<(event: Event) => void>>()
  vi.stubGlobal('window', {
    nomiDesktop: recordingBridge(),
    addEventListener: (type: string, listener: (event: Event) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(listener)
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => listeners.get(type)?.delete(listener),
    dispatchEvent: (event: Event) => { for (const listener of listeners.get(event.type) ?? []) listener(event); return true },
    setTimeout, clearTimeout,
  })
}

const SHOT_META = { modelKey: 'gpt-image-2', modelAlias: 'gpt-image-2', modelVendor: 'apimart', vendor: 'apimart', imageModel: 'gpt-image-2', imageModelVendor: 'apimart' }

function shot(meta: Record<string, unknown> = SHOT_META): GenerationCanvasNode {
  return { id: 'shot', kind: 'image', title: 'shot', position: { x: 0, y: 0 }, prompt: 'a quiet street', meta: { ...meta } }
}
const upstream: GenerationCanvasNode = { id: 'ref', kind: 'image', title: 'ref', position: { x: -400, y: 0 }, result: { id: 'r1', type: 'image', url: 'nomi-local://asset/project-a/assets/ref.png', createdAt: 1 } }
const elsewhere: GenerationCanvasNode = { id: 'other', kind: 'video', title: 'other', position: { x: 900, y: 0 }, status: 'running' }

function seedCanvas(target: GenerationCanvasNode): void {
  useGenerationCanvasStore.getState().restoreSnapshot({
    nodes: [upstream, target, elsewhere],
    edges: [{ id: 'ref-shot', source: 'ref', target: 'shot', mode: 'reference' }],
    groups: [],
    selectedNodeIds: ['shot'],
  })
}

const VISUAL_SIZE = { width: 340, height: 192 }
const noFeedback = (): void => undefined
const commits = { composer: 0 }

/** 和 BaseGenerationNode 同一个订法：按 id 订这一张卡，把它交给生成框。 */
function Host({ nodeId }: { nodeId: string }): JSX.Element | null {
  const node = useGenerationCanvasStore((state) => selectCanvasNodeById(state, nodeId))
  if (!node) return null
  return (
    <React.Profiler id="composer" onRender={() => { commits.composer += 1 }}>
      <NodeGenerationComposer node={node} visualSize={VISUAL_SIZE} onFeedback={noFeedback} />
    </React.Profiler>
  )
}

async function settle(renderer: ReturnType<typeof createReactTestRenderer>): Promise<void> {
  for (let round = 0; round < 8; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    renderer.flushPassiveEffects()
  }
}

function countStoreWrites(): { stop: () => number } {
  let writes = 0
  const unsubscribe = useGenerationCanvasStore.subscribe(() => { writes += 1 })
  return { stop: () => { unsubscribe(); return writes } }
}

function resetProbe(): void {
  probe.io.length = 0
  probe.listeners.length = 0
  probe.editorRenders = 0
  probe.editorCreates = 0
  commits.composer = 0
}

describe('点卡出生成框：挂载预算', () => {
  let renderer: ReturnType<typeof createReactTestRenderer>

  beforeEach(() => {
    installWindow()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false)
    notifyModelOptionsRefresh('all')
    resetGenerationModelDefaultsForTest()
    resetProbe()
    renderer = createReactTestRenderer()
  })

  afterEach(() => {
    renderer.close()
    vi.unstubAllGlobals()
  })

  /** 先挂一次让各处「第一次用到时」该载入的都载入，卸掉，再挂第二次——第二次才是用户每次点卡的样子。 */
  async function mountTwice(target: GenerationCanvasNode): Promise<{ io: string[]; writes: number }> {
    seedCanvas(target)
    renderer.render(<Host nodeId={target.id} />)
    await settle(renderer)
    renderer.render(null)
    await settle(renderer)
    resetProbe()
    const writes = countStoreWrites()
    renderer.render(<Host nodeId={target.id} />)
    await settle(renderer)
    return { io: [...probe.io], writes: writes.stop() }
  }

  it('挂载时 0 次桌面桥 IO（没有同步 IPC、没有全项目素材扫描）', async () => {
    const { io } = await mountTwice(shot())
    expect(io).toEqual([])
  })

  it('已落好默认值的卡，挂载时 0 次画布 store 写', async () => {
    const { writes } = await mountTwice(shot())
    expect(writes).toBe(0)
  })

  it('生成框开着时，别的卡的生成进度不让它重渲（参数控件和编辑器都不动）', async () => {
    await mountTwice(shot())
    commits.composer = 0
    probe.editorRenders = 0
    for (let tick = 1; tick <= 5; tick += 1) {
      useGenerationCanvasStore.getState().setNodeProgress('other', { percent: tick * 10, updatedAt: tick })
      await settle(renderer)
    }
    expect({ composerCommits: commits.composer, editorRenders: probe.editorRenders }).toEqual({ composerCommits: 0, editorRenders: 0 })
  })

  it('一张还没选过模型的新卡，第一次挂载最多 1 次 store 写（默认值一次写好，不级联）', async () => {
    seedCanvas(shot({}))
    // 第一次挂载之前，把「应用启动后后台载入」的那几样载好：模型目录、默认模型偏好。
    renderer.render(<Host nodeId="ref" />)
    await settle(renderer)
    renderer.render(null)
    await settle(renderer)
    const writes = countStoreWrites()
    renderer.render(<Host nodeId="shot" />)
    await settle(renderer)
    expect(writes.stop()).toBeLessThanOrEqual(1)
  })
})
