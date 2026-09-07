/**
 * 框头部那颗胶囊：`● 标题 · 一句灰字说明 · 计数 · 折叠 · ⋯`（2026-09-06 拍板样张）。
 *
 * 从 GroupFrame 抽出来是因为它自己就带一套状态（两个字段各自的编辑态 + 提交/取消），
 * 而框体只关心「画多大、什么边框」。混在一起时改一个很容易碰坏另一个（R9 分层）。
 *
 * 两条交互纪律：
 *  · **双击进编辑只发生在标题/说明这两个 span 上**，并且 stopPropagation。框体空白双击照旧
 *    弹「添加节点」——两个动作的目标物不同（文字 vs 空白），用命中区分，不用修饰键（不用教）。
 *  · 计数在拖动中显示成 `3 → 2`。直接把结果写出来，不用箭头图标让人猜（D1 effect-first）；
 *    这正是实拍里缺的那条反馈——拖出去之前用户完全不知道会发生什么。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconDots, IconStack2 } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { GROUP_VISUAL_CLASS } from './groupVisualContract'

export type FrameMembershipPreview = 'join' | 'leave' | null

type GroupFrameHeaderProps = {
  groupId: string
  name: string
  description?: string
  memberCount: number
  /** 拖动中松手后的成员数；null = 没有在飞的预览。 */
  previewCount: number | null
  readOnly: boolean
  /** 有线待连时头部只是装饰：编辑与菜单都让位给「落线到框上」这件事。 */
  connectable: boolean
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onRename: (groupId: string, name: string) => void
  onDescribe: (groupId: string, description: string) => void
  onCollapse?: (groupId: string) => void
  onOpenMenu?: (groupId: string, point: { x: number; y: number }) => void
}

/** 提交 = 失焦或回车；Esc 放弃。三条都要有，缺 Esc 的输入框会把人困在里面。 */
function useCommittedField(initial: string, commit: (value: string) => void, done: () => void) {
  const [value, setValue] = React.useState(initial)
  React.useEffect(() => setValue(initial), [initial])
  const finish = React.useCallback((next: string) => {
    commit(next)
    done()
  }, [commit, done])
  return {
    value,
    setValue,
    onBlur: () => finish(value),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation()
      if (event.key === 'Enter') {
        event.preventDefault()
        finish(value)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setValue(initial)
        done()
      }
    },
  }
}

const FIELD_CLASS =
  'min-w-0 border-0 bg-transparent p-0 font-[inherit] text-[inherit] leading-[inherit] outline-none focus-visible:outline-none'

