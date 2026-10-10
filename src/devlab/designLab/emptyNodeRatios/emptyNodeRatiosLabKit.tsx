// 设计实验室 · 屏「空节点比例」的取景台（2026-10-10 用户反馈：空节点的 logo + 引导随宽高比排版变形）。
//
// 上排「现在」= 生产 `NodeEmptyState` 原样 + 生产 `NodeTryList`，挂在和 CardCommon 同一套节点外壳里，
// 节点尺寸 = 生产 `nodeWidthForAspectRatio`（画布上图片 / 视频按比例落的宽）、高 = 宽 / 比例。
// 下排「新规矩」= 本文件里的 `RuledEmptyBlock`（**样张变体，不改生产组件**，生产未接，所以 coverage: missing）。
//
// 新规矩（协调会话 2026-10-10 定，按这个出）：
//   1. 内容是固定大小的块，不随卡片宽高比 / 尺寸缩放、拉伸、变形；
//   2. 块离卡片顶边 28px（`pt-7`，token 间距），水平居中，从顶往下排，不上下居中；
//   3. 卡内高放不下完整块 → 紧凑版（第一行图标 + 「类型 · 状态」，第二行动作）；再放不下 → 只留第一行；
//   4. 只用设计系统 token，不新写全局 CSS。
//
// 尺寸档（CSS 像素，和卡片真实高度比）：完整块需 28 + 114 + 12 = 154；紧凑需 24 + 24 + 8 + 24 + 12 = 92；
// 只留第一行需 24 + 24 + 12 = 60。缩放只改视觉大小，不改 CSS 排版，所以「缩放 50%」那一组是
// 同一套 CSS 尺寸（最小宽 240）整体缩到一半看视觉，紧凑档的判断看的是 CSS 高。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconPhoto, IconVideo } from '../../../vendor/tablerIcons'
import { cn } from '../../../utils/cn'
import { NodeEmptyState } from '../../../workbench/generationCanvas/nodes/render/NodeEmptyState'
import { EMPTY_SURFACE_CLASS } from '../../../workbench/generationCanvas/nodes/render/CardCommon'
import { NodeTryList } from '../../../workbench/generationCanvas/quickActions/NodeTryList'
import { nodeWidthForAspectRatio } from '../../../workbench/generationCanvas/nodes/nodeSizing'
import type { GenerationCanvasNode, GenerationNodeKind } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import { useLabLocale } from '../versionCards/versionCardsFlowLabKit'

type LabLocaleTag = 'zh-CN' | 'en'

/** 整屏取景宽：两排各 6 张（最宽 420）+ 间距 + 左右边距。 */
export const EMPTY_NODE_RATIOS_WIDTH = 2320
export const EMPTY_NODE_RATIOS_HEIGHT = 2300

/** 新规矩的三个尺寸档阈值（CSS 像素，高度）。 */
export const RULED_FULL_MIN_HEIGHT = 154
export const RULED_COMPACT_MIN_HEIGHT = 92

/** 最小节点宽（生产 MIN_NODE_WIDTH 下限附近，用于「小尺寸」一组）。 */
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

/** 画布上按比例落的节点尺寸：宽按生产规则（nodeWidthForAspectRatio），高 = 宽 / 比例。 */
export function ratioFrame(ratio: RatioSpec): FrameSize {
  const width = nodeWidthForAspectRatio(ratio.value)
  return { width, height: Math.round(width / ratio.value) }
}

/** 小尺寸：同一比例、宽取最小（240），高 = 宽 / 比例。 */
export function smallRatioFrame(ratio: RatioSpec): FrameSize {
  return { width: SMALL_NODE_WIDTH, height: Math.round(SMALL_NODE_WIDTH / ratio.value) }
}

export type RuledTier = 'full' | 'compact' | 'icon'

export function ruledTier(height: number): RuledTier {
  if (height >= RULED_FULL_MIN_HEIGHT) return 'full'
  if (height >= RULED_COMPACT_MIN_HEIGHT) return 'compact'
  return 'icon'
}

/** 语言从 URL 读（`?lang=en`），一屏两种语言共用同一个状态 id；默认中文。 */
export function labLangFromUrl(): LabLocaleTag {
  return new URLSearchParams(window.location.search).get('lang') === 'en' ? 'en' : 'zh-CN'
}

/** 夹具节点：只给 NodeTryList 判配方用（kind 决定动作行），位置尺寸不参与排版。 */
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
    meta: {},
  } as unknown as GenerationCanvasNode
}

/** 节点外壳：和生产空卡同一套纸底 + 描边 + 阴影，尺寸是这一格要钉的那一个。 */
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

