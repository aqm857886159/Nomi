// 设计实验室 · 屏「画布 · 分组框头（对齐拍板样张）」的取景台与夹具。
//
// 探索图 → 生产组件搭建 → 清单 → 实现（用户 10-10 拍板的流程）。这一屏是第二步：
// 框的几何走现役 `getCanvasGroupBoxes`；选中时的工具条走现役 `CanvasGroupToolbar` 与
// `resolveGroupToolbarPlacement`；「生成全部」用设计系统现役 `WorkbenchButton`；框体用
// `GROUP_VISUAL_CLASS.frame`。**只有框头本身是新搭的**（`GroupBoardHeader`），它就是要被
// 用户拍板、拍板后搬进生产 `GroupFrameHeader.tsx` 的那一块。
//
// 文案只在这里写两份（zh / en），不走 i18n 键：这屏是拍板样张，不是生产字符串，
// 进生产时再一并进 locales（那一步要过 check:i18n）。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'

import i18n from '../../../i18n'
import type { AppLocale } from '../../../i18n'
import { WorkbenchButton } from '../../../design'
import { CanvasGroupToolbar } from '../../../workbench/generationCanvas/components/CanvasGroupToolbar'
import { resolveGroupToolbarPlacement } from '../../../workbench/generationCanvas/components/groupToolbarPlacement'
import { GROUP_VISUAL_CLASS } from '../../../workbench/generationCanvas/components/groupVisualContract'
import {
  getCanvasGroupBoxes,
  getCanvasNodeVisualSize,
} from '../../../workbench/generationCanvas/components/generationCanvasGeometry'
import type { CanvasGroupBox } from '../../../workbench/generationCanvas/components/GroupFrame'
import type { GenerationCanvasNode, NodeGroup } from '../../../workbench/generationCanvas/model/generationCanvasTypes'

export const CANVAS_GROUP_HEADER_CELL_WIDTH = 920
export const CANVAS_GROUP_HEADER_CELL_HEIGHT = 520

const NOOP = (): void => {}

const TEXT = {
  'zh-CN': {
    storyboardPrefix: '分镜 · ',
    countUnit: ' 镜',
    generate: '生成全部',
    emptyCount: '0 镜',
    countPreview: (from: number, to: number) => `${from} → ${to}`,
  },
  en: {
    storyboardPrefix: 'Storyboard · ',
    countUnit: ' shots',
    generate: 'Generate all',
    emptyCount: '0 shots',
    countPreview: (from: number, to: number) => `${from} → ${to}`,
  },
} as const

/** 生产 `NodeGroup` 的最小造法（与 canvasFrameLabKit 同一套，id 走位置参数，避开实验室注册项正则）。 */
export function makeGroup(id: string, partial: Omit<Partial<NodeGroup>, 'id'> & Pick<NodeGroup, 'name' | 'nodeIds'>): NodeGroup {
  return { id, categoryId: 'shots', createdAt: 1, updatedAt: 1, ...partial } as NodeGroup
}

export function makeMember(id: string, position: { x: number; y: number }): GenerationCanvasNode {
  return { id, kind: 'image', title: id, position, size: { width: 240, height: 120 }, categoryId: 'shots' } as GenerationCanvasNode
}

/** 六个成员：两排三列，和样张一样 3 × 2。 */
export const SIX_MEMBERS: readonly GenerationCanvasNode[] = [
  makeMember('shot-1', { x: 56, y: 124 }),
  makeMember('shot-2', { x: 330, y: 124 }),
  makeMember('shot-3', { x: 604, y: 124 }),
  makeMember('shot-4', { x: 56, y: 300 }),
  makeMember('shot-5', { x: 330, y: 300 }),
  makeMember('shot-6', { x: 604, y: 300 }),
]

export const FRAME_BOUNDS = { x: 24, y: 64, w: 872, h: 400 }

/** 把 locale 钉到实验室的 i18n，工具条（生产组件）随之切语言。 */
export function useLabLocale(locale: AppLocale): void {
  React.useMemo(() => {
    void i18n.changeLanguage(locale)
  }, [locale])
}

/**
 * 新框头（待拍板）。结构：`[组名 · 前缀] [计数] ……… [生成全部]`，全部在框内左上到右上一行。
 * 没有色点、没有图标、没有折叠按钮、没有 ⋯ —— 对应样张，也对应功能普查里的 F1 F2 F8 F9。
 */
