import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconMessage } from '@tabler/icons-react'
import { useOverlayEscape } from '../../../design'
import { cn } from '../../../utils/cn'
import { nodePointerGroupVisible, nodePointerTitleTails, pointerHoverStack } from './nodePointerFace'
import { useNodePointerStore } from './nodePointerStore'
import { returnToChat } from './revealNodeFromChat'
import { NodePointer, PointerFaceArt } from './NodePointer'
import { nodePointerRowsVisible } from './nodePointerRows'
import { frameTone, usePointerModel, type NodePointerDensity, type NodePointerSubject } from './nodePointerModel'

export type NodePointerRowAccessory = Readonly<{
  /** 宿主的那颗按钮本身（不带定位、不带藏起来的样式）。 */
  action: React.ReactNode
  /** 常驻（「恢复」）；false = 悬停 / 聚焦这一行时才露出来（「不生成 ×」）。 */
  pinned: boolean
  /** 这一行淡下去（盖在行上，不挡点击：行照样点了去节点）。 */
  dimmed: boolean
}>

/**
 * 组里挂了小动作的那一行。小动作是行的兄弟、不是行里的按钮（行本身是按钮，按钮里不能套按钮），压在行尾让出来的那一截上
 * （NodePointer 的 `reserveTrailing`）。藏着的时候不接点击（看不见的钮不许挡住行尾）；键盘从行 Tab 一下就走到它，
 * 聚焦落在这一行里它就露出来——「看得见才点得到」对鼠标和键盘是同一条。
 */
function PointerRow({ row, accessory }: { row: React.ReactNode; accessory: NodePointerRowAccessory }): JSX.Element {
  return (
    <div
      className="group/pointer-row relative min-w-0"
      data-node-pointer-row=""
      data-accessory-pinned={accessory.pinned ? 'true' : undefined}
    >
      {row}
      {accessory.dimmed ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-nomi bg-nomi-paper/60"
          data-node-pointer-row-dimmed="true"
        />
      ) : null}
      <span
        className={cn(
          'absolute inset-y-0 right-1 z-[5] flex items-center transition-opacity',
          !accessory.pinned &&
            'pointer-events-none opacity-0 group-focus-within/pointer-row:pointer-events-auto group-focus-within/pointer-row:opacity-100 group-hover/pointer-row:pointer-events-auto group-hover/pointer-row:opacity-100',
        )}
        data-node-pointer-row-accessory=""
      >
        {accessory.action}
      </span>
    </div>
  )
}

/** 列表行那一组：一行一个，超过 NODE_POINTER_ROW_FOLD 个折起；行尾可以挂宿主的小动作。 */
function NodePointerRows({
  subjects,
  narrow,
  rowAccessory,
  rowDetail,
  suppressAwaitingConfirmation,
}: {
  subjects: readonly NodePointerSubject[]
  narrow: boolean
  rowAccessory?: ((subject: NodePointerSubject, index: number) => NodePointerRowAccessory | null) | undefined
  rowDetail: 'summary' | 'status'
  suppressAwaitingConfirmation: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(false)
  const visible = nodePointerRowsVisible(subjects.length, expanded)
  const accessories = subjects.map((subject, index) => rowAccessory?.(subject, index) ?? null)
  const anyAccessory = accessories.some(Boolean)
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-node-pointer-group="row">
      {subjects.slice(0, visible.shown).map((subject, index) => {
        const key = subject.nodeId || `row-${index}`
        const accessory = accessories[index]
        const row = (
          <NodePointer
            subject={subject}
            density="row"
            narrow={narrow}
            rowDetail={rowDetail}
            suppressAwaitingConfirmation={suppressAwaitingConfirmation}
            reserveTrailing={anyAccessory}
          />
        )
        return accessory ? (
          <PointerRow key={key} row={row} accessory={accessory} />
        ) : (
          <React.Fragment key={key}>{row}</React.Fragment>
        )
      })}
      {visible.hidden ? (
        <button
          type="button"
          className="self-start rounded-nomi-sm px-1 py-0.5 text-caption text-nomi-ink-80 hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink"
          aria-expanded={false}
          data-node-pointer-more={visible.hidden}
          onClick={() => setExpanded(true)}
        >
          {t('nodePointer.moreShots', { count: visible.hidden })}
        </button>
      ) : null}
    </div>
  )
}

/** 组指向：一次说多个镜头。card 一行三格（下方一行是被悬停那一镜的摘要）；chip 嵌在一句话里；row 是一列（超过 4 个折起）。 */
export function NodePointerGroup({
  subjects,
  density = 'card',
  narrow = false,
  max = 3,
  rowAccessory,
  rowDetail = 'summary',
  suppressAwaitingConfirmation = false,
}: {
  subjects: readonly NodePointerSubject[]
  density?: NodePointerDensity
  narrow?: boolean
  /** 只对 card / chip：露几个。row 折起的数是 NODE_POINTER_ROW_FOLD。 */
  max?: number
  /** 只对 row：每一行行尾挂一个宿主给的小动作（见 NodePointerRowAccessory / PointerRow）。缺席或返回 null = 这一行不挂。 */
  rowAccessory?: (subject: NodePointerSubject, index: number) => NodePointerRowAccessory | null
  /** 只对 row：第二行写摘要（默认），还是只写有话要说的（见 NodePointer 的 rowDetail）。 */
  rowDetail?: 'summary' | 'status'
  /** 父级已经在问「要不要」（付费确认条）时，组里不重复显示「等你确认」。 */
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
      <NodePointerRows
        subjects={subjects}
        narrow={narrow}
        rowAccessory={rowAccessory}
        rowDetail={rowDetail}
        suppressAwaitingConfirmation={suppressAwaitingConfirmation}
      />
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
          const key = keys[index]!
          return (
            <NodePointer
              key={key}
              subject={subject}
              frame="cell"
              narrow={narrow}
              overflow={folded ? { hidden: visible.hidden, onExpand: () => setExpanded(true) } : undefined}
              onHover={(hovering) => setHovered((stack) => pointerHoverStack(stack, subject.nodeId, hovering))}
              onTitle={reporterFor(key)}
              titleTail={tails[index]}
              suppressAwaitingConfirmation={suppressAwaitingConfirmation}
            />
          )
        })}
      </div>
      {/* 摘要这一行常驻（没有悬停时一个空格撑着行高）：悬停 / 离开不改组的高度，不把下面的东西顶下去。 */}
      {hoveredSubject ? <PointerHoverSummary subject={hoveredSubject} /> : <PointerHoverLine text={null} />}
    </div>
  )
}

/** 组下方那一行：被悬停那一镜的摘要；没有悬停时是一个不换行空格——两种情况同一个 `<p>`、同一行高。 */
function PointerHoverLine({ text }: { text: string | null }): JSX.Element {
  return (
    <p
      className="m-0 min-w-0 truncate text-caption text-nomi-ink-60"
      data-node-pointer-hover-summary={text ? 'true' : undefined}
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
 * 窄窗口里点了指向、对话收成小球之后，画布底部那一颗「回到对话」（板 pointer.narrow.back）。
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