/** 格子：标题 + 按缩放变形的节点外壳（zoom 只做视觉缩放，同 canvas 的 transform 缩放）。 */
function Figure({ caption, size, zoom = 1, children }: { caption: string; size: FrameSize; zoom?: number; children: React.ReactNode }): JSX.Element {
  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="text-caption text-nomi-ink-60">{caption}</figcaption>
      <div style={{ width: size.width * zoom, height: size.height * zoom }}>
        <div style={{ width: size.width, height: size.height, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>{children}</div>
      </div>
    </figure>
  )
}

/** 「现在」：生产 CardCommon 里空图 / 空视频卡的那段（NodeEmptyState + NodeTryList）原样。 */
export function NowEmptyNode({ kind, size }: { kind: 'image' | 'video'; size: FrameSize }): JSX.Element {
  const { t } = useTranslation()
  const isVideo = kind === 'video'
  const icon = isVideo ? <IconVideo size={20} stroke={1.6} /> : <IconPhoto size={20} stroke={1.6} />
  return (
    <NodeFrame size={size}>
      <div className="h-full w-full">
        <NodeEmptyState
          icon={icon}
          title={t(isVideo ? 'canvas.nodeKinds.video' : 'canvas.nodeKinds.image')}
          description={t(isVideo ? 'generationCommon.nodeTry.status.video' : 'generationCommon.nodeTry.status.image')}
          action={<NodeTryList node={fixtureNode(kind)} />}
        />
      </div>
    </NodeFrame>
  )
}

/** 「新规矩」：固定大小的块，顶距 28px、水平居中；卡矮了切紧凑版，再矮只留第一行。样张变体，不是生产组件。 */
export function RuledEmptyBlock({ kind, size }: { kind: 'image' | 'video'; size: FrameSize }): JSX.Element {
  const { t } = useTranslation()
  const isVideo = kind === 'video'
  const tier = ruledTier(size.height)
  const title = t(isVideo ? 'canvas.nodeKinds.video' : 'canvas.nodeKinds.image')
  const status = t(isVideo ? 'generationCommon.nodeTry.status.video' : 'generationCommon.nodeTry.status.image')
  const iconSize = tier === 'full' ? 'size-9 [&>svg]:size-[18px]' : 'size-6 [&>svg]:size-3.5'
  const iconNode = isVideo ? <IconVideo size={20} stroke={1.6} /> : <IconPhoto size={20} stroke={1.6} />
  const iconBadge = (
    <span className={cn('grid shrink-0 place-items-center rounded-full bg-nomi-ink-05 text-nomi-ink-80 ring-1 ring-inset ring-nomi-line', iconSize)} aria-hidden="true">
      {iconNode}
    </span>
  )
  if (tier === 'full') {
    return (
      <NodeFrame size={size}>
        <div className="flex h-full w-full justify-center pt-7">
          {/* 固定块：高 114、宽 240，内容从顶往下排。 */}
          <div className="flex h-[114px] w-[240px] flex-col items-center">
            {iconBadge}
            <span className="mt-2 text-body-sm font-semibold leading-[18px] text-nomi-ink-80">{title}</span>
            <span className="text-caption leading-4 text-nomi-ink-40">{status}</span>
            <div className="mt-3 flex h-6 w-full justify-center">
              <NodeTryList node={fixtureNode(kind)} />
            </div>
          </div>
        </div>
      </NodeFrame>
    )
  }
  if (tier === 'compact') {
    return (
      <NodeFrame size={size}>
        <div className="flex h-full w-full justify-center pt-6">
          {/* 紧凑块：第一行图标 + 「类型 · 状态」，第二行动作。 */}
          <div className="flex w-[240px] flex-col items-center gap-2">
            <div className="flex h-6 items-center gap-1.5 text-caption text-nomi-ink-80">
              {iconBadge}
              <span className="whitespace-nowrap">{`${title} · ${status}`}</span>
            </div>
            <div className="flex h-6 w-full justify-center">
              <NodeTryList node={fixtureNode(kind)} />
            </div>
          </div>
        </div>
      </NodeFrame>
    )
  }
  return (
    <NodeFrame size={size}>
      <div className="flex h-full w-full justify-center pt-6">
        {/* 只留第一行：动作照旧在 + 菜单和生成框里。 */}
        <div className="flex h-6 w-[240px] items-center justify-center gap-1.5 text-caption text-nomi-ink-80">
          {iconBadge}
          <span className="whitespace-nowrap">{`${title} · ${status}`}</span>
        </div>
      </div>
    </NodeFrame>
  )
}

/** 一格：标题 + 节点外壳（zoom 为 0.5 时是「缩放 50%」的视觉大小）。 */
function Cell({ caption, kind, size, zoom, variant }: { caption: string; kind: 'image' | 'video'; size: FrameSize; zoom?: number; variant: 'now' | 'ruled' }): JSX.Element {
  return (
    <Figure caption={caption} size={size} zoom={zoom}>
      {variant === 'now' ? <NowEmptyNode kind={kind} size={size} /> : <RuledEmptyBlock kind={kind} size={size} />}
    </Figure>
  )
}

const COPY: Record<LabLocaleTag, Record<string, string>> = {
  'zh-CN': {
    title: '空节点比例 · 图片节点空态随宽高比变形',
    now: '现在 · 生产 NodeEmptyState 原样（按节点宽高比落位）',
    ruled: '新规矩 · 固定块、顶距 28px、水平居中（样张变体，生产未接）',
    small: '小尺寸 · 节点宽 240（最小）· 视觉缩放 50%：现在 / 新规矩',
    tiers: '档位：完整 ≥ 154px · 紧凑 ≥ 92px · 只留第一行 < 92px',
    video: '视频对照（16:9 / 9:16）· 现在 / 新规矩',
    stress: '极限：21:9 宽 200（低于最小宽，只为看第一行档）',
    lang: '中文',
  },
  en: {
    title: 'Empty node ratios · image empty state reflows with aspect ratio',
    now: 'Now · production NodeEmptyState as-is (placed by node aspect ratio)',
    ruled: 'New rule · fixed block, 28px from top, centred (lab variant, not wired)',
    small: 'Small · node width 240 (minimum) · visual zoom 50%: now / new',
    tiers: 'Tiers: full ≥ 154px · compact ≥ 92px · first row only < 92px',
    video: 'Video comparison (16:9 / 9:16) · now / new',
    stress: 'Stress: 21:9 at width 200 (below minimum, to show the first-row tier)',
    lang: 'English',
  },
}

/** 整屏：四排（现在 / 新规矩 / 小尺寸 now+new / 视频对照），语言由 URL 决定。 */
export function EmptyNodeRatiosOverview(): JSX.Element {
  const locale = labLangFromUrl()
  const ready = useLabLocale(locale)
  const copy = COPY[locale]
  if (!ready) return <div />
  return (
    <div className="flex flex-col gap-10 bg-nomi-paper p-10 text-nomi-ink-80" style={{ width: EMPTY_NODE_RATIOS_WIDTH, height: EMPTY_NODE_RATIOS_HEIGHT }}>
      <h1 className="m-0 text-title font-semibold">{copy.title}</h1>
      <p className="m-0 text-caption text-nomi-ink-60">{copy.tiers}</p>

      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-body-sm font-semibold">{copy.now}</h2>
        <div className="flex items-start gap-6">
          {RATIOS.map((ratio) => (
            <Cell key={ratio.id} variant="now" kind="image" size={ratioFrame(ratio)} caption={`${ratio.label} · ${ratioFrame(ratio).width}×${ratioFrame(ratio).height}`} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-body-sm font-semibold">{copy.ruled}</h2>
        <div className="flex items-start gap-6">
          {RATIOS.map((ratio) => (
            <Cell key={ratio.id} variant="ruled" kind="image" size={ratioFrame(ratio)} caption={`${ratio.label} · ${ratioFrame(ratio).width}×${ratioFrame(ratio).height}`} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-body-sm font-semibold">{copy.small}</h2>
        <div className="flex items-start gap-6">
          {RATIOS.map((ratio) => (
            <Cell key={`now-${ratio.id}`} variant="now" kind="image" zoom={0.5} size={smallRatioFrame(ratio)} caption={`${ratio.label} · ${smallRatioFrame(ratio).width}×${smallRatioFrame(ratio).height}`} />
          ))}
        </div>
        <div className="flex items-start gap-6">
          {RATIOS.map((ratio) => (
            <Cell key={`ruled-${ratio.id}`} variant="ruled" kind="image" zoom={0.5} size={smallRatioFrame(ratio)} caption={`${ratio.label} · ${smallRatioFrame(ratio).width}×${smallRatioFrame(ratio).height}`} />
          ))}
          <Cell variant="ruled" kind="image" zoom={0.5} size={{ width: 200, height: Math.round(200 / (21 / 9)) }} caption={copy.stress} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-body-sm font-semibold">{copy.video}</h2>
        <div className="flex items-start gap-6">
          <Cell variant="now" kind="video" size={ratioFrame(RATIOS[1]!)} caption={`${RATIOS[1]!.label} · now`} />
          <Cell variant="ruled" kind="video" size={ratioFrame(RATIOS[1]!)} caption={`${RATIOS[1]!.label} · new`} />
          <Cell variant="now" kind="video" size={ratioFrame(RATIOS[2]!)} caption={`${RATIOS[2]!.label} · now`} />
          <Cell variant="ruled" kind="video" size={ratioFrame(RATIOS[2]!)} caption={`${RATIOS[2]!.label} · new`} />
        </div>
      </section>
    </div>
  )
}