export function GroupBoardHeader({
  locale,
  name,
  count,
  previewCount,
  storyboard,
  editing,
  forceHover,
  generateDisabled,
}: {
  locale: AppLocale
  name: string
  count: number
  previewCount: number | null
  storyboard: boolean
  editing?: boolean
  forceHover?: boolean
  generateDisabled?: boolean
}): JSX.Element {
  const copy = TEXT[locale]
  const countLabel = previewCount === null
    ? count === 0 ? copy.emptyCount : `${count}${storyboard ? copy.countUnit : ''}`
    : copy.countPreview(count, previewCount)
  return (
    <div
      className="absolute left-4 right-3 top-2.5 flex h-[26px] items-center gap-2"
      data-group-board-header="true"
    >
      {editing ? (
        <input
          autoFocus
          readOnly
          aria-label={name}
          defaultValue={name}
          className="w-[180px] border-0 bg-transparent p-0 text-caption font-medium text-nomi-ink-80 outline-none"
        />
      ) : (
        <span className="min-w-0 truncate text-caption font-medium text-nomi-ink-80" data-frame-title="true">
          {storyboard ? copy.storyboardPrefix : ''}
          {name}
        </span>
      )}
      <span className="shrink-0 text-caption tabular-nums text-nomi-ink-40" data-frame-count="true">
        {countLabel}
      </span>
      <span className="flex-1" aria-hidden="true" />
      <WorkbenchButton
        size="sm"
        className={forceHover ? 'bg-workbench-hover' : undefined}
        disabled={generateDisabled}
        data-group-generate-all="true"
      >
        {copy.generate}
      </WorkbenchButton>
    </div>
  )
}

/**
 * 取景台：框 + 框头 + 成员占位块 + （选中时）现役工具条。
 * 框的几何与成员占位块的尺寸都走现役解析器（同 canvasFrameLabKit 的纪律），不手填。
 */
export function CanvasGroupHeaderStage({
  locale,
  group,
  members,
  header,
  selected,
  scheme = 'light',
}: {
  locale: AppLocale
  group: NodeGroup
  members: readonly GenerationCanvasNode[]
  header: Omit<React.ComponentProps<typeof GroupBoardHeader>, 'locale' | 'name' | 'count' | 'storyboard'>
  selected?: boolean
  scheme?: 'light' | 'dark'
}): JSX.Element {
  useLabLocale(locale)
  const [box] = getCanvasGroupBoxes([group], members) as CanvasGroupBox[]
  const storyboard = group.categoryId === 'shots'
  const count = box?.memberCount ?? 0
  const frameBorder = box?.empty ? 'border-dashed border-nomi-ink-30' : 'border-nomi-line'
  return (
    <div
      className="relative overflow-hidden rounded-nomi border border-nomi-line bg-[var(--workbench-surface)]"
      style={{ width: CANVAS_GROUP_HEADER_CELL_WIDTH, height: CANVAS_GROUP_HEADER_CELL_HEIGHT }}
      data-design-lab-stage="canvas-group-header"
      data-scheme={scheme}
    >
      {box ? (
        <>
          <div
            className={`absolute rounded-nomi-lg ${GROUP_VISUAL_CLASS.frame} ${frameBorder}`}
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            data-group-board-frame="true"
          >
            <GroupBoardHeader
              {...header}
              locale={locale}
              name={group.name}
              count={count}
              storyboard={storyboard}
            />
          </div>
          {members.map((node) => {
            const size = getCanvasNodeVisualSize(node)
            return (
              <div
                key={node.id}
                className="absolute rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-sm"
                style={{ left: node.position.x, top: node.position.y, width: size.width, height: size.height }}
                aria-hidden="true"
              />
            )
          })}
          {selected ? (
            <div
              className="pointer-events-none absolute"
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            >
              <div className="pointer-events-auto">
                <CanvasGroupToolbar
                  group={group}
                  canvasZoom={1}
                  placement={resolveGroupToolbarPlacement({
                    frameTop: box.top,
                    frameHeight: box.height,
                    zoom: 1,
                    offsetY: 0,
                    stageHeight: CANVAS_GROUP_HEADER_CELL_HEIGHT,
                  })}
                  horizontal={{ frameLeft: box.left, frameWidth: box.width, offsetX: 0, stageWidth: CANVAS_GROUP_HEADER_CELL_WIDTH }}
                  memberCount={count}
                  canGenerate={count > 0}
                  canSendToTimeline={count > 0}
                  canDownload={count > 0}
                  onGenerate={NOOP}
                  onSendToTimeline={NOOP}
                  onDissolve={NOOP}
                  onArrange={NOOP}
                  onColor={NOOP}
                  onDownload={NOOP}
                />
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
