import React from 'react'
import { useEditor, EditorContent, type Editor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { cn } from '../../utils/cn'
import { AssetMention } from './AssetMentionNode'
import { createAssetMentionSuggestion } from './AssetMentionSuggestion'
import { promptToContent } from './promptEditorContent'
import { encodeMention } from './promptMentions'

// 生成节点的描述框(规范 §4):Tiptap 编辑器替换原 textarea —— 句中可放 18px 缩略图 chip(@ 内联引用),
// 内容与 node.prompt 字符串双向同步(持久化用 @[asset:url] 标记,见 promptMentions)。
// 纯文字 prompt 完全等价于以前的 textarea 体验;只有插入 chip 时才出现内联图。

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
  className?: string
  onBlur?: () => void
  /** 暴露 editor 实例,供「点 tile 插入 chip」等外部命令(insertAssetMention)。 */
  onReady?: (editor: Editor) => void
  /** 打 @ 时可引用的 image 参考 url 列表(= node 的 referenceImageUrls,单源)。 */
  mentionCandidates?: string[]
  /** S6-4 节点锁:false=只读(Tiptap 官方 editable/setEditable);缺省可编辑。 */
  editable?: boolean
}

export default function PromptEditor({ value, onChange, placeholder, className, onBlur, onReady, mentionCandidates, editable }: PromptEditorProps): JSX.Element {
  const onChangeRef = React.useRef(onChange)
  React.useEffect(() => { onChangeRef.current = onChange }, [onChange])
  // @ suggestion 候选用 ref 喂(扩展只在 editor 创建时配一次,靠 ref 读最新参考列表)。
  const candidatesRef = React.useRef<string[]>(mentionCandidates || [])
  React.useEffect(() => { candidatesRef.current = mentionCandidates || [] }, [mentionCandidates])
  const suggestionExt = React.useMemo(() => createAssetMentionSuggestion({ getCandidates: () => candidatesRef.current }), [])
  // 防控制内容回灌死循环:记下编辑器自身最后产出的字符串,外部 value 等于它就不重设。
  const lastStringRef = React.useRef(value)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, bulletList: false, orderedList: false, blockquote: false, codeBlock: false, horizontalRule: false }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      AssetMention,
      suggestionExt,
    ],
    content: promptToContent(value),
    editable: editable !== false,
    editorProps: { attributes: { class: 'generation-canvas-v2-node__prompt-input outline-0' } },
    onUpdate: ({ editor: current }) => {
      const next = contentToPrompt(current)
      lastStringRef.current = next
      onChangeRef.current(next)
    },
  })

  React.useEffect(() => {
    if (editor && onReady) onReady(editor)
  }, [editor, onReady])

  // 锁切换时同步只读态(官方 setEditable;emitUpdate=false,只读切换不产出内容变更)。
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const next = editable !== false
    if (editor.isEditable !== next) editor.setEditable(next, false)
  }, [editor, editable])

  // 外部 value 变化(切节点 / AI 写入)→ 同步进编辑器,跳过自身刚产出的那次。
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (value === lastStringRef.current) return
    lastStringRef.current = value
    editor.commands.setContent(promptToContent(value))
  }, [editor, value])

  return (
    <EditorContent
      editor={editor}
      onBlur={onBlur}
      className={cn('text-nomi-ink text-body-sm leading-[1.7] [&_.ProseMirror]:outline-0 [&_.ProseMirror]:min-h-[38px] [&_.ProseMirror_p]:m-0 [&_.is-editor-empty]:before:text-nomi-ink-40 [&_.is-editor-empty]:before:content-[attr(data-placeholder)] [&_.is-editor-empty]:before:float-left [&_.is-editor-empty]:before:pointer-events-none [&_.is-editor-empty]:before:h-0', className)}
    />
  )
}
