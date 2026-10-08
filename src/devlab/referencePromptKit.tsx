// 自动引用样张的共用件：一份「建议态下划线 + 候选层 + chip 去掉钮 + @ 来源菜单 + 点选模式条」，
// 画布节点、列表卡 / 检查器、Agent 付费卡三处**挂的是同一套**（证明三处统一一个组件）。
//
// 它们都贴在**现役 PromptEditor**（Tiptap）上：正式引用就是产品里那颗真 chip（AssetMentionChip，
// 落盘仍是 @[asset:url]），这里不另画 chip。建议态在产品里该是一条 ProseMirror decoration
// （和分镜提示词骨架同一个机制）；实验室不改产品代码，所以用一层贴在编辑器上方的覆盖层画出来，
// 位置按真实文字的 Range 量，跟着编辑器滚动 / 换行走。
//
// 候选层与 @ 菜单是同一个列表（ReferencePickList），长相照抄现役 AssetMentionSuggestionList：
// 26px 缩略图 + 名字 + 右侧小标签，选中行 accent-soft 底。落地时是给那个列表加一个「匹配标记」槽，
// 不另起一个组件。
import React, { type JSX } from 'react'
import { createPortal } from 'react-dom'
import { IconPointer, IconX } from '@tabler/icons-react'
import { AnchoredPopover } from '../design'
import { cn } from '../utils/cn'
import { AssetThumb } from '../workbench/assets/AssetTile'
import type { AssetRef } from '../workbench/assets/assetTypes'
import type { ListViewLocale } from './storyboardListViewData'

export const refCopy = {
  zh: {
    same: '同名',
    alias: '别名',
    group: '本组唯一',
    recent: '最近用过',
    agent: 'Agent',
    canvasNodes: '画布节点',
    pickOnCanvas: '在画布上点选',
    pickMode: '选择要引用的节点',
    pending: '等定妆',
    removeRef: '去掉这个引用',
  },
  en: {
    same: 'Same name',
    alias: 'Alias',
    group: 'Only in group',
    recent: 'Recent',
    agent: 'Agent',
    canvasNodes: 'Canvas nodes',
    pickOnCanvas: 'Pick on canvas',
    pickMode: 'Pick a node to reference',
    pending: 'Awaiting look',
    removeRef: 'Remove this reference',
  },
} as const

export type PickRow = {
  key: string
  label: string
  art?: string
  icon?: React.ReactNode
  tag?: string
  disabled?: boolean
}
export type PickGroup = { key: string; label?: string; rows: PickRow[] }

function thumbAsset(url: string, name: string): AssetRef {
  return { id: url, kind: 'image', name, renderUrl: url, source: 'project', origin: { source: 'project', projectId: '', relativePath: '' } }
}

// ── 列表本体（候选层 / @ 菜单共用）────────────────────────────────────────────

