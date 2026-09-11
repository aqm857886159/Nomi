/**
 * [INPUT]: 依赖 electron/shared/contracts/directorMobileBridge 的 MobileBridgeStatus / MobileBridgeEvent / MobileBridgeFeedback
 * [OUTPUT]: 对外提供 DesktopDirectorBridge（出片 framesToVideo + 手机虚拟相机 mobile 起停 / 状态 / 事件）、DesktopDirectorMobileStatus、DesktopDirectorMobileEvent
 * [POS]: desktop 桥的导演台分片：DesktopBridge.director 的类型住这里，bridge.ts 只 re-export（与 projectAgentBridgeTypes / onboardingBridgeTypes 同一拆法，防 bridge.ts 巨壳）；
 *        开发页 / 老 preload 没有这座桥 → 对话框明说需要桌面运行时。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { MobileBridgeEvent, MobileBridgeStatus, MobileBridgeFeedback } from '../../electron/shared/contracts/directorMobileBridge'

export type DesktopDirectorMobileStatus = MobileBridgeStatus
export type DesktopDirectorMobileEvent = MobileBridgeEvent

/** 导演台出片 + 手机虚拟相机。 */
export type DesktopDirectorBridge = {
  /** 出片：N 帧 PNG dataURL → ffmpeg 拼 mp4 落项目素材（主进程 electron/video/framesToVideo.ts）。 */
  framesToVideo: (payload: {
    projectId: string
    ownerNodeId: string
    fileName: string
    fps: number
    frames: string[]
  }) => Promise<{ url: string; assetId?: string }>
  mobile: {
    feedback: (payload: MobileBridgeFeedback) => Promise<boolean>
    /** consent: true = 用户刚在同意卡上点了「允许开启」；不带它时主进程只回状态、不开监听。 */
    start: (payload?: { text?: Record<string, string>; consent?: boolean }) => Promise<DesktopDirectorMobileStatus>
    stop: () => Promise<DesktopDirectorMobileStatus>
    status: () => Promise<DesktopDirectorMobileStatus>
    onEvent: (callback: (event: DesktopDirectorMobileEvent) => void) => () => void
  }
}
