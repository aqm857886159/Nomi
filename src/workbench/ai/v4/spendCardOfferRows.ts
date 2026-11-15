// 付费确认拆开之后（2026-11-15，设计卡 docs/plan/2026-11-15-spend-ask-split.md），这一次出价的那一组镜头住在对话里、
// 挂在 Agent 那一条生成记录下面；确认条（输入框上方）只剩共同参数 + 两颗按钮。两处读的是同一份投影（`projectSpendCard`）：
// 确认条体（`AgentPanelV4SpendCardBody`）拿到投影后把行数据放进这里，对话里那一组（`GenerationReceiptPointers`）按出价号读出来。
//
// 为什么是一只每面板一份的小 store、而不是从面板外壳往下传：外壳只把确认条体当一整块塞进介入槽（它不认识行），
// 而那一组要画在对话流里另一个位置；同一份事实不在两处各算一遍，也不为它改外壳。每面板一份（context 给），
// 两个面板（主窗 / 弹出窗）各说各的那一笔，不串。
import React from 'react'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { NodePointerSubject } from '../pointer/nodePointerModel'
import type { SpendCardPointer } from './agentPanelSpendCard'

export type SpendOfferRows = Readonly<{
  /** 这一次出价的号：对话里那一条生成记录带着同一个号（`receipt.generation.operationId`）。 */
  operationId: string
  pointers: readonly SpendCardPointer[]
  /** 一下动作在路上：行尾「不生成 ×」/「恢复」置灰。 */
  busy: boolean
  onExclude: (shotId: string) => void
  onRestore: (shotId: string) => void
}>

type SpendOfferRowsState = Readonly<{ offer: SpendOfferRows | null }>

export type SpendOfferRowsStore = StoreApi<SpendOfferRowsState>

export function createSpendOfferRowsStore(): SpendOfferRowsStore {
  return createStore<SpendOfferRowsState>()(() => ({ offer: null }))
}

/** 面板给；缺席（确认条体单独画在实验室里、没有对话流）= 不放、读到的永远是空。 */
export const SpendOfferRowsContext = React.createContext<SpendOfferRowsStore | null>(null)

const EMPTY_STORE = createSpendOfferRowsStore()

/** 确认条体挂着时把这一次出价的行放进去，换了 / 卸了就拿掉（只拿掉自己放的那一份）。 */
export function usePublishSpendOfferRows(offer: SpendOfferRows): void {
  const store = React.useContext(SpendOfferRowsContext)
  React.useLayoutEffect(() => {
    if (!store) return undefined
    store.setState({ offer })
    return () => {
      if (store.getState().offer === offer) store.setState({ offer: null })
    }
  }, [store, offer])
}

/** 对话里那一组读：这一次出价此刻的行（`operationId` 不给 = 此刻挂着的那一笔，不管号）。 */
export function useSpendOfferRows(operationId?: string): SpendOfferRows | null {
  const store = React.useContext(SpendOfferRowsContext) ?? EMPTY_STORE
  return useStore(store, (state) => (state.offer && (operationId === undefined || state.offer.operationId === operationId) ? state.offer : null))
}

/** 一行要指的那个节点（还没落到画布上的那一镜 nodeId 是空串：指向元素画中性占位、不可点）。 */
export function spendOfferSubject(pointer: SpendCardPointer): NodePointerSubject {
  return {
    nodeId: pointer.nodeId,
    fallbackLabel: { shot: pointer.shotRef },
    removed: pointer.removed,
    ...(pointer.hostFailure ? { hostFailure: pointer.hostFailure } : {}),
    ...(pointer.hostStatus ? { hostStatus: pointer.hostStatus } : {}),
    ...(pointer.outcome ? { outcome: pointer.outcome } : {}),
    ...(pointer.note ? { note: pointer.note } : {}),
  }
}
