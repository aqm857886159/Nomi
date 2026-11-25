import React from 'react'
import { useEditor, type Editor, type JSONContent, type UseEditorOptions } from '@tiptap/react'
import { markInputRule, markPasteRule, type AnyExtension, type EditorOptions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Highlight } from '@tiptap/extension-highlight'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { markdownToTiptapContent } from '../creation/markdownToTiptap'
import { sanitizePastedHtml } from './sanitizePastedHtml'
import { PersistentSelectionExtension } from './persistentSelection'
import { createControlledEditorSync, type ControlledEditorSync } from './controlledEditorSync'
import { AiRewriteExtension } from '../creation/aiRewrite/rewriteSession'

// ==高亮== 输入/粘贴规则：Tiptap 默认规则要求 `==` 前是行首或空白，中文「这是==重点==」
// 无空格场景会失效；这里放宽为任意位置触发，对齐 ColaMD 的 `/==([^=]+)==/`。
const HighlightWithZh = Highlight.extend({
  addInputRules() {
    return [markInputRule({ find: /==([^=]+)==$/, type: this.type })]
  },
  addPasteRules() {
    return [markPasteRule({ find: /==([^=]+)==/g, type: this.type })]
  },
})

// 创作编辑器的富文本特性扩展（模块级稳定引用，避免 editor 反复重建）。
// 画布文字节点（TextDocumentNode）复用同一内核但不挂这些——它保持基础能力，行为零回归。
export const RICH_TEXT_FEATURE_EXTENSIONS: AnyExtension[] = [
  HighlightWithZh,
  TaskList,
  TaskItem,
  TableKit,
  // 选中文字 → AI 编辑 → 就地出结果（只有创作编辑器挂；画布文字节点不挂）。
  AiRewriteExtension,
]

const EMPTY_EXTENSIONS: AnyExtension[] = []

/**
 * The React adapter must keep one mounted TipTap instance as the owner of the
 * ProseMirror view. React 19 can render a parent again while a native DOM
 * selection is settling; allowing transaction-driven React renders or an
 * implicit client/server mode to choose the lifecycle makes the DOM and the
 * editor state diverge. Both rich-text surfaces consume this one contract.
 */
const NOMI_TIPTAP_EDITOR_OPTIONS = {
  immediatelyRender: true,
  shouldRerenderOnTransaction: false,
} as const

/**
 * 编辑器的 owner 绑定：值归 owner（项目里存着的那一份：分镜 / 节点的提示词、文稿正文、助手草稿），
 * 形状就是 React `useSyncExternalStore` 那一套（subscribe / getSnapshot），外加一个写口。
 * 入口只从 owner 的 getSnapshot 读真值——不收「初始内容」，也不收渲染那一刻的值，
 * 所以造不出一个拿着旧副本的编辑器：藏起期间 owner 变了，实例出生时读到的也是变了以后的。
 */
export type NomiEditorOwner<V> = {
  /** owner 的值变了就通知（zustand store 的 `subscribe` 直接能用）。 */
  subscribe: (onStoreChange: () => void) => () => void
  /** owner 此刻的值。值没变时必须返回同一个引用（useSyncExternalStore 的要求）。 */
  getSnapshot: () => V
  /** 编辑器里的内容变了（创作者编辑）。`previous` 按需取：这次编辑之前的那一版。 */
  write: (next: V, previous: () => V) => void
}

/** owner 的读口（subscribe / getSnapshot）：宿主一层层往下交，到编辑器那一层再配上写口。 */
export type NomiEditorSource<V> = Pick<NomiEditorOwner<V>, 'subscribe' | 'getSnapshot'>

/** 值与 TipTap 文档的互转。归编辑器种类（提示词框 / 文稿），不归 owner。 */
export type NomiEditorCodec<V> = {
  /** 值 → TipTap 文档。 */
  toDoc: (value: V) => JSONContent
  /** TipTap 文档 → 值。 */
  fromDoc: (doc: JSONContent) => V
  /** 值的比较键：同一版值键相同（提示词就是它自己，文档是它的 JSON 串）。 */
  keyOf: (value: V) => string
}

