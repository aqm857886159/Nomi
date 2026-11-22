import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconMessage } from '@tabler/icons-react'
import { useOverlayEscape } from '../../../design'
import { cn } from '../../../utils/cn'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { selectCanvasNodeById } from '../../generationCanvas/store/canvasNodeGenerationIndex'
import {
  nodePointerGroupVisible,
  nodePointerSummaryFacts,
  nodePointerTitleTails,
  pointerHoverStack,
} from './nodePointerFace'
import { useNodePointerStore } from './nodePointerStore'
import { returnToChat } from './revealNodeFromChat'
import { NodePointer, PointerFaceArt } from './NodePointer'
import {
  aspectFromText,
  frameTone,
  frameWidthPercent,
  usePointerModel,
  type NodePointerDensity,
  type NodePointerSubject,
} from './nodePointerModel'

export type NodePointerCellAccessory = Readonly<{
  /** 宿主的那颗按钮本身（不带定位、不带藏起来的样式）。 */
  action: React.ReactNode
  /** 常驻（「恢复」，摆在缩略图正中、占着正中：这一格不再画自己的正中件）；false = 悬停 / 聚焦这一格时才露出来（「不生成 ×」，摆在缩略图右上角）。 */
  pinned: boolean
  /** 这一格淡下去（盖在画面框上，不挡点击：指向元素照样点了去节点）。 */
  dimmed: boolean
}>

/**
 * 组里挂了小动作的那一格。小动作是格子的兄弟、不是格子里的按钮（按钮里不能套按钮），× 在缩略图右上角、恢复在缩略图中央：
 * 不压画面框里的状态胶囊，也不再占标题行；它露出来时由组统一控制，键盘从指向元素 Tab 一下照样走得到它。
 * 藏着的时候不接点击（看不见的钮不许挡住缩略图），键盘从指向元素 Tab 一下照样走得到它（聚焦在格子里就露出来）。
 *
 * × 的摆法和输入框里参考图（AssetTile）那一颗一样：28px 的点击区，右缘比画面框右缘多 10px、上缘比画面框上缘高 10px，
 * 16px 的圆点就落在框角里 4px。画面框上缘 = 标题行 22px + 间距 4px = 26px；竖版 / 窄版的框在 16:9 槽里居中，
 * 右缘要按框自己的宽算——所以框宽（`--node-pointer-frame-width`）写在这一格自己身上，小动作才读得到（写在兄弟那颗按钮上它读不到）。
 */
function PointerCell({
  subject,
  pointer,
  accessory,
}: {
  subject: NodePointerSubject
  pointer: React.ReactNode
  accessory: NodePointerCellAccessory
}): JSX.Element {
  const node = useGenerationCanvasStore((state) => selectCanvasNodeById(state, subject.nodeId))
  const frameWidth = frameWidthPercent(aspectFromText(nodePointerSummaryFacts(node, '').aspect))
  return (
    <div
      className="group/pointer-cell relative min-w-0"
      style={{ '--node-pointer-frame-width': `${frameWidth}%` } as React.CSSProperties}
      data-node-pointer-cell=""
      data-accessory-pinned={accessory.pinned ? 'true' : undefined}
    >
      {pointer}
      {accessory.dimmed ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 top-[26px] rounded-nomi-sm bg-nomi-paper/60"
          data-node-pointer-cell-dimmed="true"
        />
      ) : null}
      <span
        className={cn(
          accessory.pinned
            ? 'pointer-events-none absolute inset-x-0 top-[26px] z-[5] flex aspect-video items-center justify-center transition-opacity'
            : 'absolute top-[16px] z-[5] flex h-7 items-center transition-opacity',
          !accessory.pinned && 'right-[calc((100%-var(--node-pointer-frame-width,100%))/2-10px)]',
          !accessory.pinned &&
            'pointer-events-none opacity-0 group-focus-within/pointer-cell:pointer-events-auto group-focus-within/pointer-cell:opacity-100 group-hover/pointer-cell:pointer-events-auto group-hover/pointer-cell:opacity-100',
        )}
        data-node-pointer-cell-accessory=""
      >
        {accessory.action}
      </span>
    </div>
  )
}

