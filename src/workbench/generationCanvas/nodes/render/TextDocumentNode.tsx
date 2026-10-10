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
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconGripVertical } from '@tabler/icons-react'
import { getGenerationNodeIcon } from '../renderRegistry'
import { EditorContent, useEditorState, type JSONContent } from '@tiptap/react'
import { cn } from '../../../../utils/cn'
import type { GenerationCanvasNode, TiptapDocJson } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { useNomiRichTextEditor } from '../../../common/useNomiRichTextEditor'
import { NODE_SCROLL_REGION_CLASS_NAME } from '../nodeScrollRegionClassName'
import { buildRichTextActions } from '../../../common/richTextActions'
import { NodeEmptyState } from './NodeEmptyState'
import { toast } from '../../../../ui/toast'
import { requestTaskCancel } from '../../runner/localTaskControl'
import { presetBlockHint, runTextPreset, useTextPresetBlocks } from '../textProcessRun'
import { TEXT_PROCESS_PRESET_LABEL_KEY, countSplitItems, type TextProcessPresetId } from '../../runner/textProcessPresets'
import { docToPlainText } from '../../runner/textGenerationDocument'
import { NomiLoadingMark } from '../../../../design'
import { useNodePromptFocusRequest } from '../nodePromptFocus'
import { landSelectionRewrite } from '../../runner/textActions'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