/**
 * 入口只收这几样：owner 绑定 + 编解码 + 扩展与视图选项（白名单）。没有 `content`、没有 `value`、没有 `onUpdate`，
 * 也没有 `onBeforeCreate` / `onCreate` / `onTransaction` 这些能在实例出生时塞进旧值的口。
 */
type NomiTiptapEditorOptions<V> = {
  owner: NomiEditorOwner<V>
  codec: NomiEditorCodec<V>
  extensions: EditorOptions['extensions']
  editorProps?: EditorOptions['editorProps']
  editable?: boolean
  onSelectionUpdate?: EditorOptions['onSelectionUpdate']
  /**
   * 外部写入落进**正在聚焦**的编辑器后，把光标放回原来的位置（按新文档长度截）。不开 = TipTap 默认（落到写入内容之后）。
   * 文稿编辑器开（Agent / AI 往正在写的文稿里写，光标不跳）；提示词框维持原样不开。
   */
  keepSelectionOnExternalWrite?: boolean
}

/** 受控内容按编辑器 schema 解析后，是否与当前文档结构相同。解析不了（非法内容）按「不同」处理。 */
function docsAreEqual(editor: Editor, content: JSONContent): boolean {
  try {
    return editor.schema.nodeFromJSON(content).eq(editor.state.doc)
  } catch {
    return false
  }
}

/**
 * The only door to TipTap's `useEditor` (eslint `no-restricted-imports` bans it
 * elsewhere): every Nomi editor gets the lifecycle policy above, and a caller
 * cannot override it. Callers still own keeping their option collections stable.
 *
 * 编辑器是自己文本的唯一 owner、owner 的值才是真值，两件事都在这里做完，调用方没有地方再写一份：
 *   · 出生即真值：每个实例（首次挂载、deps 变化重建、React `<Activity>` 藏起再放出后重建）在 TipTap 用 content
 *     造文档之前（`beforeCreate`，@tiptap/core Editor 构造顺序）调 owner 的 getSnapshot()，把 content 设成它。
 *     读的是 owner 此刻的值，不是上一次渲染拿到的值（藏起期间 effect 断开、渲染可能被 memo 挡住，渲染值会旧）。
 *     这是初始文档，不是一次编辑：不进撤销历史、不发 update（不回写），也不会空一帧。受控同步账从这一版重开。
 *   · 回写：只有改了文档、且值真的变了的编辑才写给 owner（账见 controlledEditorSync.ts）。
 *   · 外部写入：owner 的值真来自外部才写进编辑器（不发 update）；自己发出去的回声、和当前文档等价的写法都不写。
 */