/** 组指向：一次说多个镜头。card 一行三格（下方一行是被悬停那一镜的摘要）；chip 嵌在一句话里；row 是一列（不折）。 */
export function NodePointerGroup({
  subjects,
  density = 'card',
  narrow = false,
  max = 3,
  idleSummary,
  cellAccessory,
  hoverSummary,
  suppressAwaitingConfirmation = false,
}: {
  subjects: readonly NodePointerSubject[]
  density?: NodePointerDensity
  narrow?: boolean
  max?: number
  /**
   * 只对 card：没有格子被悬停时下方那一行写什么（付费卡：这几段合起来的只读摘要「模型 · 比例 · 清晰度 · 共 Ns」）。
   * 缺席 = 一个不换行空格撑着行高（组单独用时）。悬停哪一格，那一行就换成那一镜的摘要，离开回到这一句。
   */
  idleSummary?: string
  /** 只对 card：每一格缩略图上挂一个宿主给的小动作（见 NodePointerCellAccessory / PointerCell）。缺席或返回 null = 这一格不挂。 */
  cellAccessory?: (subject: NodePointerSubject, index: number) => NodePointerCellAccessory | null
  /** 付费卡逐镜参数不同时的悬停摘要；返回 null 表示保留整行摘要。 */
  hoverSummary?: (subject: NodePointerSubject, index: number) => string | null
  /** 父级卡已经在标题行提问时，组格不重复显示等待确认小标。 */
  suppressAwaitingConfirmation?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(false)
  // 被悬停 / 聚焦的格子：存 nodeId（先后到的排成一摞，离开的只拿掉自己），不存摘要——摘要每次渲染从节点现算，
  // 模型目录后到、节点改名都会跟着变（独立验收 V-d2-pointer 偏差 8：摘要曾拍成字符串存进 state，目录晚到就缺模型名）。
  const [hovered, setHovered] = React.useState<readonly string[]>([])
  // 每一格标题行上那个名字（各格自己从节点现算后报上来，见 NodePointer.onTitle），只拿来算截法。
  const [titles, setTitles] = React.useState<Readonly<Record<string, string>>>({})
  // 每一格一枚不变的回报函数：格子的 layout effect 只在名字真变了时才再报一次。
  const reporters = React.useRef(new Map<string, (title: string) => void>())
  const reporterFor = (key: string): ((title: string) => void) => {
    const known = reporters.current.get(key)
    if (known) return known
    const report = (title: string): void =>
      setTitles((current) => (current[key] === title ? current : { ...current, [key]: title }))
    reporters.current.set(key, report)
    return report
  }
  if (density === 'row') {
    return (
      <div className="flex flex-col gap-1.5" data-node-pointer-group="row">
        {subjects.map((subject) => (
          <NodePointer key={subject.nodeId} subject={subject} density="row" narrow={narrow} />
        ))}
      </div>
    )
  }
  const visible = nodePointerGroupVisible(subjects.length, max, expanded)
  const hoveredSubject = subjects.find((subject) => subject.nodeId === hovered[hovered.length - 1])
  if (density === 'chip') {
    return (
      <span data-node-pointer-group="chip">
        {subjects.slice(0, visible.shown).map((subject) => (
          <React.Fragment key={subject.nodeId}>
            <NodePointer subject={subject} density="chip" narrow={narrow} />{' '}
          </React.Fragment>
        ))}
        {visible.hidden ? (
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-full border border-nomi-line bg-nomi-paper px-2.5 align-middle text-caption font-semibold text-nomi-ink"
            aria-label={t('nodePointer.moreAria', { count: visible.hidden })}
            aria-expanded={false}
            data-node-pointer-more={visible.hidden}
            onClick={() => setExpanded(true)}
          >
            {t('nodePointer.moreCompact', { count: visible.hidden })}
          </button>
        ) : null}
      </span>
    )
  }
  const shown = subjects.slice(0, visible.shown)
  // 没有节点号的格子（还没落到画布上）用位置当键：几格同时缺号时键不撞。
  const keys = shown.map((subject, index) => subject.nodeId || `cell-${index}`)
  const tails = nodePointerTitleTails(keys.map((key) => titles[key] ?? ''))
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-node-pointer-group="card">
      <div className="grid min-w-0 grid-cols-3 gap-2">
        {shown.map((subject, index) => {
          const folded = Boolean(visible.hidden && index === visible.shown - 1)
          const key = keys[index]
          const accessory = cellAccessory && !folded ? cellAccessory(subject, index) : null
          const pointer = (
            <NodePointer
              subject={subject}
              frame="cell"
              narrow={narrow}
              overflow={folded ? { hidden: visible.hidden, onExpand: () => setExpanded(true) } : undefined}
              onHover={(hovering) => setHovered((stack) => pointerHoverStack(stack, subject.nodeId, hovering))}
              onTitle={reporterFor(key)}
              titleTail={tails[index]}
              suppressAwaitingConfirmation={suppressAwaitingConfirmation}
              centerTaken={Boolean(accessory?.pinned)}
            />
          )
          return accessory ? (
            <PointerCell key={key} subject={subject} pointer={pointer} accessory={accessory} />
          ) : (
            <React.Fragment key={key}>{pointer}</React.Fragment>
          )
        })}
      </div>
      {/* 摘要这一行常驻（没有悬停时放宿主那一句或一个空格撑着行高）：悬停 / 离开不改组的高度，不把下面的东西（「生成」钮）顶下去。 */}
      {hoveredSubject ? (
        hoverSummary ? (
          <PointerHoverLine
            text={hoverSummary(hoveredSubject, subjects.indexOf(hoveredSubject)) ?? idleSummary ?? null}
          />
        ) : (
          <PointerHoverSummary subject={hoveredSubject} />
        )
      ) : (
        <PointerHoverLine text={idleSummary ?? null} idle />
      )}
    </div>
  )
}

