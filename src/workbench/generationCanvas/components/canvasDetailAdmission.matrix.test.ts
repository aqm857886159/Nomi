import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LIGHTWEIGHT_NODE_ZOOM_THRESHOLD,
  isZoomedOutForLightweight,
  shouldRenderFullNodeContent,
} from './canvasNodeLevelOfDetail'
import { GENERATION_NODE_KINDS, generationNodeKindOwnsZoomTiers } from '../model/generationNodeKinds'
import { shotTableDensityForZoom } from '../reactFlow/canvasViewportScale'

/**
 * 类检查：「这张卡画多细」只看两件事——看不看得清（缩放）、用户在不在对它做事（唯一选中、画布外点名闪烁），
 * 外加这一种卡是否自己按缩放分档画远看（登记表 ownsZoomTiers）。节点数、卡片状态都不是输入。
 * 设计卡 docs/plan/2026-10-31-canvas-detail-admission.md ★9 A1–A3 / 反例 X1–X8。
 *
 * 矩阵 = 缩放档 × 节点数 × 交互 × 登记表里的每一种卡。节点数这一维在纯函数这一层传不进来（结构上做不出来），
 * 所以它的每一格都必须和不看节点数的期望一致；节点外壳那一层由下面的源码检查钉住（不订节点总数）。
 */
const here = path.dirname(fileURLToPath(import.meta.url))

const ZOOM_CELLS = [0.2, 0.3, 0.45, 0.549, LIGHTWEIGHT_NODE_ZOOM_THRESHOLD, 0.8, 1, 3] as const
/** 旧判据的门槛两侧（80 / 81）和反馈现场（60）都在里面：任何「按节点数切」的判据都会在某一列翻。 */
const NODE_COUNT_CELLS = [1, 20, 60, 80, 81, 150, 600] as const
const INTERACTION_CELLS = [
  { name: 'none', primarySelection: false, focusFlash: false },
  { name: 'primary-selection', primarySelection: true, focusFlash: false },
  // 多选中的一员：节点外壳把它算成「不是唯一选中」（data.primarySelection 只在恰好选中一张时为真）。
  { name: 'multi-selection-member', primarySelection: false, focusFlash: false },
  { name: 'focus-flash', primarySelection: false, focusFlash: true },
] as const
/** 自己管远看的种类。改这份清单 = 有意识地决定一种卡缩远了也不换成通用轻量卡（登记表 ownsZoomTiers）。 */
const KINDS_OWNING_ZOOM_TIERS = ['shot_table', 'clip'] as const

function expectedFull(zoom: number, kind: string, interaction: (typeof INTERACTION_CELLS)[number]): boolean {
  if (zoom >= LIGHTWEIGHT_NODE_ZOOM_THRESHOLD) return true
  if ((KINDS_OWNING_ZOOM_TIERS as readonly string[]).includes(kind)) return true
  return interaction.primarySelection || interaction.focusFlash
}

/** 节点外壳那一层的准入：除了这四个输入，它拿不到别的（节点数、卡片状态都不在入参里）。 */
function admit(input: { zoom: number; nodeCount: number; kind: (typeof GENERATION_NODE_KINDS)[number]; interaction: (typeof INTERACTION_CELLS)[number] }): boolean {
  return shouldRenderFullNodeContent({
    zoomedOut: isZoomedOutForLightweight(input.zoom),
    ownsZoomTiers: generationNodeKindOwnsZoomTiers(input.kind),
    primarySelection: input.interaction.primarySelection,
    focusFlash: input.interaction.focusFlash,
  })
}

describe('canvas detail admission matrix (zoom × node count × interaction × kind)', () => {
  for (const zoom of ZOOM_CELLS) {
    for (const interaction of INTERACTION_CELLS) {
      it(`zoom ${zoom} · ${interaction.name}: every kind, every node count`, () => {
        for (const kind of GENERATION_NODE_KINDS) {
          const expected = expectedFull(zoom, kind, interaction)
          for (const nodeCount of NODE_COUNT_CELLS) {
            expect(admit({ zoom, nodeCount, kind, interaction }), `${kind} @ ${nodeCount} nodes`).toBe(expected)
          }
        }
      })
    }
  }

  it('the zoom boundary: 0.55 is readable (full), just below it is not', () => {
    expect(isZoomedOutForLightweight(LIGHTWEIGHT_NODE_ZOOM_THRESHOLD)).toBe(false)
    expect(isZoomedOutForLightweight(LIGHTWEIGHT_NODE_ZOOM_THRESHOLD - 0.001)).toBe(true)
  })

  it('kinds that own their far view are exactly the enumerated list', () => {
    expect(GENERATION_NODE_KINDS.filter(generationNodeKindOwnsZoomTiers)).toEqual([...KINDS_OWNING_ZOOM_TIERS])
    // 分镜表远看确实由它自己画（拍板稿图 4：远 / 中 / 近三档）——声明不是空话。
    expect(shotTableDensityForZoom(0.2)).toBe('card')
  })

  it('every kind that owns its far view really reads the canvas zoom', () => {
    // 声明的依据：组件自己订画布缩放。不读缩放还声明，就是白白在远看挂整卡（判据的口子）。
    const sources: Record<(typeof KINDS_OWNING_ZOOM_TIERS)[number], string> = {
      shot_table: '../nodes/shotTable/ShotTableNode.tsx',
      clip: '../nodes/ClipNode.tsx',
    }
    for (const kind of KINDS_OWNING_ZOOM_TIERS) {
      expect(fs.readFileSync(path.join(here, sources[kind]), 'utf8'), kind).toMatch(/selectFlowZoom|useCanvasLiveZoom/)
    }
  })
})

describe('the node shell only feeds the admission what it is allowed to see', () => {
  const source = fs.readFileSync(path.join(here, '../reactFlow/GenerationCanvasReactFlowNodes.tsx'), 'utf8')
  const shell = source.slice(source.indexOf('export function GenerationFlowNodeView'), source.indexOf('export function GenerationFlowEdgeView'))

  it('does not subscribe to how many nodes the canvas has', () => {
    expect(shell).not.toMatch(/nodes\.length/)
    expect(shell).not.toMatch(/isLargeCanvas|LIGHTWEIGHT_NODE_RENDER_THRESHOLD|retain\w*Lightweight/)
  })

  it('passes exactly the four admission inputs', () => {
    const call = shell.match(/shouldRenderFullNodeContent\(\{([\s\S]*?)\}\)/)
    expect(call).not.toBeNull()
    const keys = (call?.[1] ?? '').split('\n').map((line) => line.trim().split(':')[0].replace(/,$/, '')).filter(Boolean).sort()
    expect(keys).toEqual(['focusFlash', 'ownsZoomTiers', 'primarySelection', 'zoomedOut'])
  })
})
