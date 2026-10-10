/**
 * 框头：框内左上「组名 · 计数」，框内右上「生成全部」（2026-10-10 拍板，对齐拍板样张 V-1136 Main-1280）。
 *
 * 取代旧的框外标签（组名 + 图标 + 色点 + 说明 + 折叠 + ⋯ 挂在框外上方）。删掉的东西各有去处（见
 * docs/plan/2026-10-10-group-header-board-parity.md 功能普查 F1–F19）：色点 → 工具条颜色按钮；折叠 / 删除 / 编辑 → 右键菜单
 * 与工具条「⋯」；生成整框 → 本行「生成全部」（同一执行口 runFrameAction）。
 *
 * 交互纪律：
 *  · 双击组名进入改名；菜单「编辑」同时打开组名与说明两个输入框。编辑中头部不许当拖动把手。
 *  · 计数在拖动中显示成 `3 → 2`（肉眼可见，不再只写进 aria-label）。
 *  · 分镜组（有 materializationOperationId 章）显示「分镜 · 」前缀、计数写「N 镜」；普通组只显示组名、计数写「N 个」。
 *    前缀只是显示规则：改名改的仍是组名本身。
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'

export type FrameMembershipPreview = 'join' | 'leave' | null

type GroupFrameHeaderProps = {
  groupId: string
  name: string
  description?: string
  /** 分镜组（多镜物化章）才加「分镜 · 」前缀、计数写「镜」。 */
  storyboard: boolean
  memberCount: number
  /** 拖动中松手后的成员数；null = 没有在飞的预览。 */
  previewCount: number | null
  readOnly: boolean
  /** 有线待连时头部只是装饰：编辑与按钮都让位给「落线到框上」这件事。 */
  connectable: boolean
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onRename: (groupId: string, name: string) => void
  onDescribe: (groupId: string, description: string) => void
  onGenerate?: (groupId: string) => void
}

const FIELD_CLASS =
  'min-w-0 border-0 bg-transparent p-0 font-[inherit] text-[inherit] leading-[inherit] outline-none focus-visible:outline-none'

export function GroupFrameHeader({
  groupId,
  name,
  description,
  storyboard,
  memberCount,
  previewCount,
  readOnly,
  connectable,
  editing,
  onEditingChange,
  onRename,
  onDescribe,
  onGenerate,
}: GroupFrameHeaderProps): JSX.Element {
  const { t } = useTranslation()
  const editable = !readOnly && !connectable
  // 编辑草稿：名称与说明一起编辑，焦点离开整块编辑区才一次提交；Esc 整块放弃。
  const [draftName, setDraftName] = React.useState(name)
  const [draftDescription, setDraftDescription] = React.useState(description ?? '')
  const abandonedRef = React.useRef(false)

  React.useEffect(() => {
    if (!editing || !editable) return
    abandonedRef.current = false
    setDraftName(name)
    setDraftDescription(description ?? '')
    // 只在进入编辑态时取一次草稿；编辑中外部改名不覆盖用户正在打的字。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, editable])

  const commit = React.useCallback(() => {
    if (abandonedRef.current) return
    const nextName = draftName.trim()
    if (nextName && nextName !== name) onRename(groupId, nextName)
    const nextDescription = draftDescription.trim()
    if (nextDescription !== (description ?? '')) onDescribe(groupId, nextDescription)
    onEditingChange(false)
  }, [description, draftDescription, draftName, groupId, name, onDescribe, onEditingChange, onRename])

  const abandon = React.useCallback(() => {
    abandonedRef.current = true
    onEditingChange(false)
  }, [onEditingChange])

  const beginEditing = (event: React.MouseEvent) => {
    if (!editable) return
    event.preventDefault()
    event.stopPropagation()
    onEditingChange(true)
  }

  const onEditKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Enter' && event.currentTarget.dataset.field === 'name') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      abandon()
    }
  }

  /**
   * 标题这段文字**不参与拖动**，它自己吃掉 pointerdown。
   * 不这么做双击就永远进不了编辑态：框体的拖动 handler 在 pointerdown 里 `preventDefault()`，
   * 浏览器一旦取消 pointerdown 就不再派发兼容鼠标事件（mousedown / click / dblclick 全没了）。
   */
  const claimPointer = (event: React.PointerEvent): void => {
    if (!editable) return
    event.stopPropagation()
  }

  const countLabel = previewCount === null
    ? t(storyboard ? 'generationCommon.canvas.group.countShots' : 'generationCommon.canvas.group.countItems', { count: memberCount })
    : t('generationCommon.canvas.group.countPreview', { from: memberCount, to: previewCount })
  const titleText = storyboard ? `${t('generationCommon.canvas.group.storyboardPrefix')}${name}` : name

  return (
    <div
      className={cn(
        'generation-canvas-v2__group-box-label',
        'absolute left-4 right-3 top-2.5 flex h-[26px] items-center gap-2',
        'pointer-events-auto select-none',
        connectable ? 'cursor-copy' : readOnly ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
      )}
      // 编辑中不许把头部当拖动把手——否则点进输入框的那一下就把整个框拖走了。
      onPointerDown={editing && editable ? (event) => event.stopPropagation() : undefined}
    >
      {editing && editable ? (
        <span
          className="flex min-w-0 flex-1 items-center gap-2"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit()
          }}
        >
          <input
            autoFocus
            data-field="name"
            className={cn(FIELD_CLASS, 'w-[160px] shrink-0 text-caption font-medium text-nomi-ink-80')}
            aria-label={t('generationCommon.canvas.group.renameAria', { name })}
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={onEditKeyDown}
          />
          <input
            data-field="description"
            className={cn(FIELD_CLASS, 'min-w-0 flex-1 text-caption text-nomi-ink-60')}
            aria-label={t('generationCommon.canvas.group.describeAria', { name })}
            placeholder={t('generationCommon.canvas.group.descriptionPlaceholder')}
            value={draftDescription}
            onChange={(event) => setDraftDescription(event.target.value)}
            onKeyDown={onEditKeyDown}
          />
        </span>
      ) : (
        <span
          className="min-w-0 truncate text-caption font-medium text-nomi-ink-80"
          data-frame-title="true"
          onPointerDown={claimPointer}
          onDoubleClick={beginEditing}
          title={editable ? t('generationCommon.canvas.group.renameAria', { name }) : description || undefined}
        >
          {titleText}
        </span>
      )}
      <span
        className="shrink-0 text-caption tabular-nums text-nomi-ink-40"
        data-frame-count="true"
      >
        {countLabel}
      </span>
      <span className="flex-1" aria-hidden="true" />
      {onGenerate && editable && !editing ? (
        <WorkbenchButton
          size="sm"
          disabled={memberCount === 0}
          data-frame-generate-all="true"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            onGenerate(groupId)
          }}
        >
          {t('generationCommon.canvas.group.generateAll')}
        </WorkbenchButton>
      ) : null}
    </div>
  )
}