/** 空文本节点的「试试」：只放它真能做好的三件（写剧本去创作页，不放这里）。 */
const EMPTY_TRY_PRESETS = ['expand', 'describe', 'split'] as const satisfies readonly TextProcessPresetId[]
/** 正文长到这个字数，底部提示「在节点里滚动」。 */
const LONG_TEXT_CHARACTERS = 600
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
  const { t } = useTranslation()
  const writeNodeBody = useGenerationCanvasStore((state) => state.writeNodeBody)
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)

  const content = React.useMemo<JSONContent>(() => (node.contentJson ?? EMPTY_DOC) as JSONContent, [node.contentJson])

  const handleChange = React.useCallback(
    (json: JSONContent) => {
      writeNodeBody(node.id, json as unknown as TiptapDocJson, { persist: false })
    },
    [node.id, writeNodeBody],
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
    placeholder: '',
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
    // 换好的整篇是这次付费改写的落地：走同一个落地写口，撤销 / 重做不撤掉它。
    landSelectionRewrite(node.id, resultId, text && editor ? editor.getJSON() as unknown as TiptapDocJson : null)
  }, [resultId, pendingApplyId, node.id, node.result?.text, tools, editor])

  // 配方 / 节点提示词聚焦请求要把光标放进正文（nodes/nodePromptFocus）。
  const focusEditor = React.useMemo(() => (editor ? () => {
    if (editor.isDestroyed) return false
    editor.commands.focus('end')
    return true
  } : null), [editor])
  useNodePromptFocusRequest(node.id, focusEditor)

  const showPlaceholder = isDocEmpty(node.contentJson)
  const presetBlocks = useTextPresetBlocks(node.id)
  const running = node.status === 'queued' || node.status === 'running'
  const splitCount = node.meta?.textGenPreset === 'split' && !running ? countSplitItems(node.contentJson) : null
  const characterCount = React.useMemo(() => (showPlaceholder ? 0 : docToPlainText(node.contentJson).length), [node.contentJson, showPlaceholder])
  // 底部一行只说一件事：正在写（可停止）> 拆成几条 > 正文很长。都没有就不占位置。
  const footer = running ? 'running' : splitCount !== null ? 'split' : characterCount >= LONG_TEXT_CHARACTERS ? 'long' : null
  const actions = buildRichTextActions(editor)

  return (
    // 外层 overflow 可见，让格式条能浮到节点上方；圆角/阴影/裁剪都收进内层 body。
    <div className="relative h-full w-full">
      {/* 浮动格式条：编辑时浮在节点上方（不占节点高度）。 */}
      {editor && isFocused ? (
        <div
          role="toolbar"
          aria-label={t('generationCommon.textDocument.formattingAria')}
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
                'disabled:cursor-not-allowed disabled:text-nomi-ink-30',
              )}
            >
              {action.icon}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex h-full w-full flex-col overflow-hidden rounded-nomi bg-nomi-paper shadow-nomi-md ring-1 ring-inset ring-nomi-line">
        {/* 拖拽手柄：非 contenteditable，pointerdown 冒泡到 BaseGenerationNode 触发拖动。 */}
        <header
          className={cn(
            'shrink-0 flex items-center gap-1 h-7 px-2',
            'border-b border-nomi-line-soft text-nomi-ink-40',
            'cursor-grab select-none',
          )}
          aria-label={t('generationCommon.textDocument.dragAria')}
        >
          <IconGripVertical size={13} stroke={1.8} aria-hidden="true" />
          <span className="text-micro font-medium tracking-[0.04em]">{t('generationCommon.textDocument.label')}</span>
        </header>

        {/* 正文：ProseMirror 编辑区。stopPropagation 挡画布快捷键；select-text/touch-auto 覆盖
            外层 article 的 select-none/touch-none；[&_.ProseMirror]:outline-none 去掉 contenteditable
            的系统 focus 描边（否则 macOS 强调色会画出黄/橙框）。 */}
        <section
          className={cn(
            NODE_SCROLL_REGION_CLASS_NAME,
            'relative flex-1 min-h-0 overflow-auto cursor-text select-text touch-auto',
            '[&_.ProseMirror]:outline-none [&_.ProseMirror:focus]:outline-none [&_.ProseMirror:focus-visible]:outline-none',
            // 节点里的字是紧凑的提示词 / 描述，不是创作页那种长文排版：13px / 20px、12px 内边距、不限列宽。
            '[&_.ProseMirror]:m-0 [&_.ProseMirror]:min-h-0 [&_.ProseMirror]:max-w-none',
            '[&_.ProseMirror]:p-3 [&_.ProseMirror]:text-body-sm [&_.ProseMirror]:leading-5',
            '[&_.ProseMirror]:text-nomi-ink-80 [&_.ProseMirror_p]:mb-0',
            // 拆成多条的结果：编号列表，编号灰、右对齐在一列里。
            '[&_.ProseMirror_ol]:m-0 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-[22px]',
            '[&_.ProseMirror_li]:py-0.5 [&_.ProseMirror_li::marker]:text-nomi-ink-40 [&_.ProseMirror_li_p]:m-0',
          )}
          onKeyDown={(event) => event.stopPropagation()}
          onKeyUp={(event) => event.stopPropagation()}
          onBlur={() => commitPersistedChange()}
        >
          {showPlaceholder && !isFocused ? (
            // 2026-10-08 拍板 ③：空文本卡用「试试」替换那句说明。外层不接指针（点空白处照样落进正文去写），只有列表项能点。
            <div className="pointer-events-none absolute inset-0">
              <NodeEmptyState
                icon={React.createElement(getGenerationNodeIcon('text'), { size: 18, stroke: 1.5 })}
                title={t('canvas.nodeKinds.text')}
                description={t('generationCommon.nodeTry.status.text')}
                action={(
                  <div className="pointer-events-auto flex min-w-0 max-w-full flex-nowrap items-center justify-center gap-0.5 overflow-hidden whitespace-nowrap" data-text-empty-try data-node-try="text" role="group" aria-label={t('generationCommon.nodeTry.label')}>
                    {EMPTY_TRY_PRESETS.map((id, index) => (
                      <React.Fragment key={id}>
                        {index > 0 ? <span aria-hidden="true" className="text-caption text-nomi-ink-30">·</span> : null}
                        <button
                          type="button"
                          data-preset={id}
                          disabled={node.locked || Boolean(presetBlocks[id])}
                          title={presetBlocks[id] ? presetBlockHint(presetBlocks[id]!) : undefined}
                          className="inline-flex h-6 items-center whitespace-nowrap rounded-nomi-sm px-1.5 text-caption text-nomi-ink-80 hover:bg-nomi-ink-05 disabled:cursor-not-allowed disabled:text-nomi-ink-30"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            runTextPreset(node.id, id, (message) => toast(message, 'info', `text-process:${node.id}`))
                          }}
                        >
                          {t(TEXT_PROCESS_PRESET_LABEL_KEY[id])}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                )}
              />
            </div>
          ) : null}
          <EditorContent editor={editor} />
        </section>
        {footer ? (
          <footer
            data-text-node-footer={footer}
            className="grid h-9 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 border-t border-nomi-line-soft pl-3.5 pr-2 text-caption text-nomi-ink-40"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {footer === 'running' ? (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <NomiLoadingMark size={12} label={t('generationCommon.textProcess.running')} />
                  {t('generationCommon.textProcess.running')}
                </span>
                <button
                  type="button"
                  className="inline-flex h-6 items-center rounded-nomi-sm px-1.5 text-caption text-nomi-ink-80 hover:bg-nomi-ink-05"
                  onClick={(event) => { event.stopPropagation(); requestTaskCancel(node, (message) => { if (message) toast(message, 'warning') }) }}
                >
                  {t('generationCommon.textProcess.stop')}
                </button>
              </>
            ) : footer === 'split'
              ? <span>{t('generationCommon.textProcess.splitCount', { count: splitCount ?? 0 })}</span>
              : <span>{t('generationCommon.textProcess.longText', { count: characterCount })}</span>}
          </footer>
        ) : null}
      </div>
    </div>
  )
}

const TextDocumentNode = React.memo(TextDocumentNodeImpl, (prev, next) => prev.node === next.node)
TextDocumentNode.displayName = 'TextDocumentNode'
export default TextDocumentNode
