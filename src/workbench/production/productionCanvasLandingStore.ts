import { declareStoreLifetime } from '../project/storeLifetime'
// P4 S5 — 制作 Run 在渲染层的只读投影缓存（画布上**每一个**落了节点的 Run 各一份）。
// 真相源仍是主进程的 Run；这里喂「排队中 / 已停」两块制作专属小标、返工/续拍入口，以及对话流里付费卡的收据（指着交出去的那几镜）。
//
// 「生成中 / 结果 / 失败」**不从这里读**：主进程的画布落地投影把它们写进节点自己的运行记录
// （materialize-shots），与普通生成同一份状态（2026-09-25，见 ProductionShotPlaceholder 头注释）。
//
// 以前这里只存「画布上第一个 Run」：画布上有两次 Agent 生成时，第二次的节点永远读不到自己的 Run。
import { create } from 'zustand'

import type { ProductionRun } from '../../../electron/shared/contracts/productionRunTypes'
import type { PendingSpendRead } from '../../desktop/productionRunBridgeTypes'
import { offerShots } from '../../../electron/shared/productionGenerationPresentation'

type LandingStore = {
  projectId: string | null
  /** runId → 该 Run 的快照。画布上有节点的每一份 Run 都在（节点都出了结果也在）；不会再变的那几份留着上一次读到的（host 的 `landingRunsToRefresh`）。 */
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

// ── 缓存怎么续（host 每一拍、每一次推送用；纯函数，可裸测） ─────────────────────────────────────────────

function isTerminal(run: ProductionRun): boolean {
  return run.status === 'completed' || run.status === 'cancelled'
}

/** 这一次出价里还有镜在交给画布（交接结局还会变：交到了 / 没发出去要写回来）。 */
function handOverInFlight(run: ProductionRun): boolean {
  return offerShots(run).some((shot) => shot.state === 'handing_over')
}

/**
 * 这一拍要重读哪几份 Run（tick 与测试共用）。画布上有节点的**每一份** Run 都留在缓存里——收据要一直指着那几镜：
 * 节点都出了结果也一样，重启后也要读回来（以前只留「节点没结果」的那几份，三镜都出结果的那一刻收据整块消失）。
 * 只有这几种要再读：还没读过的；节点还要小标的（没结果 / 失败）；出价里还有镜在交的。已经终结的读到过一次就不再读；
 * 读过、主进程说没有这一份（`absent`）的，节点不要小标就不再问。
 * 其余留着上一拍那一份——一个做过几十次 Agent 生成的项目，不会每 1.5 秒把几十份 run.json 读一遍。
 */
export function landingRunsToRefresh(
  onCanvas: ReadonlySet<string>,
  needBadges: ReadonlySet<string>,
  cached: Readonly<Record<string, ProductionRun>>,
  absent: ReadonlySet<string> = new Set(),
): string[] {
  return [...onCanvas].filter((runId) => {
    const run = cached[runId]
    if (!run) return !absent.has(runId) || needBadges.has(runId)
    if (isTerminal(run)) return false
    return needBadges.has(runId) || handOverInFlight(run)
  })
}

/**
 * 对话投影推来的待决出价里，这个项目的那几笔：runId → 卡此刻的样子（身份 + 每一镜走到哪一步）。
 * 卡上的指向元素和画布小标读的是落地缓存，卡本身读的是这份推送——两边差一拍时，刚出来的卡说「还没生成」，一会儿才改口「等你确认」。
 */
export function pendingOfferSignatures(spend: PendingSpendRead | undefined, projectId: string): ReadonlyMap<string, string> {
  const rows = spend?.surface === 'ready' ? spend.rows : spend?.surface === 'unreadable' && spend.card ? [spend.card] : []
  return new Map(rows.filter((row) => row.projectId === projectId)
    .map((row) => [row.runId, `${row.quoteId}|${row.shots.map((shot) => `${shot.shotId}=${shot.offer}`).join(',')}`]))
}

/** 两份推送之间出价变了的那几份 Run：新出的卡、卡上有一镜走了一步、卡关了（上一份有、这一份没有）。 */
export function changedOfferRuns(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter((runId) => before.get(runId) !== after.get(runId))
}
