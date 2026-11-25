// 对话里那一组（2026-11-15 付费确认拆开）：出价开着时就是要确认的那一批，一行一个、行尾挂「不生成 ×」/「恢复」；
// 同一次生成只有一组（出价那一刻和发完之后是同一个位置的同一个组件）；对话里找不到那条生成记录时画在对话最后。
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./revealNodeFromChat', () => ({ revealNodeFromChat: vi.fn(), returnToChat: vi.fn() }))

import i18n from '../../../i18n'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { createReactTestRenderer } from '../v4/testReactRenderer'
import { createSpendOfferRowsStore, SpendOfferRowsContext, type SpendOfferRows } from '../v4/spendCardOfferRows'
import { GenerationReceiptPointers, SpendOfferRowsWithoutRecord } from './GenerationReceiptPointers'

type Host = { type: string; props: Record<string, unknown> }

const video = (id: string): GenerationCanvasNode => ({
  id, kind: 'video', title: `shot-${id}`, prompt: '', categoryId: 'shots', position: { x: 0, y: 0 }, status: 'idle',
  meta: { modelKey: 'seedance-2', modelVendor: 'apimart', aspect_ratio: '16:9', duration: 4 },
} as GenerationCanvasNode)

const offer = (count: number, patch: Partial<SpendOfferRows> = {}): SpendOfferRows => ({
  operationId: 'op-1',
  pointers: Array.from({ length: count }, (_, index) => ({
    shotId: `s${index}`, nodeId: `n${index}`, shotRef: `镜 ${index + 1}`, removed: false,
    exclusion: index === 1 ? 'restore' as const : 'exclude' as const,
  })),
  busy: false,
  onExclude: vi.fn(),
  onRestore: vi.fn(),
  ...patch,
})

function mount(element: React.ReactElement, value: SpendOfferRows | null) {
  const store = createSpendOfferRowsStore()
  store.setState({ offer: value })
  const hosts: Host[] = []
  const renderer = createReactTestRenderer<Host>({ createInstance: (type, props) => { const host = { type, props }; hosts.push(host); return host } })
  renderer.render(<SpendOfferRowsContext.Provider value={store}>{element}</SpendOfferRowsContext.Provider>)
  renderer.flushPassiveEffects()
  const live = () => hosts.filter((host) => host.props['data-v4-block'] === 'generation-receipt-pointers')
  return { renderer, hosts, live, store }
}

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: Array.from({ length: 12 }, (_, index) => video(`n${index}`)), edges: [], groups: [] }, 'project-receipt')
})
afterEach(() => vi.clearAllMocks())

describe('GenerationReceiptPointers · the shots of one generation live in the chat', () => {
  it('offer open: one row per shot, first four shown, no receipt line yet; × and 恢复 sit beside the rows', () => {
    const { renderer, hosts, live } = mount(<GenerationReceiptPointers operationId="op-1" />, offer(12))
    try {
      expect(live()).toHaveLength(1)
      expect(live()[0]!.props['data-offer-open']).toBe('true')
      const rows = hosts.filter((host) => host.type === 'button' && host.props['data-node-pointer'] === 'row')
      expect(rows).toHaveLength(4)
      expect(hosts.some((host) => host.props['data-node-pointer-more'] === 8)).toBe(true)
      expect(hosts.some((host) => host.props['data-v4-block'] === 'generation-receipt-line')).toBe(false)
      expect(hosts.filter((host) => host.props['data-spend-exclusion'] === 'exclude')).toHaveLength(3)
      expect(hosts.filter((host) => host.props['data-spend-exclusion'] === 'restore')).toHaveLength(1)
    } finally {
      renderer.close()
    }
  })

  it('the row × and 恢复 call the host with that shot', () => {
    const value = offer(3)
    const { renderer, hosts } = mount(<GenerationReceiptPointers operationId="op-1" />, value)
    try {
      const exclude = hosts.find((host) => host.props['data-spend-exclusion'] === 'exclude')!
      ;(exclude.props.onClick as () => void)()
      expect(value.onExclude).toHaveBeenCalledWith('s0')
      const restore = hosts.find((host) => host.props['data-spend-exclusion'] === 'restore')!
      ;(restore.props.onClick as () => void)()
      expect(value.onRestore).toHaveBeenCalledWith('s1')
    } finally {
      renderer.close()
    }
  })

  it('another generation’s record does not pick up this offer', () => {
    const { renderer, live } = mount(<GenerationReceiptPointers operationId="op-other" />, offer(3))
    try {
      expect(live()).toHaveLength(0)
    } finally {
      renderer.close()
    }
  })

  it('an offer whose record is not in the chat is drawn once at the end; one that has its record is not drawn twice', () => {
    const orphan = mount(<SpendOfferRowsWithoutRecord recorded={new Set()} />, offer(3))
    try {
      expect(orphan.live()).toHaveLength(1)
    } finally {
      orphan.renderer.close()
    }
    const recorded = mount(
      <>
        <GenerationReceiptPointers operationId="op-1" />
        <SpendOfferRowsWithoutRecord recorded={new Set(['op-1'])} />
      </>,
      offer(3),
    )
    try {
      expect(recorded.live()).toHaveLength(1)
    } finally {
      recorded.renderer.close()
    }
  })
})
