// 聊天里的指向元素（NodePointer 板，2026-10-23 D2）：代表画布上的一个节点，长得和节点一样，点一下去节点。
//
// 一个零件三种密度（P2 是 P1 的窄屏 / 行内形态，不是第二套）：
//   card = P1 镜像小卡（标题行在框外、画面同节点比例、下面一行只读摘要）；
//   row  = P2 列表行（小缩略图 + 标题行 + 摘要 + 行尾状态图标）；
//   chip = P2 句中小标签（圆缩略图 + 镜号 + 名字，嵌在 Agent 的话里自然折行）。
// 节点的数据一样都不存：只订自己那一个节点（不随整个画布重渲），脸的判序在 nodePointerFace.ts；
// 标题行、制作小标、状态条、等待面都挂节点自己的那几个组件 / 函数。悬停两边同亮，一律中性样式（不许蓝色描边，蓝只留在转圈上）。
// 先不接进聊天：第②步只在设计实验室搭全状态，第③步（新付费卡）才有第一个宿主。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconClockSearch,
  IconFocus2,
  IconLinkOff,
  IconLoader2,
  IconPlayerPause,
} from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { useNodeExternalHighlightStore } from '../../generationCanvas/store/nodeExternalHighlightStore'
import { getGenerationNodeIcon } from '../../generationCanvas/nodes/renderRegistry'
import { GenerationWaitingSurface } from '../../generationCanvas/nodes/GenerationWaitingSurface'
import { NodeCornerPill } from '../../generationCanvas/nodes/ProductionShotPlaceholder'
import { productionShotCornerText } from '../../generationCanvas/nodes/productionShotCorner'
import { NodeShotLabel, ShotNumberPill } from '../../generation/list/CanvasListLinks'
import { nodePointerLocatable, pointerCenterTier, type NodePointerFace } from './nodePointerFace'
import {
  SLOT_ASPECT,
  frameTone,
  frameWidthPercent,
  usePointerModel,
  type NodePointerDensity,
  type NodePointerSubject,
  type PointerModel,
  type Translate,
} from './nodePointerModel'
import { useNodePointerStore } from './nodePointerStore'
import { revealNodeFromChat } from './revealNodeFromChat'

export type { NodePointerDensity, NodePointerSubject } from './nodePointerModel'

/** 单个竖版槽高固定、宽按真比例（组里一格的 16:9 槽见 nodePointerModel 的 SLOT_ASPECT）。 */
const SIDE_SLOT_HEIGHT = 96


/** 读屏念的名字。失败时宿主给的结局（例如「没有发出去」）也要念：它是「这一镜有没有发出去、钱有没有花」的事实，不只念节点自己的原因。 */
function ariaLabel(t: Translate, model: PointerModel, outcome?: string): string {
  if (model.face.kind === 'removed') return t('nodePointer.ariaDeleted', { name: model.name })
  if (model.face.kind === 'unavailable') return t('nodePointer.ariaUnavailable', { name: model.name })
  if (outcome && model.status) return t('nodePointer.ariaOutcome', { name: model.name, status: model.status, outcome })
  const status = outcome ?? model.status
  return status ? t('nodePointer.aria', { name: model.name, status }) : t('nodePointer.ariaPlain', { name: model.name })
}

/** 悬停 / 聚焦时把画布上那个节点点亮；离开、失焦、卸载只清自己点亮的那一下（同一节点被两个指向元素指着时不互相清）。 */
function useHoverLink(nodeId: string, enabled: boolean): { hot: boolean; on: () => void; off: () => void } {
  const owner = React.useId()
  const [hot, setHot] = React.useState(false)
  const on = React.useCallback(() => {
    setHot(true)
    if (enabled) useNodeExternalHighlightStore.getState().claimHover(nodeId, owner)
  }, [enabled, nodeId, owner])
  const off = React.useCallback(() => {
    setHot(false)
    useNodeExternalHighlightStore.getState().releaseHover(owner)
  }, [owner])
  React.useEffect(() => () => useNodeExternalHighlightStore.getState().releaseHover(owner), [owner])
  return { hot, on, off }
}

