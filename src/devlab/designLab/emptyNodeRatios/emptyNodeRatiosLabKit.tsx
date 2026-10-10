// 设计实验室 · 屏「空节点比例」的取景台（2026-10-10 用户反馈：空节点的 logo + 引导随宽高比排版变形）。
//
// 返工版（协调会话 2026-10-10 裁定）：内容是顶对齐的，比例一变「内容在卡里的重心」跟着变。
// 三种排法并排对照：
//   · 现在：生产 NodeEmptyState（pt-[26px] 顶对齐）+ 生产 NodeTryList，外加生产 ProductionShotPlaceholder 的左上角小标（真组件，靠种子 run 走真派生）。
//   · A 上下居中：块整体垂直居中。
//   · B 视觉中心：块中心放在卡高 45%，离顶至少 44px（给左上角小标让位）。
// A / B 的块都是样张变体（不改生产组件），生产未接，所以覆盖标 missing。
//
// 档位（CSS 像素，卡高；块高按实测：完整 114、紧凑 56、只第一行 24）：
//   完整 ≥ 166  = 44（离顶让位）+ 114（块）+ 8（底留白）
//   紧凑 ≥ 108  = 44 + 56 + 8
//   只第一行 < 108
// 教练给的「约 150 / 约 90」少算了 44px 离顶让位那一截，所以阈值往上取；报告里写明。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconPhoto, IconVideo } from '../../../vendor/tablerIcons'
import { cn } from '../../../utils/cn'
import { NodeEmptyState } from '../../../workbench/generationCanvas/nodes/render/NodeEmptyState'
import { EMPTY_SURFACE_CLASS } from '../../../workbench/generationCanvas/nodes/render/CardCommon'
import { NodeTryList } from '../../../workbench/generationCanvas/quickActions/NodeTryList'
import { ProductionShotPlaceholder } from '../../../workbench/generationCanvas/nodes/ProductionShotPlaceholder'
import { nodeWidthForAspectRatio } from '../../../workbench/generationCanvas/nodes/nodeSizing'
import { useProductionCanvasLandingStore } from '../../../workbench/production/productionCanvasLandingStore'
import type { GenerationCanvasNode, GenerationNodeKind } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import { useLabLocale } from '../versionCards/versionCardsFlowLabKit'

/** 整屏宽：三排 6 格（最宽 420）+ 间距 + 边距；高随内容。 */
export const EMPTY_NODE_RATIOS_WIDTH = 2320
export const EMPTY_NODE_RATIOS_HEIGHT = 4300

/** 左上角小标让位：离顶至少这么多，保证小标永远碰不到块的图标。 */
export const BADGE_CLEAR_TOP = 44
const BLOCK_FULL_H = 114
const BLOCK_COMPACT_H = 56
const BLOCK_ICON_H = 24
const BLOCK_WIDTH = 240
/** 档位阈值（卡高，CSS 像素）。 */
export const TIER_FULL_MIN = BADGE_CLEAR_TOP + BLOCK_FULL_H + 8
export const TIER_COMPACT_MIN = BADGE_CLEAR_TOP + BLOCK_COMPACT_H + 8

export const SMALL_NODE_WIDTH = 240

export type RatioSpec = { id: string; label: string; value: number }
export const RATIOS: readonly RatioSpec[] = [
  { id: '1-1', label: '1:1', value: 1 },
  { id: '16-9', label: '16:9', value: 16 / 9 },
  { id: '9-16', label: '9:16', value: 9 / 16 },
  { id: '4-3', label: '4:3', value: 4 / 3 },
  { id: '3-4', label: '3:4', value: 3 / 4 },
  { id: '21-9', label: '21:9', value: 21 / 9 },
]

export type FrameSize = { width: number; height: number }
/** 画布上按比例落的节点尺寸：宽按生产规则，高 = 宽 / 比例。 */
export function ratioFrame(ratio: RatioSpec): FrameSize {
  const width = nodeWidthForAspectRatio(ratio.value)
  return { width, height: Math.round(width / ratio.value) }
}
/** 小尺寸：同一比例、宽取最小 240，按 1:1 实际像素。 */
export function smallRatioFrame(ratio: RatioSpec): FrameSize {
  return { width: SMALL_NODE_WIDTH, height: Math.round(SMALL_NODE_WIDTH / ratio.value) }
}

