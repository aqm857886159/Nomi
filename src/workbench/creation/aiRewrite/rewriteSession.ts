import { Extension } from '@tiptap/core'
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { diffRewrite } from './rewriteDiff'

/**
 * 「选中文字 → AI 编辑 → 就地出结果」在文稿里的**唯一状态与落地点**。
 *
 * 为什么是 ProseMirror 插件状态、不是 React state：区间要随文档编辑一起平移（`tr.mapping`），
 * 只有编辑器自己知道文档怎么变。结果只是「叠在原文上的画」（装饰），接受之前文档一个字没动；
 * 接受 = 一笔事务换掉区间，所以天然进编辑器的撤销栈（Ctrl+Z 一步回到改写前）。
 * 会话和任何一次模型调用的对应关系只靠 `id`：调用回来时会话已经不是它了（用户关了 /
 * 换了文档 / 原文被改过），结果就地丢弃，永远不会写到别处。
 */
export type RewriteSkillRef = { key: string; title: string; body: string }

/** 一次「怎么改」：输入框里显示的字、给模型的话、挂着的 Skill。 */
export type RewriteRequirement = { text: string; instruction: string; skill: RewriteSkillRef | null }

export type RewriteStatus = 'menu' | 'running' | 'result' | 'failed'

export type RewriteSession = Readonly<{
  id: number
  /** 打开那一刻编辑器里的是哪篇文稿。接受前必须还是它：同一个编辑器会被不同文稿复用，正文还可能一模一样，只靠内容分不出来。 */
  documentId: string | null
  from: number
  to: number
  /** 打开那一刻区间里的文字：每一次「重来 / 追加要求」都从它出发，不从上一版结果出发。 */
  original: string
  status: RewriteStatus
  requirement: RewriteRequirement | null
  result: string | null
  failure: string | null
}>

type RewriteMeta =
  | { type: 'open'; session: RewriteSession }
  | { type: 'patch'; id: number; patch: Partial<Pick<RewriteSession, 'status' | 'requirement' | 'result' | 'failure'>> }
  | { type: 'close' }
  | { type: 'document'; id: string | null }

/** 插件状态：当前编辑器里是哪篇文稿 + 至多一个会话。 */
export type RewritePluginState = Readonly<{ documentId: string | null; session: RewriteSession | null }>

export const rewriteSessionKey = new PluginKey<RewritePluginState>('nomiAiRewrite')

export function getRewriteSession(state: EditorState): RewriteSession | null {
  return rewriteSessionKey.getState(state)?.session ?? null
}

export function getRewriteDocumentId(state: EditorState): string | null {
  return rewriteSessionKey.getState(state)?.documentId ?? null
}

/**
 * 会话身份 = 项目 + 文稿。只用文稿 id 不够：整份复制项目再打开，两个项目里有同 id、同正文的文稿，切项目时文稿 id 没变。
 */
export function rewriteDocumentIdentity(projectId: string | null, documentId: string): string {
  return `${projectId ?? ''}::${documentId}`
}

/**
 * 宿主在「编辑器里换了一篇文稿」时发的事务（正文一样、编辑器照旧复用时文档本身不会变，所以必须显式告诉插件）。
 * 换了文稿 = 属于旧文稿的会话当场作废（进行中的请求随之取消，结果回来也无处可写）。
 */
export function setRewriteDocumentIdentityTransaction(state: EditorState, id: string | null): Transaction {
  return state.tr.setMeta(rewriteSessionKey, { type: 'document', id } satisfies RewriteMeta)
}

// —— 区间里的文字与「文字偏移 → 文档位置」 ——————————————————————————————————————

/** 区间文字 + 每个字符对应的文档位置（块之间补的换行没有位置，记 -1）。 */
export type RangeText = { text: string; positions: number[] }

