/**
 * 可灵 4.0 Flash 全能参考的「保留原声」只在接着参考视频时有意义（官方：`origin` requires a reference video）。
 * 创作者先接了视频、选了保留原声，再把视频断开：节点上存着的 origin 要自己回到 auto——
 * 否则这张卡点生成会被发送前的判定拒掉，而面板上那个选项已经不在了，创作者看不到为什么。
 * 用 composerKeepsAspect 同一套 react-reconciler 渲染器真挂 NodeGenerationComposer（2026-11-14，通用输入判定）。
 */
import React, { type JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from '../../ai/v4/testReactRenderer'

type BarProps = { renderedControls: Array<{ key: string; options?: Array<{ value: unknown }> }> }

const probe = vi.hoisted(() => ({ bar: null as unknown as BarProps | null }))

vi.mock('../../common/useNomiRichTextEditor', () => ({ useNomiTiptapEditor: () => null }))
const translation = vi.hoisted(() => ({ t: (key: string) => key, i18n: { language: 'zh-CN', resolvedLanguage: 'zh-CN' } }))
vi.mock('react-i18next', async () => ({
  ...(await vi.importActual<typeof import('react-i18next')>('react-i18next')),
  useTranslation: () => translation,
}))
vi.mock('../reactFlow/canvasViewportScale', () => ({ useCanvasLiveZoom: () => 1 }))
vi.mock('./InlineParameterBar', () => ({ default: (props: BarProps) => { probe.bar = props; return null } }))
vi.mock('../../assets/AssetReference', () => ({ default: () => null }))
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
const MODELS = [
  { modelKey: 'kling-v4-flash', vendorKey: 'apimart', labelZh: '可灵 4.0 Flash', kind: 'video', enabled: true, published: true, publishedModes: ['text_to_video', 'image_to_video'], availability: { usable: true } },
]
const HEALTH = { ok: true, counts: { vendors: 1, enabledVendors: 1, models: 1, enabledModels: 1, mappings: 0, enabledMappings: 0, enabledApiKeys: 1 }, byKind: [], issues: [] }
const ANSWERS: Record<string, (...args: unknown[]) => unknown> = {
  'modelCatalog.listVendors': () => VENDORS,
  'modelCatalog.listModels': (params) => MODELS.filter((row) => !(params as { kind?: string } | undefined)?.kind || row.kind === (params as { kind: string }).kind),
  'modelCatalog.listMappings': () => [],
  'modelCatalog.health': () => HEALTH,
  'projects.listAsync': async () => [],
  'assets.list': async () => ({ items: [], cursor: null }),
  'settings.generationModelDefaults.get': async () => ({ schemaVersion: 1, byTaskKind: {} }),
  'promptLibrary.list': async () => ({ ok: true, prompts: [] }),
  'promptLibrary.userList': async () => ({ ok: true, prompts: [] }),
}

function recordingBridge(): unknown {
  const make = (path: string[]): unknown => new Proxy(function bridgeMember() {}, {
    get: (_target, key) => (typeof key === 'symbol' || key === 'then' ? undefined : make([...path, key])),
    apply: (_target, _self, args: unknown[]) => {
      const name = path.join('.')
      if (/(^|\.)on[A-Z]/.test(name)) return () => undefined
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

const VISUAL_SIZE = { width: 340, height: 192 }
const noFeedback = (): void => undefined

function Host({ nodeId }: { nodeId: string }): JSX.Element | null {
  const node = useGenerationCanvasStore((state) => selectCanvasNodeById(state, nodeId))
  if (!node) return null
  return <NodeGenerationComposer node={node} visualSize={VISUAL_SIZE} onFeedback={noFeedback} />
}

async function settle(renderer: ReturnType<typeof createReactTestRenderer>): Promise<void> {
  for (let round = 0; round < 8; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    renderer.flushPassiveEffects()
  }
}

const metaOf = (nodeId: string) => (useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.meta ?? {}) as Record<string, unknown>
const audioOptions = () => (probe.bar?.renderedControls.find((control) => control.key === 'audio_setting')?.options ?? []).map((option) => option.value)

const shot: GenerationCanvasNode = {
  id: 'shot', kind: 'video', title: 'shot', position: { x: 0, y: 0 }, prompt: '雨夜街口',
  meta: {
    modelKey: 'kling-v4-flash', modelVendor: 'apimart', vendor: 'apimart', modelLabel: '可灵 4.0 Flash',
    archetype: { id: 'kling-v4-flash', modeId: 'ref' }, audio_setting: 'origin',
    referenceImageUrls: ['https://example.com/a.png'],
  },
}
const clip: GenerationCanvasNode = { id: 'clip', kind: 'video', title: 'clip', position: { x: -400, y: 0 } }

describe('可灵 4.0 Flash 全能参考：断开参考视频后「保留原声」回到 auto', () => {
  let renderer: ReturnType<typeof createReactTestRenderer>
  beforeEach(() => {
    installWindow()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false)
    notifyModelOptionsRefresh('all')
    resetGenerationModelDefaultsForTest()
    renderer = createReactTestRenderer()
  })
  afterEach(() => {
    renderer.close()
    vi.unstubAllGlobals()
  })

  it('接着视频时 origin 留着、选项里有它；断开视频后节点值回 auto、选项里没有它', async () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [clip, structuredClone(shot)], edges: [{ id: 'clip-shot', source: 'clip', target: 'shot', mode: 'reference' }], groups: [], selectedNodeIds: ['shot'],
    })
    renderer.render(<Host nodeId="shot" />)
    await settle(renderer)
    expect(metaOf('shot').audio_setting).toBe('origin')
    expect(audioOptions()).toContain('origin')

    useGenerationCanvasStore.getState().disconnectEdge('clip-shot')
    await settle(renderer)
    expect(useGenerationCanvasStore.getState().edges).toEqual([])
    expect(audioOptions()).not.toContain('origin')
    expect(metaOf('shot').audio_setting).toBe('auto')
  })
})
