import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import AssetMentionSuggestionList, { type MentionSuggestionItem, type MentionSuggestionListRef } from './AssetMentionSuggestionList'

// 打 @ 唤起 suggestion(规范 §4 快捷路径)。候选 = 当前 node 的 referenceImageUrls(单源,由 getCandidates 注入,
// 与发送投影同一数组——对抗评审 must-fix:候选源 ≠ referenceImageUrls 会让 chip 发送时被静默删成空串)。
// 下拉用 ReactRenderer 渲染到 body(逃 composer overflow 裁剪)+ 向上翻转 + 视口 clamp(规范 §5 / 本会话遮挡教训)。
// 选中 → 删掉 @ 触发段 + 插入 assetMention chip(复用 insertAssetMention 命令,原始 url 不做规范化)。

const MARGIN = 8
const GAP = 4

function positionPopup(el: HTMLElement, rect: DOMRect | null): void {
  if (!rect) return
  const h = el.offsetHeight || 44
  const w = el.offsetWidth || 200
  let top = rect.bottom + GAP
  if (top + h > window.innerHeight - MARGIN) top = Math.max(MARGIN, rect.top - GAP - h)
  let left = rect.left
  if (left + w > window.innerWidth - MARGIN) left = window.innerWidth - MARGIN - w
  left = Math.max(MARGIN, left)
  el.style.top = `${top}px`
  el.style.left = `${left}px`
}

export function createAssetMentionSuggestion(options: { getCandidates: () => string[] }): Extension {
  return Extension.create({
    name: 'assetMentionSuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: '@',
          allowSpaces: false,
          startOfLine: false,
          // 候选 = 当前 image 参考(query 不用来过滤——参考是图、无人名可搜;打 @ 即可视选)。
          items: (): MentionSuggestionItem[] => options.getCandidates().map((url, index) => ({ url, index })),
          command: ({ editor, range, props }) => {
            const item = props as MentionSuggestionItem
            editor.chain().focus().deleteRange(range).insertAssetMention(item.url, item.index + 1).run()
          },
          render: () => {
            let renderer: ReactRenderer<MentionSuggestionListRef> | null = null
            let el: HTMLElement | null = null
            return {
              onStart: (props) => {
                renderer = new ReactRenderer(AssetMentionSuggestionList, { props, editor: props.editor })
                el = document.createElement('div')
                el.style.position = 'fixed'
                el.style.zIndex = '60'
                document.body.appendChild(el)
                el.appendChild(renderer.element)
                positionPopup(el, props.clientRect?.() ?? null)
              },
              onUpdate: (props) => {
                renderer?.updateProps(props)
                if (el) positionPopup(el, props.clientRect?.() ?? null)
              },
              onKeyDown: (props) => {
                if (props.event.key === 'Escape') return true
                return renderer?.ref?.onKeyDown({ event: props.event }) ?? false
              },
              onExit: () => {
                el?.remove()
                el = null
                renderer?.destroy()
                renderer = null
              },
            }
          },
        }),
      ]
    },
  })
}