export type RuledTier = 'full' | 'compact' | 'icon'
export function ruledTier(height: number): RuledTier {
  if (height >= TIER_FULL_MIN) return 'full'
  if (height >= TIER_COMPACT_MIN) return 'compact'
  return 'icon'
}
export type Layout = 'A' | 'B'

/** 块顶到卡顶的距离：A 整体垂直居中；B 块中心落在卡高 45%，且不低于 BADGE_CLEAR_TOP。 */
export function blockTop(layout: Layout, tier: RuledTier, height: number): number {
  const blockH = tier === 'full' ? BLOCK_FULL_H : tier === 'compact' ? BLOCK_COMPACT_H : BLOCK_ICON_H
  if (layout === 'A') return Math.max(0, Math.round((height - blockH) / 2))
  return Math.max(BADGE_CLEAR_TOP, Math.round(height * 0.45 - blockH / 2))
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

function fixtureNode(kind: 'image' | 'video'): GenerationCanvasNode {
  return {
    id: `ner-${kind}`,
    kind: kind as GenerationNodeKind,
    title: '',
    categoryId: 'shots',
    position: { x: 0, y: 0 },
    size: { width: 340, height: 280 },
    status: 'idle',
    prompt: '',
    meta: { productionRunId: LAB_RUN_ID },
  } as unknown as GenerationCanvasNode
}

/** 节点外壳：和生产空卡同一套纸底 + 描边 + 阴影。relative 让左上角小标定位到这里。 */
export function NodeFrame({ size, children }: { size: FrameSize; children: React.ReactNode }): JSX.Element {
  return (
    <div
      className={cn('relative overflow-hidden rounded-nomi shadow-nomi-md ring-1 ring-inset ring-nomi-line', EMPTY_SURFACE_CLASS)}
      style={{ width: size.width, height: size.height }}
    >
      {children}
    </div>
  )
}

function Figure({ caption, size, children }: { caption: string; size: FrameSize; children: React.ReactNode }): JSX.Element {
  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="text-caption text-nomi-ink-60">{caption}</figcaption>
      <div style={{ width: size.width, height: size.height }}>{children}</div>
    </figure>
  )
}

/** 现在：生产 NodeEmptyState + NodeTryList 原样，外加生产左上角小标。 */
export function NowEmptyNode({ kind, size }: { kind: 'image' | 'video'; size: FrameSize }): JSX.Element {
  const { t } = useTranslation()
  const isVideo = kind === 'video'
  const node = fixtureNode(kind)
  return (
    <NodeFrame size={size}>
      <div className="h-full w-full">
        <NodeEmptyState
          icon={isVideo ? <IconVideo size={20} stroke={1.6} /> : <IconPhoto size={20} stroke={1.6} />}
          title={t(isVideo ? 'canvas.nodeKinds.video' : 'canvas.nodeKinds.image')}
          description={t(isVideo ? 'generationCommon.nodeTry.status.video' : 'generationCommon.nodeTry.status.image')}
          action={<NodeTryList node={node} />}
        />
      </div>
      <ProductionShotPlaceholder node={node} reportFeedback={() => undefined} />
    </NodeFrame>
  )
}

