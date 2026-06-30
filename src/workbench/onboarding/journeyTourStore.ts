/**
 * 引导旅途的状态机 + 模块级 runner。
 *
 * 关键：运行状态（当前 beat / 进度 / 聚光选择器）放在 store，回放序列由**模块级 async runner**
 * 驱动——不绑组件生命周期。否则项目 hydrate 期间 studio 子树会反复重挂载控制器，组件内 state
 * 每次清零、tour 永远从头重启（真机走查抓出：effect 重跑数百次都到不了第一拍）。
 *
 * 组件（JourneyTourController）退化成纯渲染器：订阅 store 渲染当前 beat，按钮调 advance/skip/finish。
 */
import { create } from 'zustand'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { applyCanvasToolCall } from '../generationCanvas/agent/applyCanvasToolCall'
import { storyboardPlanToCreateNodesArgs } from '../generationCanvas/agent/storyboardPlan'
import { TOUR_BEATS, type TourBeat, type TourBeatId } from './journeyTour'
import { playTypewriter } from './journeyTypewriter'
import { markJourneyTourSeen } from './onboardingState'
import { setJourneyTourActive } from './journeyTourActivity'
import {
  buildDemoStoryboardPlan,
  DEMO_STORY,
  DEMO_PROJECT_NAME,
  DEMO_CANVAS_SPOTLIGHTS,
  DEMO_NODE_IMAGES,
} from './demoProject'

type TourPhase = 'idle' | 'running' | 'finale'

type JourneyTourState = {
  active: boolean
  phase: TourPhase
  beat: TourBeat | null
  teachIndex: number
  /** 当前 spotlight 的运行期选择器（画布节点落地后按真实 id 解析）；null = 用 beat.selectors。 */
  selectors: string[] | null
  start: () => void
  stop: () => void
  advance: () => void
  skip: () => void
  finish: () => void
}

type CreateNodesResult = { clientIdToNodeId?: Record<string, string> }

// 模块级运行态（不进 store，避免无谓订阅）：当前世代 token + waitNext 的 resolver。
let runToken = 0
let resolveNext: (() => void) | null = null

const delay = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))
// 让模式切换后的布局沉降再继续。用 setTimeout 而非 requestAnimationFrame——后台/无焦点的
// 浏览器上下文会暂停 rAF（真机走查抓出：tour 卡在第一拍永不推进），setTimeout 照常 fire。
const settle = () => delay(80)
const beatById = (id: TourBeatId): TourBeat => TOUR_BEATS.find((b) => b.id === id)!

export const useJourneyTourStore = create<JourneyTourState>((set) => {
  const waitNext = () => new Promise<void>((resolve) => { resolveNext = resolve })

  const run = async () => {
    const myToken = (runToken += 1)
    const aborted = () => runToken !== myToken
    const ws = () => useWorkbenchStore.getState()
    set({ phase: 'running', beat: null, teachIndex: 0, selectors: null })

    let teach = 0
    const cinematic = (id: TourBeatId) => set({ beat: beatById(id), selectors: null })
    const spotlight = async (id: TourBeatId, selectors?: string[]) => {
      if (aborted()) return
      teach += 1
      set({ beat: beatById(id), teachIndex: teach, selectors: selectors ?? beatById(id).selectors ?? null })
      await waitNext()
    }

    // ── 创作区：打字回放 ──
    ws().setStoryboardEditorOpen(false)
    ws().setStoryboardPlan(null)
    ws().setWorkspaceMode('creation')
    await settle()
    if (aborted()) return
    cinematic('write')
    await playTypewriter({
      story: DEMO_STORY,
      title: DEMO_PROJECT_NAME,
      setDocument: (doc) => ws().setWorkbenchDocument(doc),
      shouldAbort: aborted,
    })
    await delay(600)
    if (aborted()) return

    // ── 创作区：AI 拆分镜（预置方案直接展示）──
    const plan = buildDemoStoryboardPlan()
    ws().setStoryboardPlan(plan)
    ws().setStoryboardEditorOpen(true)
    cinematic('split')
    await delay(2600)
    if (aborted()) return

    // ── 落画布：走真实流水线 ──
    const args = storyboardPlanToCreateNodesArgs(plan)
    const result = (await applyCanvasToolCall('create_canvas_nodes', args)) as CreateNodesResult
    ws().commitStoryboardPlan()
    ws().setWorkspaceMode('generation')
    ws().requestCanvasFit()
    const map = result?.clientIdToNodeId ?? {}
    // 注入预置成图：示例画布即显成片(status=success),像一个做完的示例项目(诚实——这就是示例项目)。
    const canvas = useGenerationCanvasStore.getState()
    for (const [clientId, nodeId] of Object.entries(map)) {
      const url = DEMO_NODE_IMAGES[clientId]
      if (url && nodeId) {
        canvas.addNodeResult(nodeId, { id: `demo-${clientId}`, type: 'image', url, createdAt: Date.now() })
      }
    }
    const nodeSel = (clientId: string, suffix = ''): string[] => {
      const id = map[clientId]
      return id ? [`[data-node-id="${id}"]${suffix}`, '.generation-canvas-v2-node'] : ['.generation-canvas-v2-node']
    }
    cinematic('canvas')
    await delay(2200)
    if (aborted()) return

    // ── 画布工具：半自动聚光 ──
    await spotlight('character', nodeSel(DEMO_CANVAS_SPOTLIGHTS.character))
    await spotlight('staging', nodeSel(DEMO_CANVAS_SPOTLIGHTS.staging))
    await spotlight('trajectory', nodeSel(DEMO_CANVAS_SPOTLIGHTS.trajectory))
    await spotlight('generate', nodeSel(DEMO_CANVAS_SPOTLIGHTS.generate, ' [aria-label="生成素材"]'))
    if (aborted()) return

    // ── 预览：排进时间轴 + 字幕 / 导出聚光 ──
    try {
      await applyCanvasToolCall('arrange_storyboard_to_timeline', {})
    } catch {
      /* 排片失败不阻断引导 */
    }
    ws().setWorkspaceMode('preview')
    await settle()
    await spotlight('captions')
    await spotlight('export')
    if (aborted()) return
    set({ phase: 'finale', beat: null, selectors: null })
  }

  return {
    active: false,
    phase: 'idle',
    beat: null,
    teachIndex: 0,
    selectors: null,
    start: () => {
      setJourneyTourActive(true)
      set({ active: true, phase: 'running', beat: null, teachIndex: 0, selectors: null })
      void run()
    },
    stop: () => {
      runToken += 1
      resolveNext?.()
      resolveNext = null
      setJourneyTourActive(false)
      set({ active: false, phase: 'idle', beat: null, selectors: null })
    },
    advance: () => {
      const resolve = resolveNext
      resolveNext = null
      resolve?.()
    },
    skip: () => {
      runToken += 1
      resolveNext?.()
      resolveNext = null
      set({ phase: 'finale', beat: null, selectors: null })
    },
    finish: () => {
      markJourneyTourSeen()
      runToken += 1
      resolveNext?.()
      resolveNext = null
      setJourneyTourActive(false)
      set({ active: false, phase: 'idle', beat: null, selectors: null })
    },
  }
})
