import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { FloatingToolbarShell, ToolbarDuplicateVariantButton } from './NodeFloatingToolbar'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: () => '复制为新变体' }),
}))

describe('ToolbarDuplicateVariantButton', () => {
  it('exposes the shared duplicate-as-variant action as one toolbar button', () => {
    const html = renderToStaticMarkup(React.createElement(ToolbarDuplicateVariantButton, { nodeId: 'shot-1' }))
    expect(html).toContain('<button')
    expect(html).toContain('aria-label="复制为新变体"')
    expect(html).toContain('title="复制为新变体"')
    expect(html.match(/<button/g)).toHaveLength(1)
  })
})

// 锁的家（2026-09-11 v1.1 拍板）：从生成浮框底栏搬回节点浮条。搬进**外壳**而不是逐条浮条各挂一份，
// 是因为浮条有六条（图片编辑 / 视频抽帧 / 全景 / 下载 / 空节点变体 / 手艺产物）——挂六份就是六个
// 并行版，下一条浮条忘了挂就静默少一把锁。`lockNodeId` 因此是**必填**：`null` 是显式的一档
// （手艺产物浮条挂的不是可锁的生成节点），忘了传是编译错（R28 让编译器拦，别留给走查）。
//
// 这里只断结构（挂没挂、在不在最左、null 时挂不挂）。**锁开/关那两种外观断不了**：
// 锁态由 NodeLockBadge 自己从 store 读，而 renderToStaticMarkup 走的是 zustand 的
// getServerSnapshot（恒等于初始 state），怎么 setState 都渲不出「已锁」——那种绿是假的。
// 已锁形态归真机走查（tests/ux/node-composer-placement.walk.mjs 量 [data-node-lock] 在哪）。
describe('FloatingToolbarShell 的锁', () => {
  it('给了 nodeId 就在浮条最左渲出锁，并用分隔线和后面的动作族分开', () => {
    const html = renderToStaticMarkup(React.createElement(FloatingToolbarShell, {
      ariaLabel: '节点动作',
      lockNodeId: 'shot-1',
      children: React.createElement(ToolbarDuplicateVariantButton, { nodeId: 'shot-1' }),
    }))
    expect(html).toContain('data-node-lock=')
    expect(html.match(/data-node-lock=/g)).toHaveLength(1)
    // 锁在最左：它出现在第一颗动作按钮（复制变体）之前，中间隔着一根 ToolbarDivider。
    expect(html.indexOf('data-node-lock=')).toBeLessThan(html.indexOf('tabler-icon-copy'))
    expect(html.indexOf('w-px h-5 bg-nomi-line')).toBeGreaterThan(html.indexOf('data-node-lock='))
  })

  it('lockNodeId=null 的浮条一把锁都不挂（手艺产物那一条）', () => {
    const html = renderToStaticMarkup(React.createElement(FloatingToolbarShell, {
      ariaLabel: '产物动作',
      lockNodeId: null,
      children: React.createElement(ToolbarDuplicateVariantButton, { nodeId: 'shot-1' }),
    }))
    expect(html).not.toContain('data-node-lock')
  })
})