/**
 * 组下方那一行：被悬停那一镜的摘要；没有悬停时是宿主给的那一句（`idleSummary`），宿主也没给就是一个不换行空格——
 * 三种情况同一个 `<p>`、同一行高。
 */
function PointerHoverLine({ text, idle = false }: { text: string | null; idle?: boolean }): JSX.Element {
  return (
    <p
      className="m-0 min-w-0 truncate text-caption text-nomi-ink-60"
      data-node-pointer-hover-summary={text && !idle ? 'true' : undefined}
      data-node-pointer-group-summary={text && idle ? 'true' : undefined}
      title={text ?? undefined}
      aria-hidden={text ? undefined : true}
    >
      {text ?? '\u00a0'}
    </p>
  )
}

/** 被悬停那一镜的摘要（镜号 · 模型 · 比例 · 时长）：每次渲染从节点现算，不存。 */
function PointerHoverSummary({ subject }: { subject: NodePointerSubject }): JSX.Element {
  const model = usePointerModel(subject)
  return <PointerHoverLine text={[model.shotText ?? model.name, ...model.summary('card')].join(' · ')} />
}

/** 「回到对话」上那一枚圆缩略图（P2 形态）：读的还是那个节点。 */
function ReturnThumb({ nodeId }: { nodeId: string }): JSX.Element {
  const model = usePointerModel({ nodeId })
  return (
    <span
      className={cn('relative size-[22px] shrink-0 overflow-hidden rounded-full bg-nomi-paper', frameTone(model.face))}
      aria-hidden="true"
    >
      <PointerFaceArt model={model} size="thumb" located={false} />
    </span>
  )
}

/**
 * 窄窗口里点了指向、对话收起（入口在顶栏）之后，画布底部那一颗「回到对话」（板 pointer.narrow.back）。
 * P2 形态带着那一枚标签（「镜 02 · 回到对话」）；Esc 也回。没有可回的对话就不画。
 */
export function NodePointerReturnToChat({
  withLabel = false,
  className,
}: {
  withLabel?: boolean
  className?: string
}): JSX.Element | null {
  const { t } = useTranslation()
  const target = useNodePointerStore((state) => state.returnTo)
  const ref = React.useRef<HTMLButtonElement>(null)
  useOverlayEscape(ref, Boolean(target), returnToChat)
  if (!target) return null
  // 看得见的字按设计系统 §1.8 规则 3 英文 ≤2 词（中文「回到对话」、英文「Back」）；读屏名 / 悬停名写全（英文「Back to chat」）。
  const text = withLabel ? t('nodePointer.backToChatWithLabel', { label: target.label }) : t('nodePointer.backToChat')
  const name = withLabel
    ? t('nodePointer.backToChatNameWithLabel', { label: target.label })
    : t('nodePointer.backToChatName')
  return (
    <button
      ref={ref}
      type="button"
      aria-label={name}
      title={name}
      data-node-pointer-return="true"
      onClick={returnToChat}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-full bg-nomi-ink pl-3 pr-3.5 text-body-sm font-medium text-nomi-paper shadow-nomi-lg',
        withLabel && 'pl-1.5',
        className,
      )}
    >
      {withLabel ? <ReturnThumb nodeId={target.nodeId} /> : <IconMessage size={16} stroke={1.8} aria-hidden="true" />}
      {text}
    </button>
  )
}
