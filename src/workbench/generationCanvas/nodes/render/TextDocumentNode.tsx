/**
 * TextDocumentNode — `text`-kind 节点的可编辑 body（C5）。
 *
 * - **拖动 vs 编辑**：顶部「文本」栏才是拖拽手柄（非 contenteditable，pointerdown 冒泡触发拖动）；
 *   正文是 ProseMirror，已被 handlePointerDown 白名单放行 → 点正文 = 编辑、不误拖。
 * - **键盘**：正文 stopPropagation keydown/keyup，否则打字触发画布全局快捷键（Backspace 删节点）。
 * - **持久化**：实时写 store（persist:false），失焦 commit。
 * - **格式条（P2）**：编辑（聚焦）时浮在节点上方，不占节点高度、不依赖选区；与创作区共用
 *   buildRichTextActions（一份定义两个壳）。
 *
 * 复用唯一真相源 useNomiRichTextEditor。本组件只渲染 body，节点选中/拖动/缩放由 BaseGenerationNode 提供。
 */
import React from 'react'
import { IconGripVertical } from '@tabler/icons-react'
import { EditorContent, useEditorState, type JSONContent } from '@tiptap/react'
import { cn } from '../../../../utils/cn'
import type { GenerationCanvasNode, TiptapDocJson } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { useNomiRichTextEditor } from '../../../common/useNomiRichTextEditor'
import { buildRichTextActions } from '../../../common/richTextActions'

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
      updateNode(node.id, { contentJson: json as unknown as TiptapDocJson }, { persist: false })
    },
    [node.id, updateNode],
  )

  // 把最新选区文本存进 meta（persist:false），供「改写」生成时拼 prompt 用。去重避免抖动。
  const handleSelectionChange = React.useCallback(
    (text: string) => {
      const store = useGenerationCanvasStore.getState()
      const current = store.nodes.find((candidate) => candidate.id === node.id)
      if ((current?.meta?.textGenSelection ?? '') === text) return
      store.updateNode(node.id, { meta: { ...(current?.meta || {}), textGenSelection: text } }, { persist: false })
    },
    [node.id],
  )

  const { editor, tools } = useNomiRichTextEditor({
    content,
    placeholder: TEXT_NODE_PLACEHOLDER,
    onChange: handleChange,
    onSelectionChange: handleSelectionChange,
  })

  // 编辑（聚焦）时才显示格式条。订阅 editor.isFocused（含 active/can 变化驱动按钮态刷新）。
  const editorUi = useEditorState({
    editor,
    selector: ({ editor: current }) => ({ focused: Boolean(current?.isFocused) }),
  })
  const isFocused = editorUi?.focused ?? false

  // 「改写」落地：textActions 拿不到 ProseMirror 选区位置，只打了 textPendingSelectionApply 标记；
  // 这里在节点编辑器里 replaceSelection 替换当前选区。seed=挂载时已有 result.id，避免项目加载时重放。
  const lastAppliedResultIdRef = React.useRef<string | null>(node.result?.id ?? null)
  const resultId = node.result?.id
  const pendingApplyId = node.meta?.textPendingSelectionApply
  React.useEffect(() => {
    if (!resultId || pendingApplyId !== resultId) return
    if (lastAppliedResultIdRef.current === resultId) return
    lastAppliedResultIdRef.current = resultId
    const text = (node.result?.text || '').trim()
    if (text) tools.replaceSelection(text)
    const store = useGenerationCanvasStore.getState()
    const current = store.nodes.find((candidate) => candidate.id === node.id)
    store.updateNode(node.id, { meta: { ...(current?.meta || {}), textPendingSelectionApply: null } }, { persist: false })
  }, [resultId, pendingApplyId, node.id, node.result?.text, tools])

  const showPlaceholder = isDocEmpty(node.contentJson)
  const actions = buildRichTextActions(editor)

  return (
    // 外层 overflow 可见，让格式条能浮到节点上方；圆角/阴影/裁剪都收进内层 body。
    <div className="relative h-full w-full">
      {/* 浮动格式条：编辑时浮在节点上方（不占节点高度）。 */}
      {editor && isFocused ? (
        <div
          role="toolbar"
          aria-label="文本格式"
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(
            'absolute left-1/2 top-[-44px] z-[9] -translate-x-1/2',
            'flex items-center gap-0.5 rounded-full border border-nomi-line bg-nomi-paper px-1.5 py-1 shadow-nomi-lg',
          )}
        >
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              title={action.label}
              aria-label={action.label}
              aria-pressed={action.active ? true : undefined}
              disabled={action.disabled}
              data-active={action.active ? 'true' : 'false'}
              // mousedown preventDefault：点按钮不丢选区/焦点（否则格式条会闪退）。
              onMouseDown={(event) => event.preventDefault()}
              onClick={action.onClick}
              className={cn(
                'inline-grid h-7 w-7 place-items-center rounded-nomi-sm',
                'text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink',
                'data-[active=true]:bg-nomi-accent-soft data-[active=true]:text-nomi-accent',
                'disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              {action.icon}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex h-full w-full flex-col overflow-hidden rounded-nomi bg-nomi-paper shadow-nomi-md">
        {/* 拖拽手柄：非 contenteditable，pointerdown 冒泡到 BaseGenerationNode 触发拖动。 */}
        <header
          className={cn(
            'shrink-0 flex items-center gap-1 h-7 px-2',
            'border-b border-nomi-line-soft text-nomi-ink-45',
            'cursor-grab select-none',
          )}
          aria-label="拖动文本节点">
          <IconGripVertical size={13} stroke={1.8} aria-hidden="true" />
          <span className="text-micro font-medium tracking-[0.04em]">文本</span>
        </header>

        {/* 正文：ProseMirror 编辑区。stopPropagation 挡画布快捷键；select-text/touch-auto 覆盖
            外层 article 的 select-none/touch-none；[&_.ProseMirror]:outline-none 去掉 contenteditable
            的系统 focus 描边（否则 macOS 强调色会画出黄/橙框）。 */}
        <section
          className={cn(
            'relative flex-1 min-h-0 overflow-auto cursor-text select-text touch-auto',
            '[&_.ProseMirror]:outline-none [&_.ProseMirror:focus]:outline-none [&_.ProseMirror:focus-visible]:outline-none',
          )}
          onKeyDown={(event) => event.stopPropagation()}
          onKeyUp={(event) => event.stopPropagation()}
          onBlur={() => commitPersistedChange()}>
          {showPlaceholder ? (
            <span className="pointer-events-none absolute left-8 top-6 text-title leading-[1.76] text-nomi-ink-40">
              {TEXT_NODE_PLACEHOLDER}
            </span>
          ) : null}
          <EditorContent editor={editor} />
        </section>
      </div>
    </div>
  )
}

const TextDocumentNode = React.memo(TextDocumentNodeImpl, (prev, next) => prev.node === next.node)
TextDocumentNode.displayName = 'TextDocumentNode'
export default TextDocumentNode