export function useNomiTiptapEditor<V>(options: NomiTiptapEditorOptions<V>, deps?: React.DependencyList): Editor {
  const { owner, codec, extensions, editorProps, editable, onSelectionUpdate, keepSelectionOnExternalWrite = false } = options
  // 渲染时就更新：TipTap 在渲染里（首次）或 effect 里（重建）造实例，用的必须是最近一次交进来的 owner 与编解码。
  const ownerRef = React.useRef(owner)
  ownerRef.current = owner
  const codecRef = React.useRef(codec)
  codecRef.current = codec
  // 跟 owner：值变了就重渲染，下面的外部写入 effect 才会跑。
  // 第三参同样是 owner.getSnapshot：静态渲染（renderToStaticMarkup）也按 owner 此刻的值出字。
  const value = React.useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot)
  const syncRef = React.useRef<ControlledEditorSync | null>(null)
  if (!syncRef.current) syncRef.current = createControlledEditorSync(codec.keyOf(value))
  const sync = syncRef.current

  const editor = useEditor(
    {
      extensions,
      // 没给的选项不转交：TipTap 用 `{ ...默认, ...选项 }` 合并，显式的 undefined 会盖掉默认值
      // （editorProps 没了 → 建视图时读 editorProps.dispatchTransaction 抛错；editable 没了 → 只读）。
      ...(editorProps === undefined ? {} : { editorProps }),
      ...(editable === undefined ? {} : { editable }),
      ...(onSelectionUpdate === undefined ? {} : { onSelectionUpdate }),
      onBeforeCreate: ({ editor: created }) => {
        const truth = ownerRef.current.getSnapshot()
        created.setOptions({ content: codecRef.current.toDoc(truth) })
        sync.reset(codecRef.current.keyOf(truth))
      },
      onUpdate: ({ editor: current, transaction }) => {
        if (!transaction.docChanged) return
        const { fromDoc, keyOf } = codecRef.current
        const next = fromDoc(current.getJSON())
        if (sync.emit(keyOf(next))) ownerRef.current.write(next, () => fromDoc(transaction.before.toJSON() as JSONContent))
      },
      ...NOMI_TIPTAP_EDITOR_OPTIONS,
    } satisfies UseEditorOptions,
    deps,
  )

  const valueKey = codec.keyOf(value)
  const keepSelectionRef = React.useRef(keepSelectionOnExternalWrite)
  keepSelectionRef.current = keepSelectionOnExternalWrite
  React.useEffect(() => {
    if (!isEditorReady(editor)) return
    const truth = ownerRef.current.getSnapshot()
    if (!sync.receive(codecRef.current.keyOf(truth))) return
    const doc = codecRef.current.toDoc(truth)
    // owner 回流的是「同一篇文档的另一种写法」（键序 / 空段落省不省 content 不同，字符串比不等）时，
    // 这不是外部改写：再 setContent 只会往撤销栈里压一条看不见的等价记录。按文档结构比，相等就什么都不做。
    if (docsAreEqual(editor, doc)) return
    const previousSelection = editor.state.selection
    // 外部写入（切节点 / AI / Agent 写入 / 撤销）是 owner 的值，不是用户编辑：不发 update，不回写。
    editor.commands.setContent(doc, { emitUpdate: false })
    if (keepSelectionRef.current && editor.isFocused) {
      const maxPosition = editor.state.doc.content.size
      editor.commands.setTextSelection({
        from: Math.min(previousSelection.from, maxPosition),
        to: Math.min(previousSelection.to, maxPosition),
      })
    }
  }, [editor, valueKey, sync])

  return editor
}

/**
 * Shared Tiptap rich-text kernel — single source of truth for BOTH the creation
 * editor (WorkbenchEditor) and the canvas text node (TextDocumentNode). The
 * extension set, selection reading and markdown-apply commands live here so we
 * never run two Tiptap configs; controlled-content sync lives in the one entry
 * (useNomiTiptapEditor) that every editor goes through.
 *
 * Each surface renders its own shell (full-height toolbar vs floating bar) but
 * shares this kernel + useRichTextActions().
 */
type RichTextApplyMode = 'insert' | 'replace' | 'append'

type NomiRichTextTools = {
  readFullText: () => string
  readSelectionText: () => string
  /** Apply markdown at an explicit ProseMirror range captured by the caller. */
  applyAtRange: (content: string, range: { from: number; to: number }) => void
  insertAtCursor: (content: string) => void
  replaceSelection: (content: string) => void
  appendToEnd: (content: string) => void
}

export function isEditorReady(editor: Editor | null): editor is Editor {
  return Boolean(editor && !editor.isDestroyed)
}

function readSelectedText(editor: Editor): string {
  const { from, to, empty } = editor.state.selection
  if (empty || from === to) return ''
  return editor.state.doc.textBetween(from, to, '\n').trim()
}

const identityDoc = (doc: JSONContent): JSONContent => doc
/** 文稿的编解码：值就是 TipTap JSON，比较键是它的 JSON 串。 */
const DOC_CODEC: NomiEditorCodec<JSONContent> = { toDoc: identityDoc, fromDoc: identityDoc, keyOf: JSON.stringify }

