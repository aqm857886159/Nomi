import { create } from 'zustand'
import { getDesktopBridge } from '../../../desktop/bridge'
import type { AssetLocalizationEvent } from '../../../desktop/bridge'

/**
 * 导入中节点的进度真相（渲染侧）。
 *
 * 为什么单独一份而不是塞进节点 meta：拷 1.38GB 会连发上百条，写进画布 store 就是上百次持久化 +
 * 全画布重渲染。这里只活在内存、只被那张卡订阅，导入结束即清。
 *
 * `previewUrl` 是主进程在**拷贝开始前**从源文件派生的那一帧（图片缩 1024 / 视频抽首帧），
 * 拷完它会被认领成这份素材的正式画布预览——所以渐显完就是真预览，不再切一次图。
 */
export type AssetImportProgress = {
  copiedBytes: number
  totalBytes: number
  previewUrl?: string
}

type AssetImportProgressState = {
  byNode: Record<string, AssetImportProgress>
  /** 已经收尾的节点：预览是和拷贝并行派生的，可能在收尾之后才到，不能让它复活一条死进度。 */
  settled: Record<string, true>
  report: (nodeId: string, progress: AssetImportProgress) => void
  clear: (nodeId: string) => void
}

export const useAssetImportProgressStore = create<AssetImportProgressState>((set) => ({
  byNode: {},
  settled: {},
  report: (nodeId, progress) => set((state) => {
    // copiedBytes === 0 是一次新导入的开场白（含「重试导入」），它把上一轮的收尾标记抹掉。
    if (progress.copiedBytes === 0) {
      const settled = { ...state.settled }
      delete settled[nodeId]
      return { settled, byNode: { ...state.byNode, [nodeId]: progress } }
    }
    if (state.settled[nodeId]) return state
    const previous = state.byNode[nodeId]
    // 进度只许涨：乱序到达的旧字节数不该把已经长出来的马赛克缩回去。
    if (previous && previous.copiedBytes > progress.copiedBytes) {
      return { byNode: { ...state.byNode, [nodeId]: { ...progress, copiedBytes: previous.copiedBytes, previewUrl: progress.previewUrl ?? previous.previewUrl } } }
    }
    return { byNode: { ...state.byNode, [nodeId]: { ...progress, previewUrl: progress.previewUrl ?? previous?.previewUrl } } }
  }),
  clear: (nodeId) => set((state) => {
    const byNode = { ...state.byNode }
    delete byNode[nodeId]
    return { byNode, settled: { ...state.settled, [nodeId]: true } }
  }),
}))

/** 导入进度比例（0..1）。总字节还不知道时算 0：一个格子都不显，而不是假装满了。 */
export function importRevealRatio(progress: AssetImportProgress | undefined): number {
  if (!progress || !(progress.totalBytes > 0)) return 0
  return Math.max(0, Math.min(1, progress.copiedBytes / progress.totalBytes))
}

let detach: (() => void) | undefined

/** 幂等：导入路径启动时接上主进程的拷贝进度广播（生成本地化那种不带 bytes 的事件不归这里管）。 */
export function ensureAssetImportProgressBridge(): void {
  if (detach) return
  const subscribe = getDesktopBridge()?.assets?.onLocalizationStarted
  if (!subscribe) return
  detach = subscribe((event: AssetLocalizationEvent) => {
    if (typeof event?.totalBytes !== 'number' || typeof event?.copiedBytes !== 'number') return
    useAssetImportProgressStore.getState().report(event.nodeId, {
      copiedBytes: event.copiedBytes,
      totalBytes: event.totalBytes,
      ...(event.previewUrl ? { previewUrl: event.previewUrl } : {}),
    })
  })
}

export function __detachAssetImportProgressBridgeForTests(): void {
  detach?.()
  detach = undefined
  useAssetImportProgressStore.setState({ byNode: {}, settled: {} })
}