/**
 * 标题行：节点在就挂节点自己的 NodeShotLabel（改名两边一起变）；节点不在就用宿主的名字快照（已删除划线）。
 * `tailFrom`（组给的，见 nodePointerTitleTails）：从这儿起是「和兄弟格不一样的那一截」——前面那截公共开头先截（带省略号），这一截不截。
 */
function PointerLabel({
  model,
  narrow,
  tailFrom = 0,
}: {
  model: PointerModel
  narrow: boolean
  tailFrom?: number
}): JSX.Element {
  const gone = model.face.kind === 'removed' || model.face.kind === 'unavailable'
  // 窄面板只留镜号（名字靠悬停提示）；没有镜号的节点照旧露名字。
  const hideTitle = narrow && Boolean(model.shotText)
  const tone = cn(
    'font-semibold text-nomi-ink',
    gone && 'text-nomi-ink-40',
    model.face.kind === 'removed' && 'line-through',
  )
  const split = tailFrom > 0 && tailFrom < model.title.length
  const titleNode =
    hideTitle || !model.title ? null : split ? (
      // 截中间：头一截可以截到只剩省略号，尾巴整截留着（尾巴自己比一格还宽时才在尾巴末端截）。whitespace-pre 留住两截之间那个空格。
      <span className={cn('flex min-w-0', tone)} data-node-pointer-title="">
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">{model.title.slice(0, tailFrom)}</span>
        <span
          className="max-w-full shrink-0 overflow-hidden text-ellipsis whitespace-pre"
          data-node-pointer-title-tail=""
        >
          {model.title.slice(tailFrom)}
        </span>
      </span>
    ) : (
      <span className={cn('min-w-0 truncate', tone)} data-node-pointer-title="">
        {model.title}
      </span>
    )
  return (
    <span className={cn('flex h-[22px] min-w-0 items-center gap-1.5 text-caption')} title={model.name}>
      {model.node && !gone ? (
        <NodeShotLabel node={model.node}>{titleNode}</NodeShotLabel>
      ) : (
        <>
          {model.shotText ? <ShotNumberPill className="text-nomi-ink-40">{model.shotText}</ShotNumberPill> : null}
          {titleNode}
        </>
      )}
      {!model.shotText && !model.title ? <span className="min-w-0 truncate text-nomi-ink-60">{model.name}</span> : null}
    </span>
  )
}

/**
 * 画面槽里的那一张脸。`thumb`（P2 的小缩略图）只留画面或等待面，状态交给行尾图标 / 边线。
 *
 * 缩略图正中只放一样东西（板 card.pointer.status / card.pointer.exclude）：「恢复」（宿主挂的，`centerTaken`）> 已定位 > 状态胶囊 > 种类图标，
 * 只在 `pointerCenterTier` 判一次，下面各张脸只管把自己的几样备好，不自己去压别人。铺满整格的（结果图、等待面）和贴角的小标不算正中件，照画。
 */
