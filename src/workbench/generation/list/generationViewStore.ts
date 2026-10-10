// 生成页「画布 | 列表」的视图状态。只管「现在看哪一个视图、大详情开着哪一张」——
// 不存任何镜头 / 节点数据（那归画布 store，列表是投影，见 generationListModel.ts）。
// 不进项目文件：重开项目回到画布，与画布视口一样是会话态。
import { create } from 'zustand'
import { declareStoreLifetime } from '../../project/storeLifetime'

export type GenerationView = 'canvas' | 'list'

type GenerationViewState = {
  view: GenerationView
  /** 大详情开着的那张卡（节点 id）；null = 列表网格。 */
  inspectorKey: string | null
  setView: (view: GenerationView) => void
  setInspectorKey: (key: string | null) => void
}

const INITIAL = { view: 'canvas' as GenerationView, inspectorKey: null as string | null }

export const useGenerationViewStore = create<GenerationViewState>()((set) => ({
  view: INITIAL.view,
  inspectorKey: INITIAL.inspectorKey,
  setView: (view) => set({ view }),
  setInspectorKey: (inspectorKey) => set({ inspectorKey }),
}))

export const generationViewStoreLifetime = declareStoreLifetime({
  store: 'useGenerationViewStore',
  fields: { view: 'project', inspectorKey: 'project' },
  releaseProject: () => useGenerationViewStore.setState(INITIAL),
})
