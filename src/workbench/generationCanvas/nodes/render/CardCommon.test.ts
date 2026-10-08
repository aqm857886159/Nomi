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
