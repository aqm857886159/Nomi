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

// 用户 10-08：「节点上那个什么试试以及那个大 icon 设计有点丑…排版都不对齐」→ Claude Design 拍板稿 EmptyStates：
// 去斜线底纹；图标深色放 36px 浅灰圆底；类型名加粗、状态小字；「试试」是纯文字按钮用「·」隔开、不套胶囊框；内容从同一高度往下排。
describe('empty node layout (Claude Design EmptyStates)', () => {
  it.each(['image', 'video'] as const)('%s: icon disc, bold kind name, status line, plain-text actions joined by dots', (kind) => {
    const out = html({ node: node(kind), selected: false })
    expect(out).not.toContain('bg-nomi-ink text-nomi-paper')
    expect(out).toContain('size-9')
    expect(out).toContain('bg-nomi-ink-05')
    expect(out).toContain(`canvas.nodeKinds.${kind}`)
    expect(out).toContain(`nodeTry.status.${kind}`)
    // 2026-10-10 用户拍板 B：块顶由卡高定（视觉中心 45%，离顶 ≥44），不再顶对齐。
    expect(out).toContain('data-empty-tier="full"')
    expect(out).not.toContain('justify-center py')
    expect(out).toContain('>·<')
    // 动作行永远单行（结构上不许折行：nowrap；文案按最小节点宽度写短，走查量每种节点两种语言下都是单行）。
    expect(out).toContain('flex-nowrap')
    expect(out).not.toContain('flex-wrap')
    // 不套胶囊框：动作按钮没有边框 / 圆角胶囊 / 底色，悬停才出浅底。
    expect(out).not.toContain('rounded-full bg-nomi-paper')
    expect(out).not.toContain('border-nomi-line')
    expect(out).toContain('hover:bg-nomi-ink-05')
    expect(out).not.toContain('>generationCommon.nodeTry.label<')
  })

  it('no striped hatch under an empty card', async () => {
    const { previewBackgroundClass } = await import('./previewBackground')
    expect(String(previewBackgroundClass(false, false))).not.toContain('repeating-linear-gradient')
  })
})

// 2026-10-10 独立验收（V-ratio）：档位必须和渲染用的是同一个有效高度。
// 240×103 的空卡实际渲染高度被钳到 MIN_NODE_HEIGHT=120，应按 120 判「紧凑」，不能按存的 103 判「只留第一行」。
describe('empty state tier uses the rendered (clamped) height', () => {
  it('240×103 空图片节点：按有效高度 120 判紧凑', () => {
    const small = { ...node('image'), size: { width: 240, height: 103 } } as GenerationCanvasNode
    expect(html({ node: small, selected: false })).toContain('data-empty-tier="compact"')
  })
})
