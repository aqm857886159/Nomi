// 设计实验室 · 屏「空节点比例」的取景台（2026-10-10 用户拍板 B「视觉中心」，已落生产）。
//
// 这一屏现在只挂生产组件：每一格是生产 `PendingGenerationPlaceholder`（空图 / 空视频的占位，
// 内部就是生产 NodeEmptyState，高度来自节点 size），外加生产 `ProductionShotPlaceholder` 的左上角小标（「已去掉，不生成」，
// 靠种子 run 走真派生）。节点外壳和生产空卡同一套纸底 / 描边 / 阴影。
// 比例清单从生产表派生（labRatios.ts），小尺寸取最小宽 240，视频取生产视频节点的 16:9 与 9:16。
import React, { type JSX } from 'react'
import { cn } from '../../../utils/cn'
import { EMPTY_SURFACE_CLASS, PendingGenerationPlaceholder } from '../../../workbench/generationCanvas/nodes/render/CardCommon'
import { ProductionShotPlaceholder } from '../../../workbench/generationCanvas/nodes/ProductionShotPlaceholder'
import { nodeWidthForAspectRatio } from '../../../workbench/generationCanvas/nodes/nodeSizing'
import { useProductionCanvasLandingStore } from '../../../workbench/production/productionCanvasLandingStore'
import type { GenerationCanvasNode, GenerationNodeKind } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import { useLabLocale } from '../versionCards/versionCardsFlowLabKit'
import { LAB_RATIOS, type LabRatio } from './labRatios'

export const EMPTY_NODE_RATIOS_WIDTH = 2320
export const EMPTY_NODE_RATIOS_HEIGHT = 4300
export const SMALL_NODE_WIDTH = 240

export type FrameSize = { width: number; height: number }
/** 画布上按比例落的节点尺寸：宽按生产规则，高 = 宽 / 比例。 */
export function ratioFrame(ratio: LabRatio): FrameSize {
  const width = nodeWidthForAspectRatio(ratio.value)
  return { width, height: Math.round(width / ratio.value) }
}
/** 小尺寸：同一比例、宽取最小 240，按 1:1 实际像素。 */
export function smallRatioFrame(ratio: LabRatio): FrameSize {
  return { width: SMALL_NODE_WIDTH, height: Math.round(SMALL_NODE_WIDTH / ratio.value) }
}

export type LabLocaleTag = 'zh-CN' | 'en'
export function labLangFromUrl(): LabLocaleTag {
  return new URLSearchParams(window.location.search).get('lang') === 'en' ? 'en' : 'zh-CN'
}

/** 状态小标用的制作 run：每个夹具节点都是「已去掉」，真组件 ProductionShotPlaceholder 据此画「已去掉，不生成」。 */
const LAB_RUN_ID = 'lab-empty-node-ratios'
function seedRemovedShotRun(): void {
  const run = {
    id: LAB_RUN_ID,
    jobs: [],
    gates: [],
    generationPlan: {
      nodeId: 'ner-plan',
      shots: [
        { shotId: 'lab-shot-image', nodeId: 'ner-image' },
        { shotId: 'lab-shot-video', nodeId: 'ner-video' },
      ],
      presentations: [{
        shotIds: ['lab-shot-image', 'lab-shot-video'],
        fromGate: 0,
        closed: true,
        removed: [{ shotId: 'lab-shot-image' }, { shotId: 'lab-shot-video' }],
      }],
    },
  }
  useProductionCanvasLandingStore.getState().setRuns('lab', { [LAB_RUN_ID]: run } as never)
}

/** 夹具节点：尺寸 = 这一格的框，生产占位从 node.size.height 取卡高。 */
function fixtureNode(kind: 'image' | 'video', size: FrameSize): GenerationCanvasNode {
  return {
    id: `ner-${kind}`,
    kind: kind as GenerationNodeKind,
    title: '',
    categoryId: 'shots',
    position: { x: 0, y: 0 },
    size,
    status: 'idle',
    prompt: '',
    meta: { productionRunId: LAB_RUN_ID },
  } as unknown as GenerationCanvasNode
}

function Cell({ caption, kind, size }: { caption: string; kind: 'image' | 'video'; size: FrameSize }): JSX.Element {
  const node = fixtureNode(kind, size)
  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="text-caption text-nomi-ink-60">{caption}</figcaption>
      <div
        className={cn('relative overflow-hidden rounded-nomi shadow-nomi-md ring-1 ring-inset ring-nomi-line', EMPTY_SURFACE_CLASS)}
        style={{ width: size.width, height: size.height }}
        data-lab-node-frame={kind}
      >
        <div className="h-full w-full">
          <PendingGenerationPlaceholder node={node} selected={false} />
        </div>
        <ProductionShotPlaceholder node={node} reportFeedback={() => undefined} />
      </div>
    </figure>
  )
}

const COPY: Record<LabLocaleTag, Record<string, string>> = {
  'zh-CN': {
    title: '空节点比例 · 视觉中心（B，已落生产）',
    real: '图片节点 · 生产比例表全部比例 · 节点宽按生产规则',
    small: '小尺寸 · 节点宽 240（最小）· 1:1 实际像素',
    video: '视频节点 · 16:9 与 9:16',
    tiers: '档位（卡高）：完整 ≥ 166px · 紧凑 ≥ 108px · 只留第一行 < 108px · 块中心在卡高 45%，离顶 ≥ 44px',
  },
  en: {
    title: 'Empty node ratios · visual centre (B, shipped to production)',
    real: 'Image nodes · every ratio in the production table · width by production rule',
    small: 'Small · node width 240 (minimum) · 1:1 actual pixels',
    video: 'Video nodes · 16:9 and 9:16',
    tiers: 'Tiers (card height): full ≥ 166px · compact ≥ 108px · first row only < 108px · block centre at 45% of card height, ≥ 44px from top',
  },
}

/** 整屏：生产比例表全部比例（真宽）+ 小尺寸 240 + 视频。语言由 URL 决定。 */
export function EmptyNodeRatiosOverview(): JSX.Element {
  const locale = labLangFromUrl()
  const ready = useLabLocale(locale)
  seedRemovedShotRun()
  const copy = COPY[locale]
  if (!ready) return <div />
  return (
    <div className="flex flex-col gap-10 bg-nomi-paper p-10 text-nomi-ink-80" style={{ width: EMPTY_NODE_RATIOS_WIDTH }}>
      <h1 className="m-0 text-title font-semibold">{copy.title}</h1>
      <p className="m-0 text-caption text-nomi-ink-60">{copy.tiers}</p>
      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-body-sm font-semibold">{copy.real}</h2>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-8">
          {LAB_RATIOS.map((ratio) => { const size = ratioFrame(ratio); return <Cell key={`real-${ratio.label}`} kind="image" size={size} caption={`${ratio.label} · ${size.width}×${size.height}`} /> })}
        </div>
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-body-sm font-semibold">{copy.small}</h2>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-8">
          {LAB_RATIOS.map((ratio) => { const size = smallRatioFrame(ratio); return <Cell key={`small-${ratio.label}`} kind="image" size={size} caption={`${ratio.label} · ${size.width}×${size.height}`} /> })}
        </div>
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-body-sm font-semibold">{copy.video}</h2>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-8">
          {LAB_RATIOS.filter((ratio) => ratio.label === '16:9' || ratio.label === '9:16').map((ratio) => { const size = ratioFrame(ratio); return <Cell key={`video-${ratio.label}`} kind="video" size={size} caption={`${ratio.label} · ${size.width}×${size.height}`} /> })}
        </div>
      </section>
    </div>
  )
}
