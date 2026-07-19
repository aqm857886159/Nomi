import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import AssetMentionChip from './AssetMentionChip'

// @ 内联引用 chip 的 Tiptap 节点(规范 §4):inline atom —— 句中一个 18px 缩略图,整体一个原子
// (Backspace 一次删整块、不可从中间断开)。**用现有 @tiptap/core + react,无新依赖**(避开 mention/suggestion 的版本冲突)。
// 持久化:序列化成 promptMentions 的 @[asset:url] 标记(见 PromptEditor)；url 持久化，index 只做实时「图片N」展示。
// nodeview 组件拆到 AssetMentionChip.tsx,本文件只导出 Node(非组件)。

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    assetMention: {
      insertAssetMention: (url: string, index?: number) => ReturnType
    }
  }
}

export const AssetMention = Node.create({
  name: 'assetMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      url: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-url') || '',
        renderHTML: (attributes) => ({ 'data-url': attributes.url as string }),
      },
      // 仅用于 UI 显示「图片N」，持久化仍只认 url；编号始终由当前有序参考图列表实时投影。
      index: {
        default: null,
        parseHTML: (element) => {
          const value = Number(element.getAttribute('data-index'))
          return Number.isInteger(value) && value > 0 ? value : null
        },
        renderHTML: (attributes) => (
          Number.isInteger(attributes.index) && Number(attributes.index) > 0
            ? { 'data-index': String(attributes.index) }
            : {}
        ),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-asset-mention]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-asset-mention': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AssetMentionChip)
  },

  addCommands() {
    return {
      insertAssetMention: (url: string, index?: number) => ({ chain }) =>
        chain().focus().insertContent({ type: this.name, attrs: { url, index: index ?? null } }).run(),
    }
  },
})
