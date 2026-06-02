import React from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBlockquote,
  IconBold,
  IconH1,
  IconH2,
  IconItalic,
  IconList,
  IconListNumbers,
} from '@tabler/icons-react'
import SelectionGeneratePopover from './SelectionGeneratePopover'
import { WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvasV2/store/generationCanvasStore'
import { normalizeWorkbenchContentJson, type CreationDocumentTools } from '../workbenchTypes'
import { markdownToTiptapContent } from './markdownToTiptap'
import { createImageNodeFromContent, createStoryboardNodeFromContent } from './creationNodeCommands'
import { useTransientScrollingClass } from './useTransientScrollingClass'

function readSelectedText(editor: NonNullable<ReturnType<typeof useEditor>>): string {
  const { from, to, empty } = editor.state.selection
  if (empty || from === to) return ''
  return editor.state.doc.textBetween(from, to, '\n').trim()
}

function isEditorReady(editor: Editor | null): editor is Editor {
  return Boolean(editor && !editor.isDestroyed)
}

type ToolbarAction = {
  id: string
  label: string
  icon: JSX.Element
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

function WorkbenchEditorToolbar({ editor }: { editor: Editor | null }): JSX.Element {
  const actions: ToolbarAction[] = !isEditorReady(editor) ? [] : [
    {
      id: 'bold',
      label: '加粗',
      icon: <IconBold size={15} />,
      active: editor.isActive('bold'),
      onClick: () => editor.chain().focus().toggleBold().run(),
    },
    {
      id: 'italic',
      label: '斜体',
      icon: <IconItalic size={15} />,
      active: editor.isActive('italic'),
      onClick: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      id: 'h1',
      label: '一级标题',
      icon: <IconH1 size={16} />,
      active: editor.isActive('heading', { level: 1 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      id: 'h2',
      label: '二级标题',
      icon: <IconH2 size={16} />,
      active: editor.isActive('heading', { level: 2 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      id: 'bullet-list',
      label: '项目符号',
      icon: <IconList size={15} />,
      active: editor.isActive('bulletList'),
      onClick: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      id: 'ordered-list',
      label: '编号列表',
      icon: <IconListNumbers size={15} />,
      active: editor.isActive('orderedList'),
      onClick: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      id: 'blockquote',
      label: '引用',
      icon: <IconBlockquote size={15} />,
      active: editor.isActive('blockquote'),
      onClick: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      id: 'undo',
      label: '撤销',
      icon: <IconArrowBackUp size={15} />,
      disabled: !editor.can().undo(),
      onClick: () => editor.chain().focus().undo().run(),
    },
    {
      id: 'redo',
      label: '重做',
      icon: <IconArrowForwardUp size={15} />,
      disabled: !editor.can().redo(),
      onClick: () => editor.chain().focus().redo().run(),
    },
  ]

  return (
    <div
      className={cn(
        'workbench-editor-toolbar',
        'h-[44px] flex items-center gap-1 px-3',
        'border-b border-workbench-border-soft bg-workbench-surface',
      )}
      aria-label="文本工具栏"
    >
      {actions.map((action) => (
        <WorkbenchIconButton
          key={action.id}
          className={cn(
            'workbench-editor-toolbar__button',
            'w-[30px] h-[30px] inline-grid place-items-center',
            'border border-transparent rounded-[7px]',
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
      ))}
      <div className="flex-1" aria-hidden="true" />
    </div>
  )
}

export default function WorkbenchEditor(): JSX.Element {
  const workbenchDocument = useWorkbenchStore((state) => state.workbenchDocument)
  const creationDocumentTools = useWorkbenchStore((state) => state.creationDocumentTools)
  const setWorkbenchDocument = useWorkbenchStore((state) => state.setWorkbenchDocument)
  const setCreationDocumentTools = useWorkbenchStore((state) => state.setCreationDocumentTools)
  const setCreationSelectionText = useWorkbenchStore((state) => state.setCreationSelectionText)
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)
  const addGenerationNode = useGenerationCanvasStore((state) => state.addNode)
  const [selectedText, setSelectedText] = React.useState('')
  const lastEditorJsonRef = React.useRef('')
  const scrollRef = useTransientScrollingClass<HTMLDivElement>('workbench-scrollbar-visible')
  const workbenchDocumentRef = React.useRef(workbenchDocument)
  const creationDocumentToolsRef = React.useRef<CreationDocumentTools | null>(creationDocumentTools)

  React.useEffect(() => {
    workbenchDocumentRef.current = workbenchDocument
  }, [workbenchDocument])

  React.useEffect(() => {
    creationDocumentToolsRef.current = creationDocumentTools
  }, [creationDocumentTools])

  const editorContent = React.useMemo(
    () => normalizeWorkbenchContentJson(workbenchDocument.contentJson) as JSONContent,
    [workbenchDocument.contentJson],
  )

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: '从这里开始写你的故事或剧本...\n\n💡 选中文字后，点右侧「生成图片」或「生成视频」，画布会自动创建对应节点。',
      }),
    ],
    content: editorContent,
    editorProps: {
      attributes: {
        class: 'workbench-editor__content',
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const contentJson = currentEditor.getJSON()
      lastEditorJsonRef.current = JSON.stringify(contentJson)
      setWorkbenchDocument({
        ...workbenchDocumentRef.current,
        contentJson,
        updatedAt: Date.now(),
      })
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      const nextSelectedText = readSelectedText(currentEditor)
      setSelectedText(nextSelectedText)
      setCreationSelectionText(nextSelectedText)
    },
  })

  React.useEffect(() => {
    if (!isEditorReady(editor)) return
    const nextSelectedText = readSelectedText(editor)
    setSelectedText(nextSelectedText)
    setCreationSelectionText(nextSelectedText)
  }, [editor, setCreationSelectionText])

  React.useEffect(() => {
    if (!isEditorReady(editor)) return
    const nextContent = normalizeWorkbenchContentJson(workbenchDocument.contentJson) as JSONContent
    const nextJson = JSON.stringify(nextContent)
    if (!nextJson || nextJson === lastEditorJsonRef.current) return
    lastEditorJsonRef.current = nextJson
    editor.commands.setContent(nextContent)
  }, [editor, workbenchDocument.contentJson])

  React.useEffect(() => {
    if (!isEditorReady(editor)) return
    const applyContent = (content: string, mode: 'insert' | 'replace' | 'append') => {
      if (!isEditorReady(editor)) return
      const tiptapContent = markdownToTiptapContent(content)
      if (!tiptapContent.length) return
      const chain = editor.chain().focus()
      if (mode === 'append') {
        chain.setTextSelection(editor.state.doc.content.size).insertContent(tiptapContent).run()
        return
      }
      if (mode === 'replace') {
        chain.deleteSelection().insertContent(tiptapContent).run()
        return
      }
      chain.insertContent(tiptapContent).run()
    }
    const tools: CreationDocumentTools = {
      readFullText: () => editor.getText({ blockSeparator: '\n' }).trim(),
      readSelectionText: () => readSelectedText(editor),
      insertAtCursor: (content) => applyContent(content, 'insert'),
      replaceSelection: (content) => applyContent(content, 'replace'),
      appendToEnd: (content) => applyContent(content, 'append'),
      writeDocument: (content) => applyContent(content, 'append'),
      generateStoryboardNode: (content) => {
        createStoryboardNodeFromContent(content, {
          addGenerationNode,
          setWorkspaceMode,
        })
      },
      generateAssetNode: (content) => {
        createImageNodeFromContent(content, {
          addGenerationNode,
          setWorkspaceMode,
        })
      },
    }
    setCreationDocumentTools(tools)
    creationDocumentToolsRef.current = tools
    return () => {
      if (creationDocumentToolsRef.current === tools) {
        setCreationDocumentTools(null)
        creationDocumentToolsRef.current = null
      }
    }
  }, [addGenerationNode, editor, setCreationDocumentTools, setWorkspaceMode])

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
          'workbench-editor__scroll',
          'min-w-0 min-h-0 overflow-auto',
        )}
      >
        <EditorContent editor={editor} />
      </div>
    </section>
  )
}
