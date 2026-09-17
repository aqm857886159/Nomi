import React from 'react'
import { workspacePanelFrame, workspacePanelHeader } from '../WorkspacePanelFrame'
import { useTranslation } from 'react-i18next'
import { EditorContent, type Editor, type JSONContent } from '@tiptap/react'
import SelectionGeneratePopover from './SelectionGeneratePopover'
import { WorkbenchIconButton } from '../../design/actions'
import { cn } from '../../utils/cn'
import { useWorkbenchStore } from '../workbenchStore'
import { normalizeWorkbenchContentJson } from '../workbenchTypes'
import { useTransientScrollingClass } from './useTransientScrollingClass'
import { useNomiRichTextEditor, RICH_TEXT_FEATURE_EXTENSIONS } from '../common/useNomiRichTextEditor'
import { buildRichTextActions, type RichTextAction } from '../common/richTextActions'
import { SurfacePortWireError } from '../../../electron/shared/surfacePortBinding'
import {
  assertDocumentWritePreconditions,
  captureDocumentAnchor,
  resolveDocumentWriteRange,
  type DocumentTextReader,
} from './documentWriteTarget'
import { documentSessionState, overrideDocumentSessionPort, type DocumentSessionPort } from '../project/documentSessionPort'

// 工具栏分组：格式按语义分 4 簇（文字 / 标题段落 / 列表 / 插入）靠左，历史（撤销/重做）推到右端。
// 之前用一个 flex-1 spacer 把 9 个按钮全挤到左侧、右边 ~570px 浪费 —— 这里按语义两端锚定。
// 5 簇封顶（§1.5 硬规则），每个簇都是往已有语义里补成员，不新增平铺簇。
const TOOLBAR_LEFT_GROUPS: readonly (readonly string[])[] = [
  ['bold', 'italic', 'strike', 'code', 'highlight'],
  ['h1', 'h2', 'h3', 'blockquote', 'horizontal-rule'],
  ['bullet-list', 'ordered-list', 'task-list'],
  ['table', 'link'],
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
  const { t } = useTranslation()
  const actions = buildRichTextActions(editor)
  if (actions.length === 0) {
    return (
      <div
        className={cn(
          'workbench-editor-toolbar',
          'flex items-center gap-1',
        workspacePanelHeader,
        )}
        aria-label={t('creationAi.editor.toolbarAria')}
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
        'flex items-center gap-1',
        workspacePanelHeader,
      )}
      aria-label={t('creationAi.editor.toolbarAria')}
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
  const { t } = useTranslation()
  const workbenchDocuments = useWorkbenchStore((state) => state.workbenchDocuments)
  const activeDocumentId = useWorkbenchStore((state) => state.activeDocumentId)
  const setWorkbenchDocument = useWorkbenchStore((state) => state.setWorkbenchDocument)
  const setCreationSelectionText = useWorkbenchStore((state) => state.setCreationSelectionText)
  const storyboardPlannerLauncher = useWorkbenchStore((state) => state.storyboardPlannerLauncher)
  const [selectionState, setSelectionState] = React.useState({ text: '', version: 0 })
  const scrollRef = useTransientScrollingClass<HTMLDivElement>('workbench-scrollbar-visible')
  // 当前激活文档（多文档：编辑器内容跟随 activeDocumentId）。
  const workbenchDocument = React.useMemo(
    () => workbenchDocuments.find((d) => d.id === activeDocumentId) ?? workbenchDocuments[0],
    [workbenchDocuments, activeDocumentId],
  )
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
      const currentDocument = workbenchDocumentRef.current
      const currentContent = normalizeWorkbenchContentJson(currentDocument.contentJson)
      // Tiptap can emit an initialization update even when its JSON is
      // unchanged. Opening a draft must not mutate its source revision or mark
      // every attached storyboard as needing synchronization.
      if (JSON.stringify(currentContent) === JSON.stringify(contentJson)) return
      setWorkbenchDocument({ ...currentDocument, contentJson, updatedAt: Date.now() })
    },
    [setWorkbenchDocument],
  )

  const handleSelectionChange = React.useCallback(
    (text: string) => {
      setSelectionState((current) => {
        if (!current.text && !text.trim()) return current
        return { text, version: current.version + 1 }
      })
      setCreationSelectionText(text)
    },
    [setCreationSelectionText],
  )

  const clearSelectionText = React.useCallback(() => {
    setSelectionState((current) => ({ text: '', version: current.version + 1 }))
    setCreationSelectionText('')
  }, [setCreationSelectionText])

  const { editor, tools } = useNomiRichTextEditor({
    content: editorContent,
    placeholder: t('creationAi.editor.placeholder'),
    onChange: handleChange,
    onSelectionChange: handleSelectionChange,
    featureExtensions: RICH_TEXT_FEATURE_EXTENSIONS,
    sanitizePaste: true,
    persistentSelection: true,
  })

  // 编辑器挂载时用**增强版**覆盖项目会话层的文稿端口（多了光标/选区锚与选区读），卸载时退回基线。
  // 基线本身随项目在（documentSessionPort），这里不是「有没有文稿能力」的开关。
  React.useEffect(() => {
    if (!editor) return
    const documentReader = (): DocumentTextReader => ({
      contentSize: editor.state.doc.content.size,
      textBetween: (from, to, blockSeparator) => editor.state.doc.textBetween(from, to, blockSeparator),
    })
    // 写完立刻读 state 要拿到 store 里刚落的那一份（onUpdate 同步写 store，ref 要等下一次渲染）。
    const liveDocument = () => {
      const state = useWorkbenchStore.getState()
      return state.workbenchDocuments.find((item) => item.id === workbenchDocumentRef.current.id) ?? workbenchDocumentRef.current
    }
    const enhanced: DocumentSessionPort = {
      readFullText: tools.readFullText,
      readSelectionText: tools.readSelectionText,
      // revision / contentHash 与基线同源（store 里的文档），只有锚是编辑器独有的。
      readState: () => documentSessionState(liveDocument(), captureDocumentAnchor(documentReader(), editor.state.selection)),
      applyDocumentWrite: (input) => {
        if (input.target.kind !== 'document' || input.target.documentId !== workbenchDocumentRef.current.id) {
          throw new SurfacePortWireError('surface_port_stale')
        }
        assertDocumentWritePreconditions(input.preconditions.document, enhanced.readState())
        // whole-document 锚（画布/分镜页发来的）：append 落文末、replace 换整篇；insert 没有位置。
        const size = documentReader().contentSize
        const range = input.target.anchor.kind === 'whole-document'
          ? input.operation === 'append' ? { from: size, to: size }
            : input.operation === 'replace' ? { from: 0, to: size }
              : (() => { throw new SurfacePortWireError('capability_unsupported') })()
          : resolveDocumentWriteRange(documentReader(), input.target.anchor, input.operation)
        tools.applyAtRange(input.content, range)
        const next = enhanced.readState()
        return Object.freeze({ applied: true as const, revision: next.revision, contentHash: next.contentHash })
      },
    }
    return overrideDocumentSessionPort(enhanced)
  }, [editor, tools])

  return (
    <section
      className={cn(
        'workbench-editor',
        'relative w-full h-full min-h-0',
        'grid grid-rows-[auto_minmax(0,1fr)]',
        workspacePanelFrame,
      )}
      aria-label={t('creationAi.editor.documentAria')}
      data-creation-editor="true"
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <WorkbenchEditorToolbar editor={editor} />
      <SelectionGeneratePopover
        editor={editor}
        selectedText={selectionState.text}
        selectionVersion={selectionState.version}
        onStoryboard={storyboardPlannerLauncher ? () => storyboardPlannerLauncher(selectionState.text) : undefined}
        onCreated={clearSelectionText}
      />
      <div
        ref={scrollRef}
        className={cn(
          'workbench-editor__scroll',
          'min-w-0 min-h-0 overflow-auto',
          // Tiptap Placeholder 渲染：空文档第一段显示 data-placeholder（仿 PromptEditor，
          // 补上创作编辑器缺失的 ::before 规则——根因，不是只在这一处贴症状）。
          '[&_.is-editor-empty]:before:content-[attr(data-placeholder)]',
          '[&_.is-editor-empty]:before:text-nomi-ink-40 [&_.is-editor-empty]:before:float-left',
          '[&_.is-editor-empty]:before:pointer-events-none [&_.is-editor-empty]:before:h-0',
          // 左浮动 + 高度 0 的伪元素宽度是「收缩到适合」——对一句长占位文字来说，
          // 「适合」就是整句的长度，于是它冲出编辑卡右缘（2026-09-17，W-12，zh/en 都有）。
          // 给它一个真实上限，让它在卡内折行；文档为空时下面没有内容可被它盖住。
          '[&_.is-editor-empty]:before:max-w-full',
        )}
      >
        <EditorContent editor={editor} />
      </div>
    </section>
  )
}