export function PointerFaceArt({
  model,
  size,
  located,
  suppressAwaitingConfirmation = false,
  centerTaken = false,
}: {
  model: PointerModel
  size: 'card' | 'cell' | 'thumb'
  located: boolean
  suppressAwaitingConfirmation?: boolean
  centerTaken?: boolean
}): JSX.Element | null {
  const { t } = useTranslation()
  const face = model.face
  if (size === 'thumb') {
    if (face.kind === 'result' && face.preview.kind === 'image')
      return <img src={face.preview.src} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
    if (face.kind === 'generating' || face.kind === 'processing')
      return <GenerationWaitingSurface previewLabel="" audio={model.node?.kind === 'audio'} />
    return null
  }
  const KindIcon = model.node ? getGenerationNodeIcon(model.node.kind) : null
  // 小标在指向元素上贴得更近（板：4px），样子与节点那一枚同一个组件。
  const corner = 'left-1 top-1 max-w-[calc(100%-8px)] px-1.5'
  // 空卡圆托：NodeEmptyState 那一组 token（ink-05 底 + line 细环 + ink-80 图标），按板缩到 28px。正中件的最后一档。
  const circle = (icon: React.ReactNode, tone?: string) => (
    <span
      className={cn(
        'absolute left-1/2 top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-nomi-ink-05 text-nomi-ink-80 ring-1 ring-inset ring-nomi-line',
        tone,
      )}
      data-node-pointer-center="icon"
      aria-hidden="true"
    >
      {icon}
    </span>
  )
  // 「图标 + 字」的小胶囊：已定位和各种状态同一个样子（正中件的第二、三档）。
  const centerStatus = (
    label: string,
    icon?: React.ReactNode,
    tone?: string,
    isLocated = false,
    generationMessage = false,
  ) => (
    <span
      className={cn(
        'absolute left-1/2 top-1/2 z-[4] inline-flex max-w-[calc(100%-8px)] -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-nomi-paper/90 px-1.5 py-0.5 text-micro text-nomi-ink-60 shadow-nomi-sm',
        tone,
      )}
      data-node-pointer-center={isLocated ? 'located' : 'status'}
      data-node-pointer-status="true"
      data-node-pointer-located={isLocated ? 'true' : undefined}
      data-generation-status={generationMessage ? 'true' : undefined}
    >
      {icon}
      <span className="min-w-0 truncate" data-generation-message={generationMessage ? true : undefined}>
        {label}
      </span>
    </span>
  )
  // art = 铺满整格的东西与贴角的小标（不抢正中）；icon = 这一张脸自己的圆托图标（正中件的最后一档）。
  let art: React.ReactNode = null
  let icon: React.ReactNode = null
  switch (face.kind) {
    case 'result':
      if (face.preview.kind === 'image')
        art = (
          <img src={face.preview.src} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
        )
      else if (KindIcon) icon = circle(<KindIcon size={14} stroke={1.6} />)
      break
    case 'generating':
    case 'processing':
      art = <GenerationWaitingSurface previewLabel="" audio={model.node?.kind === 'audio'} />
      break
    case 'recoverable':
      icon = circle(<IconClockSearch size={14} stroke={1.6} />, 'text-nomi-ink-60')
      if (size === 'card' && !located)
        art = <NodeCornerPill label={t('shotTable.status.recoverable')} className={corner} />
      break
    case 'stopped':
      icon = circle(<IconPlayerPause size={14} stroke={1.6} />, 'bg-nomi-paper text-nomi-warning')
      break
    case 'removed':
      icon = circle(<IconLinkOff size={14} stroke={1.6} />, 'bg-transparent text-nomi-ink-40')
      if (size === 'card') art = <NodeCornerPill label={t('nodePointer.deleted')} className={corner} />
      break
    case 'production':
    case 'empty':
      // 状态胶囊（下面）压过圆托；「等你确认」不印——卡 / 那句话本身就在问，三格各印一遍是噪音（NodePointer 板 A2「全是草稿」只留圆托）；
      // 「已去掉，不生成」不印——付费卡上那一格淡下去、常驻「恢复」（恢复占着正中，见 pointerCenterTier）。单独一张照旧全印。
      if (KindIcon) icon = circle(<KindIcon size={14} stroke={1.6} />)
      break
    case 'failed':
    case 'unavailable':
      break
  }
  // 这一格有哪几样状态：生成中 / 失败读节点自己的反馈；制作流程那几种（排队中 / 还没生成 / 宿主给的词 / 等你确认）读制作状态（SpendCardQ1 板 ③⑤⑥）。
  const status =
    face.kind === 'generating'
      ? centerStatus(
          face.feedback.message,
          face.feedback.phase === 'queued' ? (
            <IconClock size={11} stroke={1.8} aria-hidden="true" className="shrink-0" />
          ) : (
            <IconLoader2
              size={11}
              stroke={1.8}
              aria-hidden="true"
              className="shrink-0 animate-spin motion-reduce:animate-none"
            />
          ),
          undefined,
          false,
          true,
        )
      : face.kind === 'failed'
        ? centerStatus(
            face.feedback.message,
            <IconAlertTriangle size={11} stroke={1.8} aria-hidden="true" className="shrink-0" />,
            'text-nomi-danger-ink',
            false,
            true,
          )
        : face.kind === 'production' &&
            (model.hostStatus ||
              face.state.phase === 'queued' ||
              face.state.phase === 'not_generated' ||
              (!suppressAwaitingConfirmation && face.state.phase === 'awaiting_confirmation'))
          ? centerStatus(
              model.hostStatus ?? productionShotCornerText(t, face.state)?.text ?? '',
              <IconClock size={11} stroke={1.8} aria-hidden="true" className="shrink-0" />,
            )
          : null
  const locatedPill = located
    ? centerStatus(
        t('nodePointer.located'),
        <IconFocus2 size={11} stroke={1.8} aria-hidden="true" className="shrink-0" />,
        undefined,
        true,
      )
    : null
  const tier = pointerCenterTier({
    restore: centerTaken,
    located: Boolean(locatedPill),
    status: Boolean(status),
    icon: Boolean(icon),
  })
  return (
    <>
      {art}
      {tier === 'located' ? locatedPill : tier === 'status' ? status : tier === 'icon' ? icon : null}
    </>
  )
}