export function ReferencePickList({
  groups,
  activeKey,
  onActive,
  onPick,
}: {
  groups: PickGroup[]
  activeKey: string | null
  onActive: (key: string) => void
  onPick: (row: PickRow) => void
}): JSX.Element {
  return (
    <div
      data-reference-pick-list="true"
      role="listbox"
      className="flex flex-col gap-[1px] overflow-y-auto rounded-nomi-sm border border-nomi-line bg-nomi-paper p-[5px] shadow-nomi-sm"
      style={{ width: 'min(280px, calc(100vw - 16px))', maxHeight: 'min(320px, 60vh)' }}
    >
      {groups.map((group) => (
        <React.Fragment key={group.key}>
          {group.label ? <div className="px-[6px] pb-[2px] pt-[6px] text-micro text-nomi-ink-40">{group.label}</div> : null}
          {group.rows.map((row) => (
            <button
              key={row.key}
              type="button"
              role="option"
              aria-selected={row.key === activeKey}
              aria-disabled={row.disabled || undefined}
              data-pick-row={row.key}
              onMouseEnter={() => !row.disabled && onActive(row.key)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => !row.disabled && onPick(row)}
              className={cn(
                'flex w-full items-center gap-[8px] rounded-nomi-sm border-0 bg-transparent px-[6px] py-[4px] text-left outline-none',
                'transition-colors duration-nomi-fast ease-nomi-fast',
                row.disabled ? 'cursor-not-allowed' : 'cursor-pointer',
                row.key === activeKey && !row.disabled ? 'bg-nomi-accent-soft' : row.disabled ? '' : 'hover:bg-nomi-ink-05',
              )}
            >
              <span
                className={cn(
                  'relative flex size-[26px] shrink-0 select-none items-center justify-center overflow-hidden rounded-nomi-sm bg-nomi-ink-05 text-nomi-ink-60',
                  row.disabled && 'opacity-50',
                )}
                aria-hidden
              >
                {row.art ? <AssetThumb asset={thumbAsset(row.art, row.label)} playSize={12} /> : row.icon}
              </span>
              <span className={cn('min-w-0 flex-1 truncate text-micro leading-none', row.disabled ? 'text-nomi-ink-40' : 'text-nomi-ink-80')}>
                {row.label}
              </span>
              {row.tag ? (
                <span className="shrink-0 rounded-nomi-sm bg-nomi-ink-05 px-[5px] py-[2px] text-micro text-nomi-ink-60">{row.tag}</span>
              ) : null}
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  )
}

/**
 * 点外面就关。候选层**不抢焦点**（不交给 AnchoredPopover 的 FocusScope）：光标留在提示词里，
 * 用户接着打字 = 忽略这条建议，不用先关浮层。
 */
export function useOutsideClose(open: boolean, onClose: () => void): void {
  React.useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (target?.closest?.('[data-reference-pick-list], [data-reference-suggestion]')) return
      onClose()
    }
    const onType = (event: KeyboardEvent) => {
      if (event.key.length === 1) onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onType, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onType, true)
    }
  }, [open, onClose])
}

/** ↑↓ 移动、Enter 选、Esc 关——和现役 @ 列表同一套键。 */
export function usePickListKeys(
  open: boolean,
  groups: PickGroup[],
  onPick: (row: PickRow) => void,
  onClose: () => void,
  initial: string | null = null,
): [string | null, (key: string) => void] {
  const rows = React.useMemo(() => groups.flatMap((group) => group.rows).filter((row) => !row.disabled), [groups])
  const [active, setActive] = React.useState<string | null>(initial ?? rows[0]?.key ?? null)
  React.useEffect(() => {
    if (open) setActive(initial ?? rows[0]?.key ?? null)
  }, [open, initial, rows])
  React.useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent) => {
      const index = rows.findIndex((row) => row.key === active)
      if (event.key === 'ArrowDown') {
        setActive(rows[(index + 1) % rows.length]?.key ?? null)
      } else if (event.key === 'ArrowUp') {
        setActive(rows[(index - 1 + rows.length) % rows.length]?.key ?? null)
      } else if (event.key === 'Enter') {
        const row = rows[index]
        if (row) onPick(row)
      } else if (event.key === 'Escape') {
        onClose()
      } else {
        return
      }
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, rows, active, onPick, onClose])
  return [active, setActive]
}

// ── 贴在编辑器上的覆盖层 ──────────────────────────────────────────────────────

type Tracked = { host: HTMLElement; editor: HTMLElement }

/** 找到 rootRef 里的 ProseMirror，并在它变化（打字 / 换行 / 尺寸 / 滚动）时触发重算。 */
function useTrackedEditor(rootRef: React.RefObject<HTMLElement | null>, selector = '.ProseMirror'): [Tracked | null, number] {
  const [tracked, setTracked] = React.useState<Tracked | null>(null)
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => {
    let frame = 0
    let stop: (() => void) | null = null
    const attach = (): void => {
      const editor = rootRef.current?.querySelector<HTMLElement>(selector)
      const host = editor?.offsetParent as HTMLElement | null
      if (!editor || !host) {
        frame = requestAnimationFrame(attach)
        return
      }
      setTracked({ editor, host })
      const bump = () => setTick((value) => value + 1)
      const mutation = new MutationObserver(bump)
      mutation.observe(editor, { subtree: true, childList: true, characterData: true })
      const resize = new ResizeObserver(bump)
      resize.observe(editor)
      resize.observe(host)
      window.addEventListener('scroll', bump, true)
      window.addEventListener('resize', bump)
      void document.fonts?.ready.then(bump)
      stop = () => {
        mutation.disconnect()
        resize.disconnect()
        window.removeEventListener('scroll', bump, true)
        window.removeEventListener('resize', bump)
      }
    }
    attach()
    return () => {
      cancelAnimationFrame(frame)
      stop?.()
    }
  }, [rootRef, selector])
  return [tracked, tick]
}

