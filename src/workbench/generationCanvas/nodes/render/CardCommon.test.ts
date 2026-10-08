import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { PendingGenerationPlaceholder } from './CardCommon'
vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t: (key: string) => key }) }))

const node = (kind: GenerationCanvasNode['kind']): GenerationCanvasNode => ({ id: kind, kind, title: kind, position: { x: 0, y: 0 }, categoryId: 'shots', prompt: 'PRIVATE FULL PROMPT', meta: {} })
const html = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(PendingGenerationPlaceholder, props as never))

describe('pending media action', () => {
  it.each(['image', 'video', 'model3d'] as const)('%s does not duplicate author content', (kind) => {
    expect(html({ node: node(kind), selected: true })).not.toContain('PRIVATE FULL PROMPT')
  })

  // 2026-10-08 拍板 ③：「试试」替换那一句操作说明（不叠加）——旧说明键不再出现。
  it.each(['image', 'video'] as const)('an empty %s card shows 「试试」 instead of the instruction sentence', (kind) => {
    const out = html({ node: node(kind), selected: false })
    expect(out).toContain(`data-node-try="${kind}"`)
    expect(out).toContain(`nodeTry.${kind}.`)
    expect(out).not.toContain(`nodeEmpty.${kind}.description`)
    expect(out).not.toContain(`nodeEmpty.${kind}.title`)
  })

  it('3D model cards have no recipes yet and keep their sentence', () => {
    expect(html({ node: node('model3d'), selected: false })).toContain('nodeEmpty.model3d.description')
  })

  it('a card waiting for its upstream still says so (state, not instructions)', () => {
    expect(html({ node: node('video'), selected: true, waitingUpstream: true })).toContain('nodeEmpty.waiting')
  })

  it('派生出来、提示词已填好的节点：中间写「提示词已填好」；没这个标记的空节点显示「试试」', () => {
    const ready = html({ node: node('image'), selected: false, derivedReady: true })
    expect(ready).toContain('nodeEmpty.derivedReady.title')
    expect(ready).toContain('nodeEmpty.derivedReady.description')
    expect(ready).not.toContain('data-node-try')
    const plain = html({ node: node('image'), selected: false })
    expect(plain).toContain('data-node-try="image"')
    expect(plain).not.toContain('derivedReady')
  })
})

// 用户 10-08：「节点上那个什么试试以及那个大 icon 设计有点丑，可以优化一下吗，排版都不对齐」。
// 空节点只对齐一条轴（居中）：小号弱色线性图标（不加实心圆底）、动作是一排居中的胶囊按钮、不再有孤零零的「试试」小字、没有斜线底纹。
describe('empty node layout: one centered axis', () => {
  it.each(['image', 'video'] as const)('%s: line icon without a solid disc, centered chip row, no orphan label', (kind) => {
    const out = html({ node: node(kind), selected: false })
    expect(out).not.toContain('bg-nomi-ink text-nomi-paper')
    expect(out).not.toContain('rounded-full')
    expect(out).not.toContain('text-left')
    expect(out).toContain('justify-center')
    expect(out).toContain('flex-wrap')
    expect(out).not.toContain('text-micro text-nomi-ink-40')
    expect(out).not.toMatch(/<span[^>]*>nodeTry\.label<\/span>/)
  })

  it('no striped hatch under an empty card (design-system empty surface instead)', async () => {
    const { previewBackgroundClass } = await import('./previewBackground')
    expect(String(previewBackgroundClass(false, false))).not.toContain('repeating-linear-gradient')
  })
})
