import React from 'react'
import { useEditor, EditorContent, type Editor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { cn } from '../../utils/cn'
import { AssetMention } from './AssetMentionNode'
import { createAssetMentionSuggestion } from './AssetMentionSuggestion'
import type { MentionSuggestionItem, MentionUploadControls } from './AssetMentionSuggestionList'
import { promptToContent, shouldApplyExternalPromptSync, shouldEmitPromptUpdate } from './promptEditorContent'
import { encodeMention } from './promptMentions'
import { promptRangeToDocRanges, promptRunsFromDocument, type PromptEditorSegment } from './promptEditorSkeleton'

// 生成节点的描述框(规范 §4):Tiptap 编辑器替换原 textarea —— 句中可放 18px 缩略图 chip(@ 内联媒体引用),
// 内容与 node.prompt 字符串双向同步(持久化用 @[asset:url] 标记,见 promptMentions)。
// 纯文字 prompt 完全等价于以前的 textarea 体验;只有插入 chip 时才出现内联媒体块。

// Tiptap doc → node.prompt 字符串(assetMention → @[asset:url] 标记;段落 → \n)。
function contentToPrompt(editor: Editor): string {
  const json = editor.getJSON()
  const paragraphs = (json.content || []).map((para: JSONContent) =>
    (para.content || []).map((n: JSONContent) => (n.type === 'assetMention' ? encodeMention(String(n.attrs?.url || '')) : (n.text || ''))).join(''),
  )
  return paragraphs.join('\n')
}

type PromptEditorProps = {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  /** 可编辑区的可访问名（提示词框是主输入面，读屏必须报得出它属于哪一镜）。 */
  ariaLabel?: string
  className?: string
  onBlur?: () => void
  /** 暴露 editor 实例,供「点 tile 插入 chip」等外部命令(insertAssetMention)。 */
  onReady?: (editor: Editor) => void
  /**
   * **有序图片参考 url 列表**（= 发送时 `@imageN` 的那一份）。只管兼容旧图片 chip 编号：初次渲染定编号 + 参考顺序变了实时重编。
   * 与下面的 @ 候选是两件事：候选可以来自素材库/画布（还没成为参考），编号只认已经在槽里的。
   */
  mentionCandidates?: string[]
  /** All media references used to keep chip labels type-aware. */
  mentionReferences?: { url: string; kind: 'image' | 'video' | 'audio'; index: number }[]
  /** 打 @ 时按 query 给候选（当前参考 / 画布 / 素材库三组）。缺省 = 不开 @ 面板。 */
  mentionSearch?: (query: string) => MentionSuggestionItem[]
  /** 选中候选：负责真的建立引用（建边/落上传槽），返回最终 chip 编号；返回 null = 没插成。 */
  onMentionSelect?: (item: MentionSuggestionItem) => number | null
  /** @ 面板沿用 composer 附件上传管线；上传完成后作为 upload 来源重新出现在列表。 */
  mentionUpload?: MentionUploadControls
  /** S6-4 节点锁:false=只读(Tiptap 官方 editable/setEditable);缺省可编辑。 */
  editable?: boolean
  /** 可选的提示词内联结构标注；标注是易失视图，不参与 prompt 持久化。 */
  promptSegments?: PromptEditorSegment[]
  /** 点击提示词内联结构标注；菜单由调用方渲染在编辑器外壳内。 */
  onPromptSegmentClick?: (segment: PromptEditorSegment, rect: DOMRect) => void
}

function createPromptSkeletonPlugin(options: {
  getSegments: () => PromptEditorSegment[]
  onClick: (segment: PromptEditorSegment, rect: DOMRect) => void
}): Plugin {
  return new Plugin({
    props: {
      decorations: (state) => {
        const runs = promptRunsFromDocument(state.doc)
        const decorations = options.getSegments().flatMap((segment) => promptRangeToDocRanges(segment, runs).map(({ from, to }) => Decoration.inline(from, to, {
          class: 'storyboard-prompt-segment',
          role: 'button',
          tabindex: '0',
          ...(segment.ariaLabel ? { 'aria-label': segment.ariaLabel } : {}),
          'data-prompt-segment-key': segment.key,
          'data-storyboard-prompt-segment': segment.key,
          'data-prompt-segment-start': String(segment.start),
          'data-prompt-segment-end': String(segment.end),
        })))
        return DecorationSet.create(state.doc, decorations)
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-prompt-segment-key]') : null
        if (!target) return false
        const key = target.dataset.promptSegmentKey
        const start = Number(target.dataset.promptSegmentStart)
        const end = Number(target.dataset.promptSegmentEnd)
        if (!key || !Number.isInteger(start) || !Number.isInteger(end)) return false
        options.onClick({ key, start, end }, target.getBoundingClientRect())
        return true
      },
    },
  })
}