function findWordRange(editor: HTMLElement, word: string, nth: number): Range | null {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let seen = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? ''
    let from = text.indexOf(word)
    while (from >= 0) {
      if (seen === nth) {
        const range = document.createRange()
        range.setStart(node, from)
        range.setEnd(node, from + word.length)
        return range
      }
      seen += 1
      from = text.indexOf(word, from + word.length)
    }
  }
  return null
}

/** 只画看得见的那几段：卡上一行截断的提示词里，被省略号吃掉的词不该在卡外冒出一条线。 */
function visibleRects(range: Range, editor: HTMLElement): DOMRect[] {
  const box = editor.getBoundingClientRect()
  return Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1,
  )
}

function toHost(rect: DOMRect, host: HTMLElement): { left: number; top: number; width: number; height: number } {
  const hostRect = host.getBoundingClientRect()
  return {
    left: rect.left - hostRect.left + host.scrollLeft - host.clientLeft,
    top: rect.top - hostRect.top + host.scrollTop - host.clientTop,
    width: rect.width,
    height: rect.height,
  }
}

export type Suggestion = {
  key: string
  word: string
  /** 同一个词第几次出现（0 基）。 */
  nth?: number
  groups: PickGroup[]
}

/**
 * 建议态：识别到的词下面一条灰虚线（不改文字颜色、不插任何东西）。
 * 悬停 / 点击弹候选层；选了才绑定（交回调用方把词后面插成真 chip）；继续打字 = 忽略，覆盖层自己就不画了。
 */
export function SuggestionLayer({
  rootRef,
  suggestions,
  openKey,
  onOpenChange,
  onPick,
  editorSelector,
}: {
  rootRef: React.RefObject<HTMLElement | null>
  editorSelector?: string
  suggestions: Suggestion[]
  openKey: string | null
  onOpenChange: (key: string | null) => void
  onPick: (suggestion: Suggestion, row: PickRow) => void
}): JSX.Element | null {
  const [tracked, tick] = useTrackedEditor(rootRef, editorSelector)
  const hoverTimer = React.useRef<number | null>(null)
  const ranges = React.useMemo(() => {
    if (!tracked) return []
    return suggestions.flatMap((suggestion) => {
      const range = findWordRange(tracked.editor, suggestion.word, suggestion.nth ?? 0)
      return range ? [{ suggestion, range }] : []
    })
    // tick 是重算信号
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracked, suggestions, tick])
  const open = ranges.find((entry) => entry.suggestion.key === openKey) ?? null
  const close = React.useCallback(() => onOpenChange(null), [onOpenChange])
  const pick = React.useCallback((row: PickRow) => {
    if (open) onPick(open.suggestion, row)
  }, [open, onPick])
  const [active, setActive] = usePickListKeys(Boolean(open), open?.suggestion.groups ?? [], pick, close)
  useOutsideClose(Boolean(open), close)
  if (!tracked) return null
  return (
    <>
      {createPortal(
        ranges.flatMap(({ suggestion, range }) =>
          visibleRects(range, tracked.editor).map((rect, index) => {
            const box = toHost(rect, tracked.host)
            const isOpen = suggestion.key === openKey
            return (
              <span
                key={`${suggestion.key}-${index}`}
                data-reference-suggestion={suggestion.key}
                aria-hidden
                onMouseEnter={() => {
                  if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
                  hoverTimer.current = window.setTimeout(() => onOpenChange(suggestion.key), 220)
                }}
                onMouseLeave={() => {
                  if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onOpenChange(suggestion.key)}
                className={cn(
                  'absolute z-[1] cursor-pointer border-b-[1.5px] border-dashed',
                  isOpen ? 'border-nomi-accent' : 'border-nomi-ink-40 hover:border-nomi-accent',
                )}
                style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
              />
            )
          }),
        ),
        tracked.host,
      )}
      {open ? (
        <AnchoredPopover anchorRect={() => open.range.getBoundingClientRect()} gap={6}>
          <ReferencePickList groups={open.suggestion.groups} activeKey={active} onActive={setActive} onPick={pick} />
        </AnchoredPopover>
      ) : null}
    </>
  )
}

/** chip 的 nodeview 外壳不带 data-url，认它里面那张缩略图的地址（= 落盘的 @[asset:url]）。 */
function chipUrl(chip: Element): string | null {
  return chip.getAttribute('data-url') ?? chip.querySelector('img')?.getAttribute('src') ?? null
}

/**
 * 正式 chip 的「去掉」：悬停 chip 时右上角一颗 ×。去掉 = 解绑 + 记一笔否决，这个词以后不再画建议线。
 * 产品里落在 AssetMentionChip 本体上；实验室不改产品组件，所以按 chip 的真实位置贴一颗。
 */
export function ChipRemoveLayer({
  rootRef,
  locale,
  forceUrl,
  onRemove,
  editorSelector,
}: {
  rootRef: React.RefObject<HTMLElement | null>
  editorSelector?: string
  locale: ListViewLocale
  forceUrl?: string | null
  onRemove: (url: string) => void
}): JSX.Element | null {
  const [tracked, tick] = useTrackedEditor(rootRef, editorSelector)
  const [hoverUrl, setHoverUrl] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!tracked) return undefined
    const onOver = (event: MouseEvent) => {
      const chip = (event.target as Element | null)?.closest?.('[data-asset-mention]')
      if (chip) setHoverUrl(chipUrl(chip))
    }
    tracked.editor.addEventListener('mouseover', onOver)
    return () => tracked.editor.removeEventListener('mouseover', onOver)
  }, [tracked])
  const url = forceUrl ?? hoverUrl
  const chip = React.useMemo(() => {
    if (!tracked || !url) return null
    return Array.from(tracked.editor.querySelectorAll<HTMLElement>('[data-asset-mention]')).find((node) => chipUrl(node) === url) ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracked, url, tick])
  if (!tracked || !chip || !url) return null
  const box = toHost(chip.getBoundingClientRect(), tracked.host)
  return createPortal(
    <button
      type="button"
      data-reference-chip-remove={url}
      aria-label={refCopy[locale].removeRef}
      title={refCopy[locale].removeRef}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        setHoverUrl(null)
        onRemove(url)
      }}
      onMouseLeave={() => setHoverUrl(null)}
      className="absolute z-[2] grid size-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0"
      style={{ left: box.left + box.width - 10, top: box.top + box.height / 2 - 12 }}
    >
      <span className="grid size-4 place-items-center rounded-full bg-nomi-ink text-nomi-paper shadow-nomi-sm">
        <IconX size={10} stroke={2.2} />
      </span>
    </button>,
    tracked.host,
  )
}

