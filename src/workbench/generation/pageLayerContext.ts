/**
 * [INPUT]: 依赖 react、zustand、project/storeLifetime；GenerationWorkspace 传入画布节点 store 观察删除
 * [OUTPUT]: 对外提供页格层挂载上下文，以及按租户和节点 id 保存的打开状态与项目生命周期
 * [POS]: 生成页「页内全屏层」的唯一状态归属。节点会被画布裁剪或重挂，打开状态不能归节点组件。
 *        没有 Provider（设计实验室、单测）时 host 为空、active 恒真：GenerationPageLayer 什么也不挂，调用方在实验室里自己摆格子。
 *        合同与归属见 pageLayer.tsx 的头部与 docs/engineering/concept-owners/ui.generation-page-layer.json。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { create } from 'zustand'
import { declareStoreLifetime } from '../project/storeLifetime'

export type PageLayerTenant = 'director' | 'panorama'
type OpenTenants = Record<string, Partial<Record<PageLayerTenant, true>>>

export const useGenerationPageLayerTenants = create<{
  open: OpenTenants
  setOpen: (tenant: PageLayerTenant, nodeId: string, open: boolean) => void
  retainNodes: (nodeIds: ReadonlySet<string>) => void
}>((set) => ({
  open: {},
  setOpen: (tenant, nodeId, open) => set((state) => {
    const current = state.open[nodeId]
    if (Boolean(current?.[tenant]) === open) return state
    const next = { ...state.open }
    const tenants = { ...current }
    if (open) tenants[tenant] = true
    else delete tenants[tenant]
    if (Object.keys(tenants).length) next[nodeId] = tenants
    else delete next[nodeId]
    return { open: next }
  }),
  retainNodes: (nodeIds) => set((state) => {
    const entries = Object.entries(state.open).filter(([id]) => nodeIds.has(id))
    return entries.length === Object.keys(state.open).length ? state : { open: Object.fromEntries(entries) }
  }),
}))

export const generationPageLayerTenantsLifetime = declareStoreLifetime({
  store: 'useGenerationPageLayerTenants', fields: { open: 'project' },
  releaseProject: () => useGenerationPageLayerTenants.setState({ open: {} }),
})

export function useGenerationPageLayerTenantOpen(tenant: PageLayerTenant, nodeId: string): boolean {
  const snapshot = () => Boolean(useGenerationPageLayerTenants.getState().open[nodeId]?.[tenant])
  return React.useSyncExternalStore(useGenerationPageLayerTenants.subscribe, snapshot, snapshot)
}

export function setGenerationPageLayerTenantOpen(tenant: PageLayerTenant, nodeId: string, open: boolean): void {
  useGenerationPageLayerTenants.getState().setOpen(tenant, nodeId, open)
}

/** 画布节点列表是删除事实；组件卸载不是。只在真删除或项目释放时丢掉租户状态。 */
export function observeGenerationPageLayerNodes<T extends { nodes: readonly { id: string }[] }>(source: {
  getState: () => T
  subscribe: (listener: (state: T, previous: T) => void) => () => void
}): () => void {
  const retain = (nodes: readonly { id: string }[]) => useGenerationPageLayerTenants.getState().retainNodes(new Set(nodes.map((node) => node.id)))
  retain(source.getState().nodes)
  return source.subscribe((state, previous) => {
    if (state.nodes !== previous.nodes) retain(state.nodes)
  })
}

export type GenerationPageLayerState = {
  /** 页格元素（生成页「画布那一格」）；还没挂上 = null。 */
  host: HTMLElement | null
  /** 这一格此刻看得见：生成页是当前页 && 画布视图（列表视图开着时画布那一格是被藏起来的）。 */
  active: boolean
}

const GenerationPageLayerContext = React.createContext<GenerationPageLayerState>({ host: null, active: true })

/** 只有 GenerationWorkspace 提供：host 是它的画布格，active 是它算出来的「这一格看不看得见」。 */
export function GenerationPageLayerProvider({ value, children }: { value: GenerationPageLayerState; children: React.ReactNode }): React.ReactElement {
  return React.createElement(GenerationPageLayerContext.Provider, { value }, children)
}

/** 挂载点与可见性的整份状态（GenerationPageLayer 用；别处要的只是 active，用下面那个）。 */
export function useGenerationPageLayerState(): GenerationPageLayerState {
  return React.useContext(GenerationPageLayerContext)
}

/**
 * 这一格此刻看不看得见。藏着（切走生成页 / 列表视图）时，层里的人要停三件事：
 * ① 挂在 window 上的键盘监听（Esc 与快捷键不许吞掉别的页的键）；② 3D 渲染循环；③ 整个 App 级的暗色锁。
 */
export function useGenerationPageLayerActive(): boolean {
  return React.useContext(GenerationPageLayerContext).active
}
