import React from 'react'
import type { Editor, JSONContent } from '@tiptap/react'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { ControlledEditorSync } from './controlledEditorSync'

/**
 * 受控编辑器「实例被重建」时的唯一生命周期（与 createControlledEditorSync 的账同属一处）。
 *
 * 为什么有这一处：编辑器实例会在 owner 值没变的情况下被重建——React `<Activity>` 把创作区藏起来再放出来、
 * placeholder 之类的 deps 变化，都会让 TipTap 用「创建那一刻的选项」重新造一个编辑器。新实例的文档
 * 不一定等于 owner 当前的值（分镜提示词：首次挂载时是空的，后来才写了字），而账上 current 早已等于 value，
 * 后续的 `receive(value)` 一律判成回声、不写——框就这样空着（落盘里字还在）。两套编辑器内核
 * （PromptEditor、useNomiRichTextEditor）曾各写各的：一个重开了账、一个没有。
 *
 * 契约：`editor` 一换（含首次挂载）——
 *   1. 有 `hydrate` 的内核先让新文档等于 owner 当前的值（hydrate 自己负责不进撤销历史、不回写 owner）；
 *   2. 账按新文档的实际内容重开（reset）。
 * 用 layout effect：新实例的第一次绘制之前文档就已就位，不会闪一帧空框；也先于宿主的 onReady 等普通 effect。
 */
export function useEditorRebuildSync(
  editor: Editor | null,
  sync: ControlledEditorSync,
  options: { serialize: (editor: Editor) => string; hydrate?: (editor: Editor) => void },
): void {
  const optionsRef = React.useRef(options)
  optionsRef.current = options
  React.useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return
    optionsRef.current.hydrate?.(editor)
    sync.reset(optionsRef.current.serialize(editor))
  }, [editor, sync])
}

/**
 * 灌入用的事务：整篇文档换成 `doc`，不进撤销历史、不发 update（preventUpdate）——这是把 owner 的值灌给新实例，
 * 不是用户又改了一次，所以既不能多出一步「撤销回空」，也不许回写 owner。
 */
export function replaceDocWithoutHistory(state: EditorState, doc: JSONContent): Transaction {
  return state.tr.replaceWith(0, state.doc.content.size, state.schema.nodeFromJSON(doc).content)
    .setMeta('addToHistory', false)
    .setMeta('preventUpdate', true)
}

/** 灌入的判与写：新实例的文档（按 serialize 读成串）与 owner 当前的值不是同一句才写；写了返回 true。 */
export function hydrateIfStale(
  editor: { state: EditorState; view: { dispatch(tr: Transaction): void }; getJSON(): JSONContent },
  wanted: { text: string; doc: () => JSONContent },
  serialize: (doc: JSONContent) => string,
): boolean {
  if (serialize(editor.getJSON()) === wanted.text) return false
  editor.view.dispatch(replaceDocWithoutHistory(editor.state, wanted.doc()))
  return true
}
