// 设计实验室 · 屏「画布 · 分组框」的取景台与夹具（10-10 拍板后：全部是生产组件本体）。
//
// 框体用现役 `GroupFrame`（含框头 `GroupFrameHeader`：组名 · 计数 · 生成全部），工具条用现役 `CanvasGroupToolbar`，
// 折叠态用现役 `CollapsedGroupCard`。几何走 `getCanvasGroupBoxes`。这一屏不再有任何临时搭的框头。
// 成员用占位块（同 canvasFrameLabKit）：它们不是节点组件，只为让人看清框与内容的关系。
import React, { type JSX } from 'react'

import i18n from '../../../i18n'
import type { AppLocale } from '../../../i18n'
import { CanvasGroupToolbar } from '../../../workbench/generationCanvas/components/CanvasGroupToolbar'
import { CollapsedGroupCard } from '../../../workbench/generationCanvas/components/CollapsedGroupCard'
import GroupFrame, { type CanvasFrameInteraction } from '../../../workbench/generationCanvas/components/GroupFrame'
import { resolveGroupToolbarPlacement } from '../../../workbench/generationCanvas/components/groupToolbarPlacement'
import { getCanvasGroupBoxes, getCanvasNodeVisualSize } from '../../../workbench/generationCanvas/components/generationCanvasGeometry'
import type { CanvasGroupBox } from '../../../workbench/generationCanvas/components/GroupFrame'
import type { GroupColorId } from '../../../workbench/generationCanvas/model/groupColor'
import type { GenerationCanvasNode, NodeGroup } from '../../../workbench/generationCanvas/model/generationCanvasTypes'

export const CANVAS_GROUP_HEADER_CELL_WIDTH = 920
export const CANVAS_GROUP_HEADER_CELL_HEIGHT = 520

const NOOP = (): void => undefined

/** 生产 `NodeGroup` 的最小造法（id 走位置参数，避开实验室注册项正则）。 */
export function makeGroup(id: string, partial: Omit<Partial<NodeGroup>, 'id'> & Pick<NodeGroup, 'name' | 'nodeIds'>): NodeGroup {
  return { id, categoryId: 'shots', createdAt: 1, updatedAt: 1, ...partial } as NodeGroup
}

/** 分镜组（多镜物化章）：生产里判断「分镜」只看这一个字段。 */
export const STORYBOARD_STAMP = { materializationOperationId: 'op-lab-storyboard' } as const

export function makeMember(id: string, position: { x: number; y: number }): GenerationCanvasNode {
  return { id, kind: 'image', title: id, position, size: { width: 240, height: 120 }, categoryId: 'shots' } as GenerationCanvasNode
}

/** 六个成员：两排三列。 */
export const SIX_MEMBERS: readonly GenerationCanvasNode[] = [
  makeMember('shot-1', { x: 56, y: 124 }),
  makeMember('shot-2', { x: 330, y: 124 }),
  makeMember('shot-3', { x: 604, y: 124 }),
  makeMember('shot-4', { x: 56, y: 300 }),
  makeMember('shot-5', { x: 330, y: 300 }),
  makeMember('shot-6', { x: 604, y: 300 }),
]

export const FRAME_BOUNDS = { x: 24, y: 64, w: 872, h: 400 }

/** 把 locale 钉到实验室的 i18n，生产组件随之切语言。 */
export function useLabLocale(locale: AppLocale): void {
  React.useMemo(() => {
    void i18n.changeLanguage(locale)
  }, [locale])
}

export type LabHeaderOptions = {
  /** 拖动预览：`join` 进框（底色加深）、`leave` 出框（虚线），计数写成 from → to。 */
  membership?: 'none' | 'join' | 'leave'
  previewCount?: number
  editing?: boolean
  selected?: boolean
  scheme?: 'light' | 'dark'
}

/** 取景台：生产 GroupFrame（含生产框头）+ 成员占位块 + （选中时）生产 CanvasGroupToolbar。 */
export function CanvasGroupHeaderStage({
  locale,
  group,
  members,
  options = {},
}: {
  locale: AppLocale
  group: NodeGroup
  members: readonly GenerationCanvasNode[]
  options?: LabHeaderOptions
}): JSX.Element {
  useLabLocale(locale)
  const { membership = 'none', previewCount, editing = false, selected = false, scheme = 'light' } = options
  const [box] = getCanvasGroupBoxes([group], members) as CanvasGroupBox[]
  const preview = membership !== 'none' && previewCount !== undefined
    ? { groupId: group.id, change: membership, nextCount: previewCount }
    : null
  const frame: CanvasFrameInteraction = {
    membershipPreview: preview,
    editingGroupId: editing ? group.id : null,
    onEditingChange: NOOP,
    onRename: NOOP,
    onDescribe: NOOP,
    onOpenMenu: NOOP,
    onGenerate: NOOP,
    selectedGroupId: selected ? group.id : null,
  }
  return (
    <div
      className="relative overflow-hidden rounded-nomi border border-nomi-line bg-[var(--workbench-surface)]"
      style={{ width: CANVAS_GROUP_HEADER_CELL_WIDTH, height: CANVAS_GROUP_HEADER_CELL_HEIGHT }}
      data-design-lab-stage="canvas-group-header"
      data-scheme={scheme}
    >
      {box ? (
        <>
          <GroupFrame box={box} onPointerDown={NOOP} frame={frame} />
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
            <div className="pointer-events-none absolute" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
              <div className="pointer-events-auto">
                <CanvasGroupToolbar
                  group={group}
                  canvasZoom={1}
                  placement={resolveGroupToolbarPlacement({ frameTop: box.top, frameHeight: box.height, zoom: 1, offsetY: 0, stageHeight: CANVAS_GROUP_HEADER_CELL_HEIGHT })}
                  horizontal={{ frameLeft: box.left, frameWidth: box.width, offsetX: 0, stageWidth: CANVAS_GROUP_HEADER_CELL_WIDTH }}
                  memberCount={box.memberCount}
                  canGenerate={box.memberCount > 0}
                  canSendToTimeline={box.memberCount > 0}
                  canDownload={box.memberCount > 0}
                  onGenerate={NOOP}
                  onSendToTimeline={NOOP}
                  onDissolve={NOOP}
                  onArrange={NOOP}
                  onColor={NOOP}
                  onDownload={NOOP}
                  onOpenMenu={NOOP}
                />
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/** 折叠态：生产 CollapsedGroupCard，按组色的 soft 底色显示。 */
export function CollapsedGroupStage({ locale, name, colorToken, memberCount, scheme = 'light' }: { locale: AppLocale; name: string; colorToken?: GroupColorId; memberCount: number; scheme?: 'light' | 'dark' }): JSX.Element {
  useLabLocale(locale)
  return (
    <div
      className="relative overflow-hidden rounded-nomi border border-nomi-line bg-[var(--workbench-surface)]"
      style={{ width: CANVAS_GROUP_HEADER_CELL_WIDTH, height: CANVAS_GROUP_HEADER_CELL_HEIGHT }}
      data-design-lab-stage="canvas-group-header"
      data-scheme={scheme}
    >
      <CollapsedGroupCard
        card={{ groupId: 'grp-collapsed', name, memberCount, position: { x: 360, y: 150 }, colorToken }}
        readOnly={false}
        selected={false}
        onPointerDown={NOOP}
        onExpand={NOOP}
      />
    </div>
  )
}