export default function PromptEditor({ value, onChange, placeholder, ariaLabel, className, onBlur, onReady, mentionCandidates, mentionReferences, mentionSearch, onMentionSelect, mentionUpload, editable, promptSegments, onPromptSegmentClick }: PromptEditorProps): JSX.Element {
  const onChangeRef = React.useRef(onChange)
  React.useEffect(() => { onChangeRef.current = onChange }, [onChange])
  // 有序参考 url 也留一份 ref：外部 value 变化时 setContent 要用它给 chip 编号（那个 effect 不该依赖它重跑）。
  const orderedUrlsRef = React.useRef<string[]>(mentionCandidates || [])
  React.useEffect(() => { orderedUrlsRef.current = mentionCandidates || [] }, [mentionCandidates])
  // @ suggestion 的两个回调用 ref 喂(扩展只在 editor 创建时配一次,靠 ref 读最新实现)。
  const searchRef = React.useRef(mentionSearch)
  React.useEffect(() => { searchRef.current = mentionSearch }, [mentionSearch])
  const selectRef = React.useRef(onMentionSelect)
  React.useEffect(() => { selectRef.current = onMentionSelect }, [onMentionSelect])
  const uploadRef = React.useRef(mentionUpload)
  React.useEffect(() => { uploadRef.current = mentionUpload }, [mentionUpload])
  const promptSegmentsRef = React.useRef<PromptEditorSegment[]>(promptSegments ?? [])
  React.useEffect(() => { promptSegmentsRef.current = promptSegments ?? [] }, [promptSegments])
  const promptSegmentClickRef = React.useRef(onPromptSegmentClick)
  React.useEffect(() => { promptSegmentClickRef.current = onPromptSegmentClick }, [onPromptSegmentClick])
  // placeholder 同理走 ref：扩展只在 editor 创建时配一次，直接把 prop 传进 configure 的话，
  // 调用方**后来**改的 placeholder 永远不生效——「已有参考图才提示打 @」正是这种后来才成立的条件。
  // 官方类型允许传函数（PlaceholderOptions.placeholder: ((props) => string) | string），
  // 函数在每次装饰重算时被调用，于是 ref 一更新就能读到最新值。
  const placeholderRef = React.useRef(placeholder ?? '')
  const suggestionExt = React.useMemo(
    () => createAssetMentionSuggestion({
      getCandidates: (query) => searchRef.current?.(query) ?? [],
      onSelect: (item) => selectRef.current?.(item) ?? null,
      getUpload: () => uploadRef.current,
    }),
    [],
  )
  const promptSkeletonExt = React.useMemo(
    () => Extension.create({
      name: 'promptSkeletonDecoration',
      addProseMirrorPlugins() {
        return [createPromptSkeletonPlugin({
          getSegments: () => promptSegmentsRef.current,
          onClick: (segment, rect) => promptSegmentClickRef.current?.(segment, rect),
        })]
      },
    }),
    [],
  )
  // 防控制内容回灌死循环:记下编辑器自身最后产出的字符串,外部 value 等于它就不重设。
  const lastStringRef = React.useRef(value)
  const latestValueRef = React.useRef(value)
  latestValueRef.current = value

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, bulletList: false, orderedList: false, blockquote: false, codeBlock: false, horizontalRule: false }),
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
      AssetMention,
      suggestionExt,
      promptSkeletonExt,
    ],
    content: promptToContent(value, mentionReferences ?? mentionCandidates),
    editable: editable !== false,
    editorProps: { attributes: { class: 'generation-canvas-v2-node__prompt-input outline-0', ...(ariaLabel ? { 'aria-label': ariaLabel } : {}) } },
    onUpdate: ({ editor: current, transaction }) => {
      const next = contentToPrompt(current)
      if (!shouldEmitPromptUpdate(transaction.docChanged, next, latestValueRef.current)) return
      lastStringRef.current = next
      latestValueRef.current = next
      onChangeRef.current(next)
    },
  })

  React.useEffect(() => {
    if (editor && onReady) onReady(editor)
  }, [editor, onReady])

  // placeholder 变了要**主动重画一次**：装饰只在有事务时重算，而「加了一张参考图」这类外部变化
  // 不会在编辑器里产生任何事务，光更新 ref 是看不到的。
  // 空事务安全：core 的 dispatchTransaction 里 `!transactions.some(tr => tr.docChanged)` 直接 return，
  // 不会触发 onUpdate，也就不会把 prompt 误标成用户改过（index.js:5193）。
  React.useEffect(() => {
    const next = placeholder ?? ''
    if (placeholderRef.current === next) return
    placeholderRef.current = next
    if (!editor || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr)
  }, [editor, placeholder])

  // 锁切换时同步只读态(官方 setEditable;emitUpdate=false,只读切换不产出内容变更)。
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const next = editable !== false
    if (editor.isEditable !== next) editor.setEditable(next, false)
  }, [editor, editable])

  // 外部 value 变化(切节点 / AI 写入)→ 同步进编辑器,跳过自身刚产出的那次。
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (!shouldApplyExternalPromptSync(value, latestValueRef.current, lastStringRef.current)) return
    lastStringRef.current = value
    editor.commands.setContent(promptToContent(value, mentionReferences ?? orderedUrlsRef.current), { emitUpdate: false })
  }, [editor, mentionReferences, value])

  // 参考拖拽重排后，prompt 字符串仍是同一批 url，但 chip 的媒体编号必须按最新列表立即刷新。
  // 只改易失的 index 属性，不改持久化内容、不重建编辑器，也不打断当前光标。
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const orderedUrls = mentionReferences ?? mentionCandidates ?? []
    let transaction = editor.state.tr
    let changed = false
    editor.state.doc.descendants((docNode, pos) => {
      if (docNode.type.name !== 'assetMention') return
      const url = String(docNode.attrs.url || '')
      const reference = typeof orderedUrls[0] === 'string'
        ? (() => {
          const orderedIndex = (orderedUrls as string[]).indexOf(url)
          return orderedIndex >= 0 ? { kind: 'image' as const, index: orderedIndex + 1 } : null
        })()
        : (orderedUrls as { url: string; kind: 'image' | 'video' | 'audio'; index: number }[]).find((candidate) => candidate.url === url) ?? null
      const nextIndex = reference?.index ?? null
      const nextKind = reference?.kind ?? 'image'
      if (docNode.attrs.index === nextIndex && docNode.attrs.kind === nextKind) return
      transaction = transaction.setNodeMarkup(pos, undefined, { ...docNode.attrs, index: nextIndex, kind: nextKind })
      changed = true
    })
    if (changed) editor.view.dispatch(transaction)
  }, [editor, mentionCandidates, mentionReferences])

  // 外部范围变化不一定伴随文档事务，发一个空事务让 decoration 按最新标注重算；不触发 onUpdate。
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr)
  }, [editor, promptSegments])

  return (
    <EditorContent
      editor={editor}
      onBlur={onBlur}
      data-prompt-box="true"
      className={cn('text-nomi-ink text-body-sm leading-[1.7] [&_.ProseMirror]:outline-0 [&_.ProseMirror]:min-h-[38px] [&_.ProseMirror_p]:m-0 [&_.is-editor-empty]:before:text-nomi-ink-40 [&_.is-editor-empty]:before:content-[attr(data-placeholder)] [&_.is-editor-empty]:before:float-left [&_.is-editor-empty]:before:pointer-events-none [&_.is-editor-empty]:before:h-0 [&_.storyboard-prompt-segment]:border-b [&_.storyboard-prompt-segment]:border-dashed [&_.storyboard-prompt-segment]:border-nomi-ink-30 [&_.storyboard-prompt-segment]:cursor-pointer [&_.storyboard-prompt-segment:hover]:border-nomi-accent [&_.storyboard-prompt-segment:hover]:text-nomi-ink', className)}
    />
  )
}
