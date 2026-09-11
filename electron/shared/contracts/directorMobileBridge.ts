// 导演台手机虚拟相机桥的跨进程契约（零 Node 实现）：主进程服务、preload、渲染层 bridge 共用这一份。
// 包是 8 个 Float32；设备态只有 connected / disconnected（hello / close），延迟由 ping/pong 填。
// 安全面（2026-09-11，docs/plan/2026-09-11-director-lan-pairing-hardening.md）：
// 同意闸（没同意不 bind）、配对码一次性 + 有时效、自签证书指纹随状态出、入站帧上限。

export type MobileBridgeDevice = { id: string; name: string; latencyMs: number | null; connectedAt: number }

export const MOBILE_PREVIEW_MAX_BYTES = 1024 * 1024
/** 入站帧上限（ws 的 maxPayload）：控制帧是几十字节的 JSON，位姿包正好 32 字节，4 KiB 已经宽绰得离谱。 */
export const MOBILE_CONTROL_MAX_BYTES = 4 * 1024
/** 配对码有效期：够走完「扫码 → 点过证书警告 → 页面连上」，不够别人事后拿截图来连。 */
export const MOBILE_PAIRING_TTL_MS = 2 * 60 * 1000
export type MobileBridgeFeedback = { recording: boolean; frame?: Uint8Array }

export type MobileBridgeEvent =
  | { type: 'packet'; deviceId: string; values: number[]; at: number }
  | { type: 'device'; deviceId: string; name: string; state: 'connected' | 'disconnected'; latencyMs: number | null }
  | { type: 'record'; deviceId: string; action: 'start' | 'stop' }
  // 配对码换了（被用掉或过期）：桌面端据此重新取状态、重画二维码
  | { type: 'pairing'; at: number; expiresAt: number }

export type MobileBridgeStatus = {
  running: boolean
  secure: boolean
  port: number | null
  urls: string[]
  devices: MobileBridgeDevice[]
  /** true = 还没拿到本次 App 运行的用户同意，服务一个端口都没开。渲染层据此出同意卡而不是二维码。 */
  consentRequired: boolean
  /** 自签证书的 SHA-256 指纹（冒号分组大写）；非 TLS 的单测模式为 null。 */
  certFingerprint: string | null
  /** 当前配对码的失效时刻（epoch ms）；没在跑时为 null。 */
  pairingExpiresAt: number | null
  // 主进程用 qrcode 生成的 SVG（渲染层不 import 该 CJS 包，Vite ESM 没有 default/named export）
  qrByUrl?: Record<string, string>
}
