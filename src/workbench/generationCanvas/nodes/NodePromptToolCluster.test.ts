import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IconVideo } from '@tabler/icons-react'
import { NodePromptToolButton, NodePromptToolCluster } from './NodePromptToolCluster'

// 底栏 B 簇（v1.1，2026-09-11 拍板）的三条形制承诺，写成结构断言：
// ① 纯 icon——一个字都不渲染（名字退到 hover）；
// ② 走设计系统已有的小号档 size="sm"（28px），不新造尺寸；
// ③ 带状态的那颗（运镜）选过才点亮，没选过不点亮——「选没选过」是这一颗唯一的可见状态。
// 尺寸的**真实高度**由走查量 getBoundingClientRect（写着 sm 却被外层拉高，只有量得出来），
// 这里守的是「class 有没有从 sm 漂成 md」这一半。

const render = (element: React.ReactElement): string => renderToStaticMarkup(element)

const cluster = (children: React.ReactNode): React.ReactElement =>
  React.createElement(NodePromptToolCluster, { ariaLabel: '写提示词' }, children)

const tool = (props: Record<string, unknown>): React.ReactElement =>
  React.createElement(NodePromptToolButton, {
    toolId: 'camera-move',
    icon: React.createElement(IconVideo, { size: 16, stroke: 2 }),
    label: '推近 · 中',
    ...props,
  })

describe('NodePromptToolCluster', () => {
  it('是一个有名字的分组，走查按 data-prompt-tool-cluster 找它', () => {
    const html = render(cluster(tool({})))
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="写提示词"')
    expect(html).toContain('data-prompt-tool-cluster="true"')
    // 段序锚点：底栏断言「模型/参数 → B 簇 → ×N → 生成」靠它。
    expect(html).toContain('data-bar-segment="prompt-tools"')
  })

  it('纯 icon：按钮里一个字都不渲染，名字只挂在 aria-label 上', () => {
    const html = render(cluster(tool({})))
    expect(html).toContain('aria-label="推近 · 中"')
    // 去掉所有标签后不该剩下可见文字（tooltip 走 Portal，不在这棵树里）。
    expect(html.replace(/<[^>]*>/g, '').trim()).toBe('')
  })

  it('原生 title 被压掉，免得和 Radix 气泡叠两层', () => {
    expect(render(cluster(tool({})))).toContain('title=""')
  })

  it('尺寸取设计系统小号档 size="sm"（28px = size-7），不是默认 md', () => {
    const html = render(cluster(tool({})))
    expect(html).toContain('size-7')
    expect(html).not.toContain('size-8')
  })

  it('运镜选过才点亮激活点', () => {
    expect(render(cluster(tool({ active: true })))).toContain('data-prompt-tool-active="true"')
    expect(render(cluster(tool({})))).not.toContain('data-prompt-tool-active')
  })

  it('禁用时说清为什么点不了（§1.6 C1：禁用的 button 自己不触发 title，得靠外层包一层）', () => {
    const html = render(cluster(tool({ disabled: true, disabledReason: '已锁定：AI 不能修改此节点 — 点击解锁' })))
    expect(html).toContain('title="已锁定：AI 不能修改此节点 — 点击解锁"')
    expect(html).toContain('disabled=""')
  })
})