export function useNomiRichTextEditor(options: {
  /**
   * 文档的 owner（项目里存着的那一份 Tiptap JSON）：交 store 的 subscribe / getSnapshot 和写口。
   * 编辑器每个实例出生时都按 getSnapshot() 造文档，之后只在 owner 的值真来自外部时写进来。
   */
  owner: NomiEditorOwner<JSONContent>
  placeholder?: string
  editable?: boolean
  /** 富文本特性扩展（高亮/待办/表格）。创作编辑器传 RICH_TEXT_FEATURE_EXTENSIONS，画布文字节点省略保持基础能力。 */
  featureExtensions?: AnyExtension[]
  /** 粘贴 HTML 清洗（Excel/Word 脏 HTML → 干净语义结构）。创作编辑器开，画布文字节点默认关。 */
  sanitizePaste?: boolean
  /** Keep a selected creation range visibly marked while a sibling surface owns focus. */
  persistentSelection?: boolean
  /** Fires on selection change with the selected plain text (empty when none). */
  onSelectionChange?: (text: string) => void
}): { editor: Editor | null; tools: NomiRichTextTools } {
  const {
    owner,
    placeholder,
    editable = true,
    featureExtensions = EMPTY_EXTENSIONS,
    sanitizePaste = false,
    persistentSelection = false,
    onSelectionChange,
  } = options

  // Keep the selection callback in a ref so changing it never re-creates the editor instance.
  const onSelectionChangeRef = React.useRef(onSelectionChange)
  React.useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  const extensions = React.useMemo(() => [
    StarterKit,
    Placeholder.configure({ placeholder: placeholder ?? '' }),
    ...featureExtensions,
    ...(persistentSelection ? [PersistentSelectionExtension] : []),
  ], [featureExtensions, persistentSelection, placeholder])

  const editorProps = React.useMemo(
    () => ({
      // 列表的样式写在这里，不写全局 CSS：Tailwind 的 preflight 把 ul / ol 的 list-style 清成 none，
      // 之前全局 CSS 只补了缩进没补符号——点「无序 / 有序列表」只看到整段右移，像没生效（2026-10-23 用户实测）。
      // 待办列表（ul[data-type=taskList]）在 workbench.css 里以更高优先级去掉符号。
      attributes: { class: 'workbench-editor__content [&_ul]:mb-3.5 [&_ul]:pl-6 [&_ul]:list-disc [&_ol]:mb-3.5 [&_ol]:pl-6 [&_ol]:list-decimal' },
      transformPastedHTML: sanitizePaste ? (html: string) => sanitizePastedHtml(html) : undefined,
    }),
    [sanitizePaste],
  )

  // 首填、重建后再填、防回写都在入口里（useNomiTiptapEditor）；这里只交 owner 与编解码。
  const editor = useNomiTiptapEditor(
    {
      owner,
      codec: DOC_CODEC,
      editable,
      extensions,
      editorProps,
      onSelectionUpdate: ({ editor: current }) => {
        onSelectionChangeRef.current?.(readSelectedText(current))
      },
      keepSelectionOnExternalWrite: true,
    },
    [placeholder],
  )

  React.useEffect(() => {
    if (isEditorReady(editor)) editor.setEditable(editable)
  }, [editor, editable])

  const tools = React.useMemo<NomiRichTextTools>(() => {
    const apply = (text: string, mode: RichTextApplyMode) => {
      if (!isEditorReady(editor)) return
      const tiptapContent = markdownToTiptapContent(text)
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
    const applyAtRange = (text: string, range: { from: number; to: number }) => {
      if (!isEditorReady(editor)) return
      const tiptapContent = markdownToTiptapContent(text)
      if (!tiptapContent.length) return
      const chain = editor.chain().focus().setTextSelection(range)
      if (range.from !== range.to) chain.deleteSelection()
      chain.insertContent(tiptapContent).run()
    }
    return {
      readFullText: () => (isEditorReady(editor) ? editor.getText({ blockSeparator: '\n' }).trim() : ''),
      readSelectionText: () => (isEditorReady(editor) ? readSelectedText(editor) : ''),
      applyAtRange,
      insertAtCursor: (content) => apply(content, 'insert'),
      replaceSelection: (content) => apply(content, 'replace'),
      appendToEnd: (content) => apply(content, 'append'),
    }
  }, [editor])

  return { editor, tools }
}
