import React from 'react'
import { EditorContent, type Editor, type JSONContent } from '@tiptap/react'
import SelectionGeneratePopover from './SelectionGeneratePopover'
import { WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import { useWorkbenchStore } from '../workbenchStore'
import { normalizeWorkbenchContentJson, type CreationDocumentTools } from '../workbenchTypes'
import { useTransientScrollingClass } from './useTransientScrollingClass'
import { useNomiRichTextEditor } from '../common/useNomiRichTextEditor'
import { buildRichTextActions, type RichTextAction } from '../common/richTextActions'

const CREATION_PLACEHOLDER =
  '从这里开始写你的故事、脚本或文案……  选中文字，点右侧即可生成图片 / 视频节点。'

// 工具栏分组：格式按语义分 3 簇（强调 / 标题 / 列表·引用）靠左，历史（撤销/重做）推到右端。
// 之前用一个 flex-1 spacer 把 9 个按钮全挤到左侧、右边 ~570px 浪费 —— 这里按语义两端锚定。
const TOOLBAR_LEFT_GROUPS: readonly (readonly string[])[] = [
  ['bold', 'italic'],
  ['h1', 'h2'],
  ['bullet-list', 'ordered-list', 'blockquote'],
]
const TOOLBAR_RIGHT_GROUP: readonly string[] = ['undo', 'redo']

function ToolbarButton({ action }: { action: RichTextAction }): JSX.Element {
  return (
    <WorkbenchIconButton
      className={cn(
        'workbench-editor-toolbar__button',
        'w-[30px] h-[30px] inline-grid place-items-center',
        'border border-transparent rounded-nomi-sm',
        'bg-transparent text-workbench-muted cursor-pointer',
        'hover:bg-workbench-hover',
        'focus-visible:outline-2 focus-visible:outline-workbench-focus focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-[0.38]',
      )}
      label={action.label}
      data-active={action.active ? 'true' : 'false'}
      disabled={action.disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action.onClick}
      icon={action.icon}
    />
  )
}

function ToolbarDivider(): JSX.Element {
  return <div className="w-px h-[18px] bg-workbench-border mx-1" aria-hidden="true" />
}

function WorkbenchEditorToolbar({ editor }: { editor: Editor | null }): JSX.Element {
  const actions = buildRichTextActions(editor)
  if (actions.length === 0) {
    return (
      <div
        className={cn(
          'workbench-editor-toolbar',
          'h-[44px] flex items-center gap-1 px-3',
          'border-b border-workbench-border-soft bg-workbench-surface',
        )}
        aria-label="文本工具栏"
      />
    )
  }
  const byId = new Map(actions.map((action) => [action.id, action]))
  const pick = (ids: readonly string[]) => ids.map((id) => byId.get(id)).filter((a): a is RichTextAction => Boolean(a))
  const leftGroups = TOOLBAR_LEFT_GROUPS.map(pick).filter((group) => group.length > 0)
  const rightGroup = pick(TOOLBAR_RIGHT_GROUP)
  return (
    <div
      className={cn(
        'workbench-editor-toolbar',
        'h-[44px] flex items-center gap-1 px-3',
        'border-b border-workbench-border-soft bg-workbench-surface',
      )}
      aria-label="文本工具栏"
    >
      {leftGroups.map((group, index) => (
        <React.Fragment key={group[0]?.id ?? index}>
          {index > 0 ? <ToolbarDivider /> : null}
          {group.map((action) => (
            <ToolbarButton key={action.id} action={action} />
          ))}
        </React.Fragment>
      ))}
      <div className="flex-1" aria-hidden="true" />
      {rightGroup.map((action) => (
        <ToolbarButton key={action.id} action={action} />
      ))}
    </div>
  )
}

export default function WorkbenchEditor(): JSX.Element {
  const workbenchDocument = useWorkbenchStore((state) => state.workbenchDocument)
  const setWorkbenchDocument = useWorkbenchStore((state) => state.setWorkbenchDocument)
  const setCreationDocumentTools = useWorkbenchStore((state) => state.setCreationDocumentTools)
  const setCreationSelectionText = useWorkbenchStore((state) => state.setCreationSelectionText)
  const [selectedText, setSelectedText] = React.useState('')
  const scrollRef = useTransientScrollingClass<HTMLDivElement>('workbench-scrollbar-visible')
  const workbenchDocumentRef = React.useRef(workbenchDocument)

  React.useEffect(() => {
    workbenchDocumentRef.current = workbenchDocument
  }, [workbenchDocument])

  const editorContent = React.useMemo(
    () => normalizeWorkbenchContentJson(workbenchDocument.contentJson) as JSONContent,
    [workbenchDocument.contentJson],
  )

  const handleChange = React.useCallback(
    (contentJson: JSONContent) => {
      setWorkbenchDocument({ ...workbenchDocumentRef.current, contentJson, updatedAt: Date.now() })
    },
    [setWorkbenchDocument],
  )

  const handleSelectionChange = React.useCallback(
    (text: string) => {
      setSelectedText(text)
      setCreationSelectionText(text)
    },
    [setCreationSelectionText],
  )

  const { editor, tools } = useNomiRichTextEditor({
    content: editorContent,
    placeholder: CREATION_PLACEHOLDER,
    onChange: handleChange,
    onSelectionChange: handleSelectionChange,
  })

  // Publish creation document tools = the shared rich-text read/write surface (read full/selection,
  // insert/replace/append). The AI panel reads these to apply approved write-tool calls.
  const creationDocumentToolsRef = React.useRef<CreationDocumentTools | null>(null)
  React.useEffect(() => {
    if (!editor) return
    const toolsApi: CreationDocumentTools = {
      readFullText: tools.readFullText,
      readSelectionText: tools.readSelectionText,
      insertAtCursor: tools.insertAtCursor,
      replaceSelection: tools.replaceSelection,
      appendToEnd: tools.appendToEnd,
    }
    setCreationDocumentTools(toolsApi)
    creationDocumentToolsRef.current = toolsApi
    return () => {
      if (creationDocumentToolsRef.current === toolsApi) {
        setCreationDocumentTools(null)
        creationDocumentToolsRef.current = null
      }
    }
  }, [editor, tools, setCreationDocumentTools])

  return (
    <section
      className={cn(
        'workbench-editor',
        'relative w-full h-full min-h-0',
        'grid grid-rows-[44px_minmax(0,1fr)]',
        'border border-workbench-border rounded-workbench',
        'bg-workbench-surface-solid shadow-workbench-md',
        'overflow-hidden',
      )}
      aria-label="创作文档编辑区"
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <WorkbenchEditorToolbar editor={editor} />
      <SelectionGeneratePopover editor={editor} selectedText={selectedText} onCreated={() => setSelectedText('')} />
      <div
        ref={scrollRef}
        className={cn(
          'workbench-editor__scroll', 'min-w-0 min-h-0 overflow-auto',
          // Tiptap Placeholder 渲染：空文档第一段显示 data-placeholder（仿 PromptEditor，
          // 补上创作编辑器缺失的 ::before 规则——根因，不是只在这一处贴症状）。
          '[&_.is-editor-empty]:before:content-[attr(data-placeholder)]',
          '[&_.is-editor-empty]:before:text-nomi-ink-40 [&_.is-editor-empty]:before:float-left',
          '[&_.is-editor-empty]:before:pointer-events-none [&_.is-editor-empty]:before:h-0',
        )}
      >
        <EditorContent editor={editor} />
      </div>
    </section>
  )
}
