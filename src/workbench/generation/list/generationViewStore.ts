// 生成页「画布 | 列表」的视图状态。只管「现在看哪一个视图、列表筛到哪份分镜、检查器开着哪一张」——
// 不存任何镜头 / 节点数据（那归画布 store 与分镜方案，列表是投影，见 generationListModel.ts）。
// 不进项目文件：重开项目回到画布，与画布视口一样是会话态。
import { create } from 'zustand'
import { declareStoreLifetime } from '../../project/storeLifetime'

export type GenerationView = 'canvas' | 'list'

/** 列表筛到哪一份分镜方案（创作页「分镜方案」点进来）。null = 全部节点。 */
export type GenerationListFilter = { documentId: string; designId: string } | null

type GenerationViewState = {
  view: GenerationView
  listFilter: GenerationListFilter
  /** 检查器开着的那一张卡的 key（节点 id，或还没落画布的方案镜 `plan:<designId>:<shotId>`）。 */
  inspectorKey: string | null
  setView: (view: GenerationView) => void
  /** 列表筛到一份分镜并切到列表（创作页「分镜方案」的唯一入口）。 */
  openListFiltered: (filter: NonNullable<GenerationListFilter>) => void
  clearListFilter: () => void
  /** 切到列表并打开这一张（画布节点「在列表里看」）。 */
  openListAt: (key: string) => void
  setInspectorKey: (key: string | null) => void
}

const INITIAL = { view: 'canvas' as GenerationView, listFilter: null as GenerationListFilter, inspectorKey: null as string | null }

export const useGenerationViewStore = create<GenerationViewState>()((set) => ({
  view: INITIAL.view,
  listFilter: INITIAL.listFilter,
  inspectorKey: INITIAL.inspectorKey,
  setView: (view) => set({ view }),
  openListFiltered: (listFilter) => set({ view: 'list', listFilter, inspectorKey: null }),
  clearListFilter: () => set({ listFilter: null }),
  openListAt: (key) => set({ view: 'list', listFilter: null, inspectorKey: key }),
  setInspectorKey: (inspectorKey) => set({ inspectorKey }),
}))

export const generationViewStoreLifetime = declareStoreLifetime({
  store: 'useGenerationViewStore',
  fields: { view: 'project', listFilter: 'project', inspectorKey: 'project' },
  releaseProject: () => useGenerationViewStore.setState(INITIAL),
})