/** 节点画面在 16:9 槽里的位置：宽的贴满宽、竖的贴满高并居中（不裁不拉伸）。 */
function frameBox(aspect: number): React.CSSProperties {
  if (aspect >= SLOT_ASPECT) {
    const height = (SLOT_ASPECT / aspect) * 100
    return { left: 0, right: 0, top: `${(100 - height) / 2}%`, height: `${height}%` }
  }
  const width = frameWidthPercent(aspect)
  return { top: 0, bottom: 0, left: `${(100 - width) / 2}%`, width: `${width}%` }
}

export type NodePointerProps = {
  subject: NodePointerSubject
  density?: NodePointerDensity
  /** 只对 card：组里一格（固定 16:9 槽、不印摘要）还是单独一张。 */
  frame?: 'single' | 'cell'
  /**
   * 只对单独一张 card：摘要放哪。`auto` = 竖版放画面右边分两行、横版放画面下一行；`side` = 一律放右边
   * （付费卡单段那一张：画面在左、模型 / 比例 · 时长 · 清晰度在右，SpendCardQ1 板 ①）。
   */
  layout?: 'auto' | 'side'
  /** 窄面板（≤320px）：标题行只留镜号，名字靠悬停提示。 */
  narrow?: boolean
  /** 组指向折叠：这一格的画面位置盖「还有 N 个」，点它展开（板 pointer.group.more）。 */
  overflow?: Readonly<{ hidden: number; onExpand: () => void }>
  /** 组指向用：悬停 / 聚焦、离开 / 失焦时报一声，组据此在下方那一行现算被悬停那一镜的摘要。 */
  onHover?: (hovering: boolean) => void
  /** 组指向用：把自己标题行上那个名字报给组（名字只在这里从节点现算），组据此算每一格「和兄弟不一样的那一截」。 */
  onTitle?: (title: string) => void
  /** 组给的：标题从这儿起是和兄弟格不一样的那一截（截中间，见 nodePointerTitleTails）。 */
  titleTail?: number
  /** 卡面已经在父级标题提问时，隐藏子指向元素的「等你确认」小标。 */
  suppressAwaitingConfirmation?: boolean
  /** 组给的：缩略图正中已被宿主挂的常驻小动作（「恢复」）占着——这一格不再画自己的正中件（已定位 / 状态胶囊 / 种类图标），判据见 pointerCenterTier。 */
  centerTaken?: boolean
}