export function readRange(doc: ProseMirrorNode, from: number, to: number): RangeText {
  let text = ''
  const positions: number[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      if (text.length > 0) {
        text += '\n'
        positions.push(-1)
      }
      return true
    }
    if (node.isText) {
      const start = Math.max(from, pos)
      const end = Math.min(to, pos + node.nodeSize)
      const chunk = node.text!.slice(start - pos, end - pos)
      for (let index = 0; index < chunk.length; index += 1) positions.push(start + index)
      text += chunk
      return false
    }
    return true
  })
  return { text, positions }
}

export function rangeText(doc: ProseMirrorNode, from: number, to: number): string {
  return readRange(doc, from, to).text
}

/** 选区两头的空白不算要改的字：缩到第一个 / 最后一个非空白字符。 */
export function trimmedRange(doc: ProseMirrorNode, from: number, to: number): { from: number; to: number; text: string } | null {
  const { text, positions } = readRange(doc, from, to)
  let start = 0
  let end = text.length
  while (start < end && /\s/.test(text[start]!)) start += 1
  while (end > start && /\s/.test(text[end - 1]!)) end -= 1
  if (start >= end) return null
  let first = start
  while (first < end && positions[first] === -1) first += 1
  let last = end - 1
  while (last > first && positions[last] === -1) last -= 1
  const trimmedFrom = positions[first]
  const trimmedTo = positions[last]
  if (trimmedFrom === undefined || trimmedTo === undefined || trimmedFrom < 0 || trimmedTo < 0) return null
  const resolvedTo = trimmedTo + 1
  return { from: trimmedFrom, to: resolvedTo, text: rangeText(doc, trimmedFrom, resolvedTo) }
}

/** 「段尾」：区间最后一个字所在文字块的末尾，✓ ✕ 跟在这里。 */
export function paragraphEnd(doc: ProseMirrorNode, to: number): number {
  const $to = doc.resolve(Math.min(to, doc.content.size))
  return $to.parent.isTextblock ? $to.end() : to
}

// —— 事务 ——————————————————————————————————————————————————————————————————————

export function openRewriteTransaction(state: EditorState, session: RewriteSession): Transaction {
  return state.tr.setMeta(rewriteSessionKey, { type: 'open', session } satisfies RewriteMeta)
}

export function patchRewriteTransaction(
  state: EditorState,
  id: number,
  patch: Extract<RewriteMeta, { type: 'patch' }>['patch'],
): Transaction {
  return state.tr.setMeta(rewriteSessionKey, { type: 'patch', id, patch } satisfies RewriteMeta)
}

export function closeRewriteTransaction(state: EditorState): Transaction {
  return state.tr.setMeta(rewriteSessionKey, { type: 'close' } satisfies RewriteMeta)
}

/**
 * 接受 = 一笔事务：换掉区间 + 关会话。只在「结果已出、原文一字未动」时给事务，否则 null（什么都不写）。
 * 一笔事务 = 撤销栈里一条，Ctrl+Z 回到改写前。
 */
function acceptRewriteTransaction(state: EditorState): Transaction | null {
  const session = getRewriteSession(state)
  if (!session || session.status !== 'result' || !session.result) return null
  if (session.documentId !== getRewriteDocumentId(state)) return null
  if (rangeText(state.doc, session.from, session.to) !== session.original) return null
  const { from, to, result } = session
  const tr = state.tr
  const $from = state.doc.resolve(from)
  const $to = state.doc.resolve(to)
  if ($from.sameParent($to) && $from.parent.isTextblock && !result.includes('\n')) {
    tr.replaceWith(from, to, state.schema.text(result, $from.marks()))
  } else {
    const paragraph = state.schema.nodes.paragraph
    if (!paragraph) return null
    const blocks = result
      .split(/\n+/)
      .filter((line) => line.length > 0)
      .map((line) => paragraph.create(null, state.schema.text(line)))
    if (blocks.length === 0) return null
    tr.replace(from, to, new Slice(Fragment.from(blocks), 1, 1))
  }
  const end = Math.min(tr.mapping.map(to, 1), tr.doc.content.size)
  tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1))
  return tr.setMeta(rewriteSessionKey, { type: 'close' } satisfies RewriteMeta)
}