/** @ 菜单：两类来源。Agent = 方案里定下的视觉锚；画布节点 = 进点选模式，直接去画布上点。 */
export function mentionSourceGroups(
  locale: ListViewLocale,
  anchors: Array<{ key: string; label: string; art: string; ready: boolean }>,
): PickGroup[] {
  const t = refCopy[locale]
  return [
    {
      key: 'agent',
      label: t.agent,
      rows: anchors.map((anchor) => ({
        key: anchor.key,
        label: anchor.label,
        art: anchor.ready ? anchor.art : undefined,
        icon: anchor.ready ? undefined : <span className="size-2 rounded-full bg-nomi-ink-30" />,
        tag: anchor.ready ? undefined : t.pending,
        disabled: !anchor.ready,
      })),
    },
    {
      key: 'canvas',
      label: t.canvasNodes,
      rows: [{ key: 'pick-on-canvas', label: t.pickOnCanvas, icon: <IconPointer size={15} stroke={1.7} /> }],
    },
  ]
}

/** 点选模式顶部那条：一句状态 + Esc。不放说明文字。 */
export function PickModeBar({ locale, onExit }: { locale: ListViewLocale; onExit: () => void }): JSX.Element {
  return (
    <div
      data-pick-mode-bar="true"
      className="inline-flex items-center gap-2 rounded-pill border border-nomi-line bg-nomi-paper py-1 pl-3 pr-1 text-caption text-nomi-ink shadow-nomi-md"
    >
      <IconPointer size={15} stroke={1.7} className="text-nomi-accent" />
      <span className="font-medium">{refCopy[locale].pickMode}</span>
      <button
        type="button"
        onClick={onExit}
        className="inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-pill border border-nomi-line bg-nomi-ink-05 px-2 text-micro font-medium text-nomi-ink-60 hover:text-nomi-ink"
      >
        Esc
      </button>
    </div>
  )
}