/** A / B：样张变体的块（生产未接）。块宽固定 240，位置由 blockTop 决定。 */
export function RuledBlockNode({ kind, size, layout }: { kind: 'image' | 'video'; size: FrameSize; layout: Layout }): JSX.Element {
  const { t } = useTranslation()
  const isVideo = kind === 'video'
  const node = fixtureNode(kind)
  const tier = ruledTier(size.height)
  const top = blockTop(layout, tier, size.height)
  const title = t(isVideo ? 'canvas.nodeKinds.video' : 'canvas.nodeKinds.image')
  const status = t(isVideo ? 'generationCommon.nodeTry.status.video' : 'generationCommon.nodeTry.status.image')
  const iconNode = isVideo ? <IconVideo size={20} stroke={1.6} /> : <IconPhoto size={20} stroke={1.6} />
  const iconBadge = (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-nomi-ink-05 text-nomi-ink-80 ring-1 ring-inset ring-nomi-line',
        tier === 'full' ? 'size-9 [&>svg]:size-[18px]' : 'size-6 [&>svg]:size-3.5',
      )}
      aria-hidden="true"
    >
      {iconNode}
    </span>
  )
  return (
    <NodeFrame size={size}>
      <div className="absolute inset-x-0 flex justify-center" style={{ top }} data-ruled-tier={tier} data-ruled-layout={layout}>
        <div className="flex flex-col items-center" style={{ width: BLOCK_WIDTH }}>
          {tier === 'full' ? (
            <>
              {iconBadge}
              <span className="mt-2 text-body-sm font-semibold leading-[18px] text-nomi-ink-80">{title}</span>
              <span className="text-caption leading-4 text-nomi-ink-40">{status}</span>
              <div className="mt-3 flex h-6 w-full justify-center"><NodeTryList node={node} /></div>
            </>
          ) : tier === 'compact' ? (
            <>
              <div className="flex h-6 items-center gap-1.5 text-caption text-nomi-ink-80">
                {iconBadge}
                <span className="whitespace-nowrap">{`${title} · ${status}`}</span>
              </div>
              <div className="mt-2 flex h-6 w-full justify-center"><NodeTryList node={node} /></div>
            </>
          ) : (
            <div className="flex h-6 items-center gap-1.5 text-caption text-nomi-ink-80">
              {iconBadge}
              <span className="whitespace-nowrap">{`${title} · ${status}`}</span>
            </div>
          )}
        </div>
      </div>
      <ProductionShotPlaceholder node={node} reportFeedback={() => undefined} />
    </NodeFrame>
  )
}

type Variant = { kind: 'now' } | { kind: 'ruled'; layout: Layout }

function Cell({ caption, kind, size, variant }: { caption: string; kind: 'image' | 'video'; size: FrameSize; variant: Variant }): JSX.Element {
  return (
    <Figure caption={caption} size={size}>
      {variant.kind === 'now' ? <NowEmptyNode kind={kind} size={size} /> : <RuledBlockNode kind={kind} size={size} layout={variant.layout} />}
    </Figure>
  )
}

const COPY: Record<LabLocaleTag, Record<string, string>> = {
  'zh-CN': {
    title: '空节点比例 · 现在 / A 上下居中 / B 视觉中心',
    now: '现在 · 生产 NodeEmptyState 原样 + 真左上角小标',
    a: 'A · 上下居中（块整体垂直居中）',
    b: 'B · 视觉中心（块中心在卡高 45%，离顶至少 44px）',
    small: '小尺寸 · 节点宽 240（最小）· 1:1 实际像素 · A',
    smallB: '小尺寸 · 节点宽 240（最小）· 1:1 实际像素 · B',
    mixA: '混排 · 同一行 1:1 / 16:9 / 9:16 顶边对齐 · A',
    mixB: '混排 · 同一行 1:1 / 16:9 / 9:16 顶边对齐 · B',
    video: '视频对照 · 16:9 与 9:16 · 现在 / A / B',
    tiers: `档位（卡高）：完整 ≥ ${TIER_FULL_MIN}px · 紧凑 ≥ ${TIER_COMPACT_MIN}px · 只留第一行 < ${TIER_COMPACT_MIN}px`,
  },
  en: {
    title: 'Empty node ratios · now / A vertically centred / B visual centre',
    now: 'Now · production NodeEmptyState as-is + real top-left badge',
    a: 'A · vertically centred (block centred in the card)',
    b: 'B · visual centre (block centre at 45% of card height, at least 44px from top)',
    small: 'Small · node width 240 (minimum) · 1:1 actual pixels · A',
    smallB: 'Small · node width 240 (minimum) · 1:1 actual pixels · B',
    mixA: 'Mixed · 1:1 / 16:9 / 9:16 top-aligned in one row · A',
    mixB: 'Mixed · 1:1 / 16:9 / 9:16 top-aligned in one row · B',
    video: 'Video comparison · 16:9 and 9:16 · now / A / B',
    tiers: `Tiers (card height): full ≥ ${TIER_FULL_MIN}px · compact ≥ ${TIER_COMPACT_MIN}px · first row only < ${TIER_COMPACT_MIN}px`,
  },
}