/**
 * 接受的唯一落地入口（控制器、段尾 ✓、键盘 Enter 都走它）：这一笔自己成一个撤销步，
 * 之后紧接着的输入也不并进它——编辑器历史默认把 500ms 内相邻的事务合成一组，不隔开的话 Ctrl+Z 会连前面刚打的字一起撤。
 */
export function acceptRewrite(target: { readonly state: EditorState; dispatch(transaction: Transaction): void }): boolean {
  const tr = acceptRewriteTransaction(target.state)
  if (!tr) return false
  target.dispatch(closeHistory(tr))
  target.dispatch(closeHistory(target.state.tr))
  return true
}

// —— 画 —————————————————————————————————————————————————————————————————————————

const PENDING_CLASS = 'nomi-ai-rewrite-pending rounded-nomi-sm bg-workbench-accent-soft'
const DEL_CLASS = 'nomi-ai-rewrite-del rounded-nomi-sm bg-workbench-danger-soft text-workbench-danger-ink line-through decoration-1'
const ADD_CLASS = 'nomi-ai-rewrite-add whitespace-pre-wrap rounded-nomi-sm bg-workbench-success-soft text-workbench-success-ink underline decoration-1 underline-offset-[3px]'
const ACTION_GROUP_CLASS = 'nomi-ai-rewrite-actions relative ml-2 inline-flex select-none gap-0.5 align-middle'
const ACTION_BUTTON_CLASS = 'group/btn relative inline-flex size-6 cursor-pointer items-center justify-center rounded-full border border-workbench-border bg-workbench-surface p-0 text-workbench-muted shadow-workbench-pop hover:text-workbench-ink'
const TIP_CLASS = 'pointer-events-none absolute left-0 top-[30px] z-30 hidden whitespace-nowrap rounded-nomi-sm bg-workbench-ink px-2 text-caption text-workbench-surface group-hover/btn:block'

export const REWRITE_LABELS_DEFAULT = { accept: 'Accept', discard: 'Discard', acceptHint: 'Accept Enter', discardHint: 'Discard Esc' }
export type RewriteLabels = typeof REWRITE_LABELS_DEFAULT

let labelProvider: () => RewriteLabels = () => REWRITE_LABELS_DEFAULT

/** 浮在文档里的 ✓ ✕ 是裸 DOM，文案由界面层（i18n）在挂载时接进来；不接就用英文兜底。 */
export function setRewriteLabelProvider(provider: () => RewriteLabels): void {
  labelProvider = provider
}

// 文档里的 ✓ ✕ 是 ProseMirror 的裸 DOM 小部件，进不了 React 树：这里画的是 Tabler 的 check / x 两条路径
// （和界面其它地方用的 IconCheck / IconX 同一套几何，14px / 2.2）。
const ICON_PATHS = { check: ['M5 12l5 5l10 -10'], x: ['M18 6l-12 12', 'M6 6l12 12'] } as const

function iconElement(kind: 'check' | 'x'): SVGElement {
  const namespace = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(namespace, 'svg')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2.2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  for (const d of ICON_PATHS[kind]) {
    const path = document.createElementNS(namespace, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}

function actionButton(options: { icon: 'check' | 'x'; label: string; hint: string; className?: string; onPress: () => void }): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `${ACTION_BUTTON_CLASS} ${options.className ?? ''}`
  button.setAttribute('aria-label', options.label)
  button.setAttribute('data-rewrite-action', options.icon === 'check' ? 'accept' : 'discard')
  button.append(iconElement(options.icon))
  const tip = document.createElement('span')
  tip.className = TIP_CLASS
  tip.textContent = options.hint
  button.append(tip)
  // 编辑器要保住焦点和选区：按下时不让按钮抢焦点。
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', (event) => {
    event.preventDefault()
    options.onPress()
  })
  return button
}

