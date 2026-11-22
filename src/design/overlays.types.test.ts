import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { DesignModalProps } from './overlays'

// 类型层的反例由 `pnpm run typecheck`（check:test-types 收 src 测试文件）判：@ts-expect-error 那行要是不报错，类型检查当场红。
const onClose = (): void => undefined

// 对话框的名字只收一句字符串：图标、副标、封面、链接塞进 title（JSX）在类型上就过不去。
// @ts-expect-error title 是 string
const jsxTitle: DesignModalProps = { opened: true, onClose, title: createElement('span', null, '名字') }

// 名字以外的头部内容走插槽：外壳把名字元素交给插槽，插槽把它和副标摆在一起。
const slotted: DesignModalProps = { opened: true, onClose, title: '名字', header: (title) => createElement('span', null, title, '副标') }

// 外壳上的 data-* 锚点只认冻结名单里的；新锚点挂不上去（找弹窗用角色 + 名字，或 testId）。
// @ts-expect-error 名单外的锚点
const strayAnchor: DesignModalProps = { opened: true, onClose, title: '名字', frozenAnchors: { 'data-new-anchor': 'x' } }

describe('DesignModal 的标题与锚点类型', () => {
  it('三份样例都只在类型层起作用（运行时只是普通对象）', () => {
    expect([jsxTitle, slotted, strayAnchor].map((props) => typeof props.onClose)).toEqual(['function', 'function', 'function'])
  })
})