export function NodePointer({
  subject,
  density = 'card',
  frame = 'single',
  layout = 'auto',
  narrow = false,
  overflow,
  onHover,
  onTitle,
  titleTail,
  suppressAwaitingConfirmation = false,
  centerTaken = false,
}: NodePointerProps): JSX.Element {
  const { t } = useTranslation()
  const model = usePointerModel(subject)
  // 绘制前报上去：组拿到名字就在同一帧里算好截法，不先画一帧「几格截成一样」再跳。
  React.useLayoutEffect(() => {
    onTitle?.(model.title)
  }, [onTitle, model.title])
  const locatable = nodePointerLocatable(model.face)
  const located = useNodePointerStore((state) => state.locatedNodeId === subject.nodeId) && locatable
  const hover = useHoverLink(subject.nodeId, locatable && !overflow)
  const gone = !locatable
  const failedOutcome = model.face.kind === 'failed' ? subject.outcome : undefined
  const enter = (): void => {
    hover.on()
    if (!overflow) onHover?.(true)
  }
  const leave = (): void => {
    hover.off()
    onHover?.(false)
  }
  const locate = (): void => {
    if (overflow) {
      overflow.onExpand()
      return
    }
    if (!locatable) return
    void revealNodeFromChat({ nodeId: subject.nodeId, label: model.shotText ?? model.name })
  }
  const lit = hover.hot && locatable && !overflow
  const common = {
    type: 'button' as const,
    'data-node-pointer': density,
    'data-node-pointer-id': subject.nodeId,
    'data-node-pointer-face': model.face.kind,
    'data-node-pointer-hot': lit ? 'true' : undefined,
    'aria-label': overflow ? t('nodePointer.moreAria', { count: overflow.hidden }) : ariaLabel(t, model, failedOutcome),
    'aria-disabled': gone && !overflow ? true : undefined,
    'aria-expanded': overflow ? false : undefined,
    onClick: locate,
    onPointerEnter: enter,
    onPointerLeave: leave,
    onFocus: enter,
    onBlur: leave,
  }

  if (density === 'chip') {
    return (
      <button
        {...common}
        className={cn(
          // 嵌在一句话里：行高不跟着那句话走（leading 固定），镜号小胶囊按板缩到 18px 高。
          'inline-flex h-7 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border border-nomi-line bg-nomi-paper py-0 pl-[3px] pr-2.5 align-middle text-caption leading-[18px] text-nomi-ink transition-colors [&_[data-shot-number]]:py-0',
          lit && 'border-transparent bg-nomi-ink-05',
          model.face.kind === 'failed' && 'border-nomi-danger-edge',
          gone && 'cursor-default bg-nomi-ink-05 text-nomi-ink-40',
        )}
      >
        <span
          className={cn(
            'relative size-[22px] shrink-0 overflow-hidden rounded-full ring-1 ring-inset ring-nomi-line',
            frameTone(model.face),
          )}
        >
          <PointerFaceArt model={model} size="thumb" located={false} />
        </span>
        <PointerLabel model={model} narrow={narrow} />
      </button>
    )
  }

  if (density === 'row') {
    const second =
      model.face.kind === 'removed'
        ? t('nodePointer.deleted')
        : model.face.kind === 'failed'
          ? (failedOutcome ?? model.status)
          : gone
            ? null
            : (model.summary('row')[0] ?? model.status)
    return (
      <button
        {...common}
        className={cn(
          'flex min-h-10 w-full min-w-0 items-center gap-2 rounded-nomi border border-nomi-line bg-nomi-paper py-1 pl-1 pr-2 text-left text-caption transition-colors',
          lit && 'border-transparent bg-nomi-ink-05',
          model.face.kind === 'failed' && 'border-nomi-danger-edge',
          gone && 'cursor-default bg-nomi-ink-05',
        )}
      >
        <span
          className={cn(
            'relative size-8 shrink-0 overflow-hidden rounded-nomi-sm ring-1 ring-inset ring-nomi-line',
            frameTone(model.face),
          )}
        >
          <PointerFaceArt model={model} size="thumb" located={false} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <PointerLabel model={model} narrow={narrow} />
          {second ? (
            <span
              className={cn(
                'min-w-0 truncate text-nomi-ink-60',
                model.face.kind === 'failed' && 'text-nomi-danger-ink',
                model.face.kind === 'removed' && 'text-nomi-ink-40',
              )}
              title={second}
            >
              {second}
            </span>
          ) : null}
        </span>
        <RowTrailing face={model.face} located={located} />
      </button>
    )
  }

  // card：标题行在框外、画面同节点比例、下面一行只读摘要；单个竖版时摘要放到画面右边分两行。
  const side = frame === 'single' && (model.portrait || layout === 'side') && !gone
  const lines =
    frame === 'cell'
      ? []
      : model.face.kind === 'removed'
        ? [t('nodePointer.deletedHint')]
        : gone
          ? []
          : failedOutcome
            ? [failedOutcome]
            : model.face.kind === 'stopped' && model.status
              ? [model.status]
              : model.summary(side ? 'side' : 'card')
  // 悬停 / 聚焦：画面框外一圈 1.5px 深色细线 + 阴影抬一级（板 .p1.hot），不用蓝。任意属性写法见 externalHighlightShellClass 的注释。
  const frameClass = cn(
    'absolute overflow-hidden rounded-nomi-sm transition-shadow duration-200',
    frameTone(model.face),
    lit ? '[box-shadow:0_0_0_1.5px_var(--nomi-ink),var(--nomi-shadow-md)]' : 'ring-1 ring-inset ring-nomi-line',
  )
  const art = overflow ? (
    <span
      className="absolute inset-0 grid place-items-center bg-nomi-ink-05 text-body-sm font-semibold text-nomi-ink-80"
      data-node-pointer-more={overflow.hidden}
    >
      {t('nodePointer.more', { count: overflow.hidden })}
    </span>
  ) : (
    <PointerFaceArt
      model={model}
      size={frame === 'cell' ? 'cell' : 'card'}
      located={located}
      suppressAwaitingConfirmation={suppressAwaitingConfirmation}
      centerTaken={centerTaken}
    />
  )
  return (
    <button
      {...common}
      className={cn('flex w-full min-w-0 flex-col gap-1 rounded-nomi text-left text-caption', gone && 'cursor-default')}
    >
      <PointerLabel model={model} narrow={narrow} {...(titleTail ? { tailFrom: titleTail } : {})} />
      {side ? (
        <span className="flex min-w-0 items-start gap-3">
          <span className="relative shrink-0" style={{ height: SIDE_SLOT_HEIGHT, aspectRatio: String(model.aspect) }}>
            <span data-node-pointer-frame="" className={cn(frameClass, 'inset-0')}>
              {art}
            </span>
          </span>
          <span className="flex min-w-0 flex-col gap-0.5 pt-1 text-nomi-ink-60">
            {lines.map((line) => (
              <span key={line} className="min-w-0 truncate" title={line}>
                {line}
              </span>
            ))}
          </span>
        </span>
      ) : (
        <>
          <span className="relative block w-full" style={{ aspectRatio: String(SLOT_ASPECT) }}>
            <span data-node-pointer-frame="" className={frameClass} style={frameBox(model.aspect)}>
              {art}
            </span>
          </span>
          {lines[0] ? (
            <span
              className={cn(
                'min-w-0 truncate text-nomi-ink-60',
                failedOutcome && 'text-nomi-danger-ink',
                model.face.kind === 'removed' && 'text-nomi-ink-40',
              )}
              title={lines[0]}
            >
              {lines[0]}
            </span>
          ) : null}
        </>
      )}
    </button>
  )
}