function actionsWidget(view: EditorView): HTMLElement {
  const labels = labelProvider()
  const group = document.createElement('span')
  group.className = ACTION_GROUP_CLASS
  group.contentEditable = 'false'
  group.setAttribute('role', 'group')
  group.append(
    actionButton({
      icon: 'check',
      label: labels.accept,
      hint: labels.acceptHint,
      className: 'text-workbench-success-ink',
      onPress: () => {
        acceptRewrite(view)
      },
    }),
    actionButton({
      icon: 'x',
      label: labels.discard,
      hint: labels.discardHint,
      onPress: () => view.dispatch(closeRewriteTransaction(view.state)),
    }),
  )
  return group
}

function addedWidget(text: string): () => HTMLElement {
  return () => {
    const span = document.createElement('span')
    span.className = ADD_CLASS
    span.setAttribute('data-rewrite-add', 'true')
    span.textContent = text
    return span
  }
}

/**
 * AI 编辑条的落脚处：一个跟在这一段后面的块级空位。条本身是 React 组件（AiRewriteBar），用 portal 挂进这个空位——
 * 它是文档流里的一块，下面的段落自然被它推开，不需要算坐标、不会盖住后面的字。
 */
export const REWRITE_SLOT_ATTRIBUTE = 'data-rewrite-slot'

function slotWidget(id: number): () => HTMLElement {
  return () => {
    const slot = document.createElement('div')
    slot.setAttribute(REWRITE_SLOT_ATTRIBUTE, String(id))
    slot.contentEditable = 'false'
    slot.className = 'workbench-ai-rewrite-slot my-1.5 max-w-[520px]'
    return slot
  }
}

/** 纯函数：文档 + 会话 → 装饰。单测不需要 DOM，渲染时才真的造节点。 */
export function buildRewriteDecorations(doc: ProseMirrorNode, session: RewriteSession): DecorationSet {
  const slot = Decoration.widget(doc.resolve(session.to).after(), slotWidget(session.id), {
    side: 1,
    key: `rewrite-slot-${session.id}`,
    ignoreSelection: true,
    stopEvent: () => true,
  })
  if (session.status !== 'result' || session.result === null) {
    return DecorationSet.create(doc, [Decoration.inline(session.from, session.to, { class: PENDING_CLASS }), slot])
  }
  const { positions } = readRange(doc, session.from, session.to)
  const decorations: Decoration[] = [slot]
  let cursor = 0
  const anchorAt = (offset: number): number => {
    const before = positions[offset - 1]
    if (offset > 0 && before !== undefined && before >= 0) return before + 1
    const here = positions[offset]
    if (here !== undefined && here >= 0) return here
    return session.from
  }
  diffRewrite(session.original, session.result).forEach((part, index) => {
    if (part.kind === 'add') {
      decorations.push(Decoration.widget(anchorAt(cursor), addedWidget(part.text), { side: 1, key: `rewrite-add-${session.id}-${index}`, ignoreSelection: true }))
      return
    }
    if (part.kind === 'del') {
      let runStart = -1
      let runEnd = -1
      const flush = () => {
        if (runStart >= 0) decorations.push(Decoration.inline(runStart, runEnd, { class: DEL_CLASS }))
        runStart = -1
      }
      for (let offset = cursor; offset < cursor + part.text.length; offset += 1) {
        const position = positions[offset]
        if (position === undefined || position < 0) { flush(); continue }
        if (runStart >= 0 && position === runEnd) runEnd = position + 1
        else { flush(); runStart = position; runEnd = position + 1 }
      }
      flush()
    }
    cursor += part.text.length
  })
  decorations.push(
    Decoration.widget(paragraphEnd(doc, session.to), actionsWidget, {
      side: 2,
      key: `rewrite-actions-${session.id}`,
      ignoreSelection: true,
      stopEvent: () => true,
    }),
  )
  return DecorationSet.create(doc, decorations)
}

