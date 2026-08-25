/**
 * 取「这个节点当前选中的模型，在它所接的那条渠道上，实际会发出去的请求体」。
 *
 * 为什么节点需要它：UI 的模式/槽由**模型档案**声明（供应商无关），真正发得出什么由**渠道 mapping**
 * 决定。两者此前只在「点生成那一刻」才对账，于是用户连好参考、切到「全能参考」、点生成才被拒
 * （docs/plan/2026-08-02-reference-unification-and-channel-honesty）。拿到 body 后节点就能提前说实话。
 *
 * 拿不到就返回 null——调用方一律按「不收窄」处理。**宁可少说，也绝不因为查不到就把用户的槽藏掉。**
 */
import React from 'react'
import { getDesktopBridge } from '../../../../desktop/bridge'
import { selectTaskMapping, type Mapping } from '../../../../../electron/catalog/types'

/** 目录变更广播（OnboardingDrawer.refresh 发的同一个信号）——接入/停用模型后立刻重算承载力。 */
const CATALOG_CHANGED_EVENT = 'nomi-model-catalog-changed'

async function readCreateBody(vendorKey: string, modelKey: string, taskKind: string): Promise<unknown | null> {
  if (!vendorKey || !taskKind) return null
  try {
    // D2 读路径是 ipcRenderer.invoke，返回 Promise；必须 await 后才能按数组选择 mapping。
    const list = await getDesktopBridge()?.modelCatalog?.listMappings?.({ vendorKey })
    if (!Array.isArray(list)) return null
    // selectTaskMapping = 主进程选 mapping 的那把尺子本尊（精确 modelKey 优先、再回落无 modelKey 的通配），
    // 直接复用而不是在这儿重写一遍——重写就会有「UI 看 A、生成走 B」的第二种漂移。
    const mapping = selectTaskMapping(list as Mapping[], vendorKey, taskKind as Mapping['taskKind'], modelKey)
    return mapping?.create?.body ?? null
  } catch {
    return null
  }
}

export function useChannelCreateBody(vendorKey: string, modelKey: string, taskKind: string): unknown | null {
  const [body, setBody] = React.useState<unknown | null>(null)

  React.useEffect(() => {
    let alive = true
    const recompute = async () => {
      const next = await readCreateBody(vendorKey, modelKey, taskKind)
      if (alive) setBody(next)
    }
    void recompute() // 模型/模式切换即重算
    window.addEventListener(CATALOG_CHANGED_EVENT, recompute)
    return () => {
      alive = false
      window.removeEventListener(CATALOG_CHANGED_EVENT, recompute)
    }
  }, [vendorKey, modelKey, taskKind])

  return body
}
