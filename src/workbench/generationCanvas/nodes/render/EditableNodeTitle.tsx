/**
 * v0.8: 节点标题 inline 编辑组件。
 *
 * - 默认显示文本（如空显示 placeholder 灰字）。
 * - 单击进入编辑态（autoFocus + selectAll）。
 * - 失焦 / Enter → 保存。Escape → 撤销。
 * - 阻止外层 React Flow 节点拖动事件（pointer / mouse / click）。
 */
import React from 'react'
import { cn } from '../../../../utils/cn'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'

type Props = {
  nodeId: string
  value: string
  placeholder?: string
  className?: string
}

export function EditableNodeTitle({ nodeId, value, placeholder = '未命名', className }: Props): JSX.Element {
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  React.useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const handleStart = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditing(true)
  }, [])

  const commit = React.useCallback(() => {
    const trimmed = draft.trim()
    if (trimmed !== value) {
      updateNode(nodeId, { title: trimmed })
    }
    setEditing(false)
  }, [draft, nodeId, updateNode, value])

  const cancel = React.useCallback(() => {
    setDraft(value)
    setEditing(false)
  }, [value])

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') cancel()
          e.stopPropagation()
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        placeholder={placeholder}
        className={cn(
          'min-w-0 flex-1 outline-none border-0 bg-transparent p-0',
          'text-body-sm font-semibold text-nomi-ink',
          className,
        )}
      />
    )
  }

  const isEmpty = !value || value.trim().length === 0
  return (
    <span
      onClick={handleStart}
      onMouseDown={(e) => e.stopPropagation()}
      title="点击编辑名字"
      className={cn(
        'min-w-0 flex-1 truncate cursor-text select-none',
        'text-body-sm font-semibold',
        isEmpty ? 'text-nomi-ink-40 italic' : 'text-nomi-ink',
        'hover:bg-nomi-ink-05 rounded-nomi-sm -mx-1 px-1 transition-colors',
        className,
      )}
    >
      {isEmpty ? placeholder : value}
    </span>
  )
}