// —— 插件 ———————————————————————————————————————————————————————————————————————

function selectionInside(state: EditorState, session: RewriteSession, upTo: number): boolean {
  const { from, to } = state.selection
  return from >= session.from && to <= upTo
}

/**
 * AI 编辑条何时把焦点收到输入框：
 * - 刚打开菜单（`menu`）时一定收，方便直接输要求或按 Esc；
 * - 后续状态变化（`running` → `result` / `failed`）时，只有焦点本就在改写条里（或落回 `body`），
 *   或焦点在编辑器里且选区仍停在待改区间内，才把焦点放回输入框；
 *   若用户等待期间已去别的段落打字，或点去了别处的输入控件，绝不抢走焦点。
 */
export function shouldAutoFocusRewriteInput(input: {
  state: EditorState
  session: RewriteSession
  editorFocused: boolean
  barContainsFocus: boolean
  bodyOrNullFocused: boolean
}): boolean {
  if (input.session.status === 'menu') return true
  if (input.barContainsFocus || input.bodyOrNullFocused) return true
  if (input.editorFocused) return selectionInside(input.state, input.session, input.session.to)
  return false
}

export function createRewritePlugin(): Plugin<RewritePluginState> {
  const initial: RewritePluginState = { documentId: null, session: null }
  return new Plugin<RewritePluginState>({
    key: rewriteSessionKey,
    state: {
      init: () => initial,
      apply(tr, state, _old, next) {
        const meta = tr.getMeta(rewriteSessionKey) as RewriteMeta | undefined
        const withSession = (session: RewriteSession | null): RewritePluginState => (session === state.session ? state : { documentId: state.documentId, session })
        if (meta?.type === 'document') {
          if (meta.id === state.documentId) return state
          // 换了文稿：旧文稿的会话作废。
          return { documentId: meta.id, session: state.session && state.session.documentId === meta.id ? state.session : null }
        }
        if (meta?.type === 'open') return withSession(meta.session)
        if (meta?.type === 'close') return withSession(null)
        const previous = state.session
        if (!previous) return state
        if (meta?.type === 'patch') return withSession(meta.id === previous.id ? { ...previous, ...meta.patch } : previous)
        let current = previous
        if (tr.docChanged) {
          const from = tr.mapping.map(previous.from, 1)
          const to = tr.mapping.map(previous.to, -1)
          // 原文被改过 / 被删了 = 这一版结果已经不是针对眼前这段字的，丢掉，不去猜。
          if (from >= to || rangeText(tr.doc, from, to) !== previous.original) return withSession(null)
          if (from !== previous.from || to !== previous.to) current = { ...previous, from, to }
        }
        // 菜单 / 失败态：还没开始改（或已报错），用户点去别处 = 收起条。进行中和结果已出都不因移开光标被掐断或丢掉。
        if (tr.selectionSet && (current.status === 'menu' || current.status === 'failed')) {
          const { from, to } = next.selection
          if (from < current.from || to > current.to) return withSession(null)
        }
        return withSession(current)
      },
    },
    props: {
      decorations(state) {
        const session = getRewriteSession(state)
        return session ? buildRewriteDecorations(state.doc, session) : DecorationSet.empty
      },
      handleKeyDown(view, event) {
        const session = getRewriteSession(view.state)
        if (!session || event.isComposing) return false
        if (event.key === 'Escape') {
          view.dispatch(closeRewriteTransaction(view.state))
          return true
        }
        if (!selectionInside(view.state, session, paragraphEnd(view.state.doc, session.to))) return false
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && session.status === 'result') {
          return acceptRewrite(view)
        }
        return false
      },
    },
  })
}

/** 创作编辑器专用（画布文字节点不挂）：见 `RICH_TEXT_FEATURE_EXTENSIONS`。 */
export const AiRewriteExtension = Extension.create({
  name: 'aiRewrite',
  addProseMirrorPlugins() {
    return [createRewritePlugin()]
  },
})