function labelOf(ratio: RatioSpec, size: FrameSize): string {
  return `${ratio.label} · ${size.width}×${size.height}`
}

/** 整屏：现在 / A / B（真实宽）+ 小尺寸 A、B + 混排 A、B + 视频对照。语言由 URL 决定。 */
export function EmptyNodeRatiosOverview(): JSX.Element {
  const locale = labLangFromUrl()
  const ready = useLabLocale(locale)
  seedRemovedShotRun()
  const copy = COPY[locale]
  if (!ready) return <div />
  const mix = [RATIOS[0]!, RATIOS[1]!, RATIOS[2]!]
  const row = (items: readonly RatioSpec[], sizeOf: (ratio: RatioSpec) => FrameSize, variant: Variant, keyPrefix: string) => (
    <div className="flex items-start gap-6">
      {items.map((ratio) => {
        const size = sizeOf(ratio)
        return <Cell key={`${keyPrefix}-${ratio.id}`} variant={variant} kind="image" size={size} caption={labelOf(ratio, size)} />
      })}
    </div>
  )
  return (
    <div className="flex flex-col gap-10 bg-nomi-paper p-10 text-nomi-ink-80" style={{ width: EMPTY_NODE_RATIOS_WIDTH }}>
      <h1 className="m-0 text-title font-semibold">{copy.title}</h1>
      <p className="m-0 text-caption text-nomi-ink-60">{copy.tiers}</p>

      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-body-sm font-semibold">{copy.now}</h2>
        {row(RATIOS, ratioFrame, { kind: 'now' }, 'now')}
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-body-sm font-semibold">{copy.a}</h2>
        {row(RATIOS, ratioFrame, { kind: 'ruled', layout: 'A' }, 'a')}
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-body-sm font-semibold">{copy.b}</h2>
        {row(RATIOS, ratioFrame, { kind: 'ruled', layout: 'B' }, 'b')}
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-body-sm font-semibold">{copy.small}</h2>
        {row(RATIOS, smallRatioFrame, { kind: 'ruled', layout: 'A' }, 'small-a')}
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-body-sm font-semibold">{copy.smallB}</h2>
        {row(RATIOS, smallRatioFrame, { kind: 'ruled', layout: 'B' }, 'small-b')}
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-body-sm font-semibold">{copy.mixA}</h2>
        {row(mix, ratioFrame, { kind: 'ruled', layout: 'A' }, 'mix-a')}
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-body-sm font-semibold">{copy.mixB}</h2>
        {row(mix, ratioFrame, { kind: 'ruled', layout: 'B' }, 'mix-b')}
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-body-sm font-semibold">{copy.video}</h2>
        <div className="flex items-start gap-6">
          {[RATIOS[1]!, RATIOS[2]!].map((ratio) => {
            const size = ratioFrame(ratio)
            return (
              <React.Fragment key={`vid-${ratio.id}`}>
                <Cell variant={{ kind: 'now' }} kind="video" size={size} caption={`${labelOf(ratio, size)} · now`} />
                <Cell variant={{ kind: 'ruled', layout: 'A' }} kind="video" size={size} caption={`${labelOf(ratio, size)} · A`} />
                <Cell variant={{ kind: 'ruled', layout: 'B' }} kind="video" size={size} caption={`${labelOf(ratio, size)} · B`} />
              </React.Fragment>
            )
          })}
        </div>
      </section>
    </div>
  )
}
