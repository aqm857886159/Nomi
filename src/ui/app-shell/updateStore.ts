// 更新状态在渲染层的唯一落点：一次订阅主进程（快照 + 事件），顶栏胶囊、弹窗、项目库横幅、
// 「已更新」卡、设置→关于都读它。弹窗开关也放这里——胶囊、横幅、关于页都能点开同一个弹窗。
// 真相源在主进程（electron/update/updateHub.ts），这里不推断、不自己维护第二份状态机。
import { create } from 'zustand'
import { isDialogPhase } from './updateDialogView'
import { getDesktopBridge } from '../../desktop/bridge'
import {
  reduceUpdaterState,
  UPDATER_INITIAL_STATE,
  type UpdateEvent,
  type UpdateReminderMemory,
  type UpdateSnapshot,
  type UpdaterState,
} from '../../../electron/shared/updateReminder'

export type UpdateStoreState = {
  updater: UpdaterState
  memory: UpdateReminderMemory
  dialogOpen: boolean
  /** Mac：点「去下载新版」后弹窗停在第二屏显示三步。 */
  macStepsShown: boolean
}

const EMPTY_MEMORY: UpdateReminderMemory = { dismissedBanners: [], updatedCard: null }

export const useUpdateStore = create<UpdateStoreState>(() => ({
  updater: UPDATER_INITIAL_STATE,
  memory: EMPTY_MEMORY,
  dialogOpen: false,
  macStepsShown: false,
}))

export type UpdateSyncBridge = {
  snapshot: () => Promise<UpdateSnapshot>
  onEvent: (callback: (event: UpdateEvent) => void) => () => void
}

let subscribers = 0
let stopSync: (() => void) | null = null

/** 订阅主进程：先挂事件再取快照；快照取回来时若已经收到过事件，事件更新，只采纳快照里的提醒记忆。 */
export function startUpdateSync(bridge: UpdateSyncBridge): () => void {
  let alive = true
  let eventSeen = false
  const off = bridge.onEvent((event) => {
    eventSeen = true
    useUpdateStore.setState((prev) => {
      const updater = reduceUpdaterState(prev.updater, event)
      // 检查开始 / 已是最新这类状态没有可看的详情：把还开着的旧弹窗收掉，别留一个过期弹窗。
      const stale = !isDialogPhase(updater.phase, updater.errorStage)
      return { updater, dialogOpen: stale ? false : prev.dialogOpen, macStepsShown: stale ? false : prev.macStepsShown }
    })
  })
  void bridge.snapshot().then((snapshot) => {
    if (!alive) return
    useUpdateStore.setState((prev) => ({ updater: eventSeen ? prev.updater : snapshot.state, memory: snapshot.memory }))
  }).catch(() => undefined)
  return () => {
    alive = false
    off()
  }
}

/** 多个组件同时用 useUpdater 也只订阅一次（引用计数）。 */
export function retainUpdateSync(bridge: UpdateSyncBridge | undefined): () => void {
  if (!bridge) return () => undefined
  if (subscribers === 0) stopSync = startUpdateSync(bridge)
  subscribers += 1
  return () => {
    subscribers -= 1
    if (subscribers === 0) {
      stopSync?.()
      stopSync = null
    }
  }
}

export function openUpdateDialog(): void {
  useUpdateStore.setState({ dialogOpen: true })
}

export function closeUpdateDialog(): void {
  useUpdateStore.setState({ dialogOpen: false, macStepsShown: false })
}

/** 只给测试用：回到出厂状态。 */
export function resetUpdateStoreForTests(): void {
  stopSync?.()
  stopSync = null
  subscribers = 0
  useUpdateStore.setState({ updater: UPDATER_INITIAL_STATE, memory: EMPTY_MEMORY, dialogOpen: false, macStepsShown: false })
}

/** ✕ 热修横幅：先在本地立刻收起，再让主进程记住（一次性，之后不再出）。 */
export function dismissHotfixBanner(version: string): void {
  useUpdateStore.setState((prev) => ({ memory: { ...prev.memory, dismissedBanners: [...prev.memory.dismissedBanners, version] } }))
  void getDesktopBridge()?.update?.dismiss({ kind: 'banner', version }).catch(() => undefined)
}

/** ✕ 「已更新」卡。 */
export function dismissUpdatedCard(): void {
  useUpdateStore.setState((prev) => ({ memory: { ...prev.memory, updatedCard: null } }))
  void getDesktopBridge()?.update?.dismiss({ kind: 'updated-card' }).catch(() => undefined)
}