/** P2 行尾的状态图标：✓ / 转圈（蓝只留在转圈上）/ 钟 / ⚠ / 断链；点过的那一行写「已定位」。 */
function RowTrailing({ face, located }: { face: NodePointerFace; located: boolean }): JSX.Element | null {
  const { t } = useTranslation()
  if (located) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 text-micro text-nomi-ink-60"
        data-node-pointer-located="true"
      >
        <IconFocus2 size={12} stroke={1.8} aria-hidden="true" />
        {t('nodePointer.located')}
      </span>
    )
  }
  const queued =
    (face.kind === 'generating' && face.feedback.phase === 'queued') ||
    (face.kind === 'production' && face.state.phase === 'queued')
  const icon =
    face.kind === 'result' ? (
      <IconCheck size={14} stroke={1.8} className="text-nomi-ink-60" />
    ) : queued ? (
      <IconClock size={14} stroke={1.8} className="text-nomi-ink-60" />
    ) : face.kind === 'generating' || face.kind === 'processing' ? (
      <IconLoader2 size={14} stroke={1.8} className="animate-spin text-nomi-accent motion-reduce:animate-none" />
    ) : face.kind === 'failed' ? (
      <IconAlertTriangle size={14} stroke={1.8} className="text-nomi-danger-ink" />
    ) : face.kind === 'removed' ? (
      <IconLinkOff size={14} stroke={1.8} className="text-nomi-ink-40" />
    ) : face.kind === 'stopped' ? (
      <IconPlayerPause size={14} stroke={1.8} className="text-nomi-warning" />
    ) : face.kind === 'recoverable' ? (
      <IconClockSearch size={14} stroke={1.8} className="text-nomi-ink-60" />
    ) : null
  return icon ? (
    <span className="grid shrink-0 place-items-center" aria-hidden="true">
      {icon}
    </span>
  ) : null
}
