import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import ArtifactBody from './ArtifactBody'
import { canArtifactCopyText } from '../../model/artifactMeta'
import type { AgentArtifactMeta } from '../../model/artifactMeta'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'

// 真实产物落地契约测试（component-level, server-render）：
// 不依赖 Electron / 浏览器 / 沙箱环境，毫秒级、CI 稳定。
// 走查用脚本在 tests/ux/agent-artifact.walk.mjs（P1 · deliver_craft 落盘 + Nomi 主窗引导跳过路径修复后启用）。
//
// 注意：Model3DViewer 是 R3F 组件，server-render 会抛；这里只断言非 3D 子视图，glb 走 GUI 走查。

const makeNode = (id: string): GenerationCanvasNode => ({
  id,
  kind: 'agent-artifact',
  title: 'Test',
  categoryId: 'shots',
  position: { x: 0, y: 0 },
  meta: {},
})

const baseProps = (artifact: AgentArtifactMeta) => ({
  node: makeNode('test'),
  artifact,
  width: 320,
  height: 240,
})

describe('ArtifactBody · 真实产物渲染契约', () => {
  it('SVG：内嵌 <img> 指向 nomi-local 资产 URL', () => {
    const html = renderToStaticMarkup(
      React.createElement(ArtifactBody, baseProps({
        fileType: 'svg',
        url: 'nomi-local://asset/p/assets/generated/composition-guide.svg',
      })),
    )
    expect(html).toContain('nomi-local://asset/p/assets/generated/composition-guide.svg')
    expect(html).toContain('<img')
  })

  it('HTML：渲染沙箱 iframe，sandbox="allow-scripts"，不跨 same-origin（不可被宿主读）', () => {
    const html = renderToStaticMarkup(
      React.createElement(ArtifactBody, baseProps({
        fileType: 'html',
        url: 'nomi-local://asset/p/assets/generated/opening-beats.html',
      })),
    )
    expect(html).toContain('<iframe')
    expect(html).toContain('sandbox="allow-scripts"')
    // 关键：未给 allow-same-origin 是隔离的关键证据。脚本断言：字符串必须仅含 allow-scripts、不含 allow-same-origin。
    expect(html).not.toMatch(/sandbox="allow-scripts[^"]*allow-same-origin/)
    expect(html).not.toContain('allow-same-origin')
  })

  it('Markdown：server-render 阶段渲染 wrapper（fetch 在 effect；浏览器层校验文本容器由 GUI 走查覆盖）', () => {
    const html = renderToStaticMarkup(
      React.createElement(ArtifactBody, baseProps({
        fileType: 'markdown',
        url: 'nomi-local://asset/p/assets/generated/notes.md',
      })),
    )
    expect(html.length).toBeGreaterThan(0)
  })

  it('Table：产物 wrapper 渲染（fetch 在 effect；表格结构浏览器层校验）', () => {
    const html = renderToStaticMarkup(
      React.createElement(ArtifactBody, baseProps({
        fileType: 'table',
        url: 'nomi-local://asset/p/assets/generated/storyboard.md',
      })),
    )
    expect(html.length).toBeGreaterThan(0)
  })

  it('Text：等宽容器 wrapper 渲染', () => {
    const html = renderToStaticMarkup(
      React.createElement(ArtifactBody, baseProps({
        fileType: 'text',
        url: 'nomi-local://asset/p/assets/generated/script.txt',
      })),
    )
    expect(html.length).toBeGreaterThan(0)
  })
})

describe('canArtifactCopyText · 浮条「复制」按钮可见性谓词', () => {
  it('text / markdown / html 可复制；svg / table / glb 不可复制', () => {
    expect(canArtifactCopyText('text')).toBe(true)
    expect(canArtifactCopyText('markdown')).toBe(true)
    expect(canArtifactCopyText('html')).toBe(true)
    expect(canArtifactCopyText('svg')).toBe(false)
    expect(canArtifactCopyText('table')).toBe(false)
    expect(canArtifactCopyText('glb')).toBe(false)
  })
})