// 导演台手机虚拟相机桥的跨进程契约（零 Node 实现）：主进程服务、preload、渲染层 bridge 共用这一份。
// 包是 8 个 Float32；设备态只有 connected / disconnected（hello / close），延迟由 ping/pong 填。

export type MobileBridgeDevice = { id: string; name: string; latencyMs: number | null; connectedAt: number }

export const MOBILE_PREVIEW_MAX_BYTES = 1024 * 1024
export type MobileBridgeFeedback = { recording: boolean; frame?: Uint8Array }

export type MobileBridgeEvent =
  | { type: 'packet'; deviceId: string; values: number[]; at: number }
  | { type: 'device'; deviceId: string; name: string; state: 'connected' | 'disconnected'; latencyMs: number | null }
  | { type: 'record'; deviceId: string; action: 'start' | 'stop' }

export type MobileBridgeStatus = {
  running: boolean
  secure: boolean
  port: number | null
  urls: string[]
  devices: MobileBridgeDevice[]
  // 主进程用 qrcode 生成的 SVG（渲染层不 import 该 CJS 包，Vite ESM 没有 default/named export）
  qrByUrl?: Record<string, string>
}
