import { declareStoreLifetime } from '../project/storeLifetime'
// P4 S5 — 制作 Run 在渲染层的只读投影缓存（画布上**每一个**落了节点的 Run 各一份）。
// 真相源仍是主进程的 Run；这里只喂「排队中 / 已停」两块制作专属小标与返工/续拍入口。
//
// 「生成中 / 结果 / 失败」**不从这里读**：主进程的画布落地投影把它们写进节点自己的运行记录
// （materialize-shots），与普通生成同一份状态（2026-09-25，见 ProductionShotPlaceholder 头注释）。
//
// 以前这里只存「画布上第一个 Run」：画布上有两次 Agent 生成时，第二次的节点永远读不到自己的 Run。
import { create } from 'zustand'

import type { ProductionRun } from '../../../electron/productionRun/productionRunTypes'

type LandingStore = {
  projectId: string | null
  /** runId → 该 Run 的最新快照。只含画布上有节点的 Run。 */
  runs: Readonly<Record<string, ProductionRun>>
  /** E2E 专用：钉住注入的 Run，让 host 的 poll 不覆盖（零额度走查构造各态并存的批次验占位）。生产恒 false。 */
  pinnedForE2E: boolean
  setRuns: (projectId: string, runs: Readonly<Record<string, ProductionRun>>) => void
  reset: () => void
}

const EMPTY_RUNS: Readonly<Record<string, ProductionRun>> = Object.freeze({})

/** 占位小标读它。只读投影缓存——写入只来自 host 的 poll（pinnedForE2E 时除外）。 */
export const useProductionCanvasLandingStore = create<LandingStore>()((set, get) => ({
  projectId: null,
  runs: EMPTY_RUNS,
  pinnedForE2E: false,
  // pin 住时 poll 的 setRuns 是 no-op（走查注入的 Run 说了算）；生产从不 pin。
  setRuns: (projectId, runs) => { if (!get().pinnedForE2E) set({ projectId, runs }) },
  reset: () => { if (!get().pinnedForE2E) set({ projectId: null, runs: EMPTY_RUNS }) },
}))

/**
 * C1 寿命声明：这个 store 的第一个字段就叫 `projectId`——它自己写着它归项目管。
 * `pinnedForE2E` 是走查夹具的钉子，同样只对当前项目成立。
 */
export const productionCanvasLandingStoreLifetime = declareStoreLifetime({
  store: 'useProductionCanvasLandingStore',
  fields: { projectId: 'project', runs: 'project', pinnedForE2E: 'project' },
  releaseProject: () => useProductionCanvasLandingStore.getState().reset(),
})
