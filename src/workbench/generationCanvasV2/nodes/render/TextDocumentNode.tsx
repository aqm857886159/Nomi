/**
 * TextDocumentNode — `text`-kind 节点的可编辑 body（C5 P1 Chunk 2）。
 *
 * 设计要点（评审采纳，见 docs/plan/c5-text-node.md）：
 * - **拖动 vs 编辑**：顶部那条「Text」栏才是拖拽手柄（不是 contenteditable，
 *   pointerdown 会冒泡到 BaseGenerationNode 的 handlePointerDown 触发拖动）；
 *   正文是 ProseMirror contenteditable，已被 handlePointerDown 白名单放行 → 点正文 = 编辑、不误拖。
 * - **键盘**：正文外层 stopPropagation keydown/keyup，否则打字会触发画布全局快捷键
 *   （Backspace 删节点 = 致命）。仿 WorkbenchEditor.tsx 的做法。
 * - **持久化**：编辑实时写 store（persist:false，不抖动磁盘），失焦才 commit——
 *   复用拖拽/缩放的「实时不 persist + 结束 commit」节奏。
 *
 * 复用唯一真相源 useNomiRichTextEditor（创作区同一内核）。本组件只渲染 body，
 * 节点的选中/拖动/缩放仍由 BaseGenerationNode 提供。
 */
import React from 'react'
import { IconGripVertical } from '@tabler/icons-react'
import { EditorContent, type JSONContent } from '@tiptap/react'
import { cn } from '../../../../utils/cn'
import type { GenerationCanvasNode, TiptapDocJson } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { useNomiRichTextEditor } from '../../../common/useNomiRichTextEditor'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }
const TEXT_NODE_PLACEHOLDER = '在这里写文本……'

type Props = {
  node: GenerationCanvasNode
}

/** 文档是否为空（无内容，或只有一个空段落）——用于显示占位提示。 */
function isDocEmpty(doc?: TiptapDocJson): boolean {
  const content = doc?.content
  if (!content || content.length === 0) return true
  return content.every((entry) => {
    const block = entry as { type?: string; content?: unknown[] }
    return block.type === 'paragraph' && (!block.content || block.content.length === 0)
  })
}

function TextDocumentNodeImpl({ node }: Props): JSX.Element {
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)

  const content = React.useMemo<JSONContent>(
    () => (node.contentJson ?? EMPTY_DOC) as JSONContent,
    [node.contentJson],
  )

  const handleChange = React.useCallback(
    (json: JSONContent) => {
      // 实时写入，但不落盘（persist:false）；失焦时 commit。
      updateNode(node.id, { contentJson: json as unknown as TiptapDocJson }, { persist: false })
    },
    [node.id, updateNode],
  )

  const { editor } = useNomiRichTextEditor({
    content,
    placeholder: TEXT_NODE_PLACEHOLDER,
    onChange: handleChange,
  })

  const showPlaceholder = isDocEmpty(node.contentJson)

  return (
    <div className={cn('w-full h-full flex flex-col bg-nomi-paper')}>
      {/* 拖拽手柄：非 contenteditable，pointerdown 冒泡到 BaseGenerationNode 触发拖动。 */}
      <header
        className={cn(
          'shrink-0 flex items-center gap-1 h-7 px-2',
          'border-b border-nomi-line-soft text-nomi-ink-45',
          'cursor-grab select-none',
        )}
        aria-label='拖动文本节点'>
        <IconGripVertical size={13} stroke={1.8} aria-hidden='true' />
        <span className='text-[11px] font-medium tracking-[0.04em]'>Text</span>
      </header>

      {/* 正文：ProseMirror 编辑区。stopPropagation 挡住画布全局快捷键。
          select-text/touch-auto 覆盖外层 article 的 select-none/touch-none，否则正文无法选字。 */}
      <section
        className={cn('relative flex-1 min-h-0 overflow-auto cursor-text select-text touch-auto')}
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
        onBlur={() => commitPersistedChange()}>
        {showPlaceholder ? (
          <span className='pointer-events-none absolute left-8 top-6 text-[16px] leading-[1.76] text-nomi-ink-40'>
            {TEXT_NODE_PLACEHOLDER}
          </span>
        ) : null}
        <EditorContent editor={editor} />
      </section>
    </div>
  )
}

const TextDocumentNode = React.memo(TextDocumentNodeImpl, (prev, next) => prev.node === next.node)
TextDocumentNode.displayName = 'TextDocumentNode'
export default TextDocumentNode