export function GroupFrameHeader({
  groupId,
  name,
  description,
  memberCount,
  previewCount,
  readOnly,
  connectable,
  editing,
  onEditingChange,
  onRename,
  onDescribe,
  onCollapse,
  onOpenMenu,
}: GroupFrameHeaderProps): JSX.Element {
  const { t } = useTranslation()
  const [editingField, setEditingField] = React.useState<'name' | 'description' | null>(null)
  const editable = !readOnly && !connectable

  // ⋯ 菜单里的「改名 / 说明」把这一格推进编辑态；退出编辑时告诉上层，
  // 免得菜单关掉后头部还以为自己该在编辑（两处各存一份状态就会漂）。
  React.useEffect(() => {
    if (editing && editable) setEditingField('name')
    else if (!editing) setEditingField(null)
  }, [editable, editing])

  const stopEditing = React.useCallback(() => {
    setEditingField(null)
    onEditingChange(false)
  }, [onEditingChange])

  const nameField = useCommittedField(name, (next) => {
    const trimmed = next.trim()
    if (trimmed) onRename(groupId, trimmed)
  }, stopEditing)
  const descriptionField = useCommittedField(description ?? '', (next) => {
    // 说明可以被清空，所以这里不拦空串——与改名不同（框总得有个名字）。
    onDescribe(groupId, next.trim())
  }, stopEditing)

  const beginEditing = (field: 'name' | 'description') => (event: React.MouseEvent) => {
    if (!editable) return
    event.preventDefault()
    event.stopPropagation()
    setEditingField(field)
    onEditingChange(true)
  }

  /**
   * 标题与说明这两段文字**不参与拖动**，它们自己吃掉 pointerdown。
   *
   * 不这么做双击就永远进不了编辑态：框体的拖动 handler 在 pointerdown 里 `preventDefault()`
   * （它要拦住拖动时的文字选中），而浏览器一旦被取消 pointerdown 就**不再派发兼容鼠标事件**
   * ——mousedown / click / dblclick 全没了。走查 canvas-frame.walk.mjs 的「双击标题进编辑态」
   * 这条当场红，就是它。
   *
   * 代价是「按住标题拖框」不再生效。这个取舍是明的：框体其余部分整片都是把手，随便哪儿都能拖；
   * 而一个改不了名字的标题没有别的入口（⋯ 菜单那一项走的也是这段编辑态）。
   */
  const claimPointer = (event: React.PointerEvent): void => {
    if (!editable) return
    event.stopPropagation()
  }

  const countLabel = previewCount === null
    ? String(memberCount)
    : t('generationCommon.canvas.group.countPreview', { from: memberCount, to: previewCount })

  return (
    <div
      className={cn(
        'generation-canvas-v2__group-box-label',
        'absolute left-3 top-2 z-[4] inline-flex min-h-[22px] max-w-[calc(100%-24px)] items-center gap-2',
        'rounded-full border px-[9px] py-[3px] text-micro font-[650] leading-[1.25]',
        'pointer-events-auto select-none',
        GROUP_VISUAL_CLASS.label,
        connectable ? 'cursor-copy' : readOnly ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
      )}
      // 编辑中不许把头部当拖动把手——否则点进输入框的那一下就把整个框拖走了。
      onPointerDown={editingField ? (event) => event.stopPropagation() : undefined}
    >
      <span className={cn('size-2 shrink-0 rounded-full border', GROUP_VISUAL_CLASS.marker)} aria-hidden="true" />
      {editingField === 'name' ? (
        <input
          autoFocus
          className={cn(FIELD_CLASS, 'w-[120px]')}
          aria-label={t('generationCommon.canvas.group.renameAria', { name })}
          value={nameField.value}
          onChange={(event) => nameField.setValue(event.target.value)}
          onBlur={nameField.onBlur}
          onKeyDown={nameField.onKeyDown}
        />
      ) : (
        <span
          className="min-w-0 truncate"
          data-frame-title="true"
          onPointerDown={claimPointer}
          onDoubleClick={beginEditing('name')}
          title={editable ? t('generationCommon.canvas.group.renameAria', { name }) : undefined}
        >
          {name}
        </span>
      )}
      {editingField === 'description' ? (
        <input
          autoFocus
          className={cn(FIELD_CLASS, 'w-[140px] font-normal text-nomi-ink-60')}
          aria-label={t('generationCommon.canvas.group.describeAria', { name })}
          placeholder={t('generationCommon.canvas.group.descriptionPlaceholder')}
          value={descriptionField.value}
          onChange={(event) => descriptionField.setValue(event.target.value)}
          onBlur={descriptionField.onBlur}
          onKeyDown={descriptionField.onKeyDown}
        />
      ) : description || editable ? (
        // 说明为空时留一句极淡的占位——不留的话，用户根本不知道这里可以写东西。
        <span
          className={cn('min-w-0 truncate font-normal', description ? 'text-nomi-ink-60' : 'text-nomi-ink-30')}
          data-frame-description="true"
          onPointerDown={claimPointer}
          onDoubleClick={beginEditing('description')}
          title={editable ? t('generationCommon.canvas.group.describeAria', { name }) : undefined}
        >
          {description || t('generationCommon.canvas.group.descriptionPlaceholder')}
        </span>
      ) : null}
      <span
        className={cn(
          'inline-grid h-[18px] min-w-[18px] place-items-center rounded-full px-[5px] text-micro tabular-nums',
          GROUP_VISUAL_CLASS.count,
        )}
        data-frame-count="true"
      >
        {countLabel}
      </span>
      {onCollapse && !connectable ? (
        <button
          type="button"
          className="grid size-[18px] place-items-center rounded-full border-0 bg-nomi-ink-05 text-nomi-ink-60 hover:bg-nomi-ink-10 hover:text-nomi-ink"
          aria-label={t('generationCommon.canvas.group.collapseNamed', { name })}
          title={t('generationCommon.canvas.group.collapse')}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            onCollapse(groupId)
          }}
        >
          <IconStack2 size={11} stroke={1.9} aria-hidden="true" />
        </button>
      ) : null}
      {onOpenMenu && editable ? (
        <button
          type="button"
          className="grid size-[18px] place-items-center rounded-full border-0 bg-nomi-ink-05 text-nomi-ink-60 hover:bg-nomi-ink-10 hover:text-nomi-ink"
          aria-label={t('generationCommon.canvas.group.moreActions', { name })}
          data-frame-more="true"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            onOpenMenu(groupId, { x: event.clientX, y: event.clientY })
          }}
        >
          <IconDots size={11} stroke={1.9} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}
