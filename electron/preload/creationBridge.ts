/**
 * 创作侧（导演台 / 提示词库 / 审片 / 生成策略 / 即梦）的 preload 桥面。
 *
 * 从 electron/preload.ts 抽出来（R9：preload.ts 顶着 800 行硬上限，每加一条桥都在撞线）。
 * 这里**只搬家、不改行为**：每个键、每条频道名、每句注释都逐字保留，preload.ts 用 `...creationBridge` 组装，暴露给渲染层的对象形状逐字节不变。
 */
import { ipcRenderer } from "electron";
import type { MobileBridgeFeedback } from '../shared/contracts/directorMobileBridge';

export const creationBridge = {
  director: {
    // 导演台出片：N 帧 PNG dataURL → ffmpeg 拼 mp4 落项目素材（IPC 通道名沿用，主进程 electron/video/framesToVideo.ts 契约不动）
    framesToVideo: (payload: unknown) =>
      ipcRenderer.invoke("nomi:scene3d:frames-to-video", payload) as Promise<{ url: string; assetId?: string }>,
    mobile: {
      feedback: (payload: MobileBridgeFeedback) => ipcRenderer.invoke('nomi:director:mobile:feedback', payload) as Promise<boolean>,
      start: (payload?: { text?: Record<string, string>; consent?: boolean }) =>
        ipcRenderer.invoke("nomi:director:mobile:start", payload) as Promise<{
          running: boolean
          secure: boolean
          port: number | null
          urls: string[]
          devices: Array<{ id: string; name: string; latencyMs: number | null; connectedAt: number }>
          consentRequired: boolean
          certFingerprint: string | null
          pairingExpiresAt: number | null
          qrByUrl?: Record<string, string>
        }>,
      stop: () =>
        ipcRenderer.invoke("nomi:director:mobile:stop") as Promise<{
          running: boolean
          secure: boolean
          port: number | null
          urls: string[]
          devices: Array<{ id: string; name: string; latencyMs: number | null; connectedAt: number }>
          consentRequired: boolean
          certFingerprint: string | null
          pairingExpiresAt: number | null
          qrByUrl?: Record<string, string>
        }>,
      status: () =>
        ipcRenderer.invoke("nomi:director:mobile:status") as Promise<{
          running: boolean
          secure: boolean
          port: number | null
          urls: string[]
          devices: Array<{ id: string; name: string; latencyMs: number | null; connectedAt: number }>
          consentRequired: boolean
          certFingerprint: string | null
          pairingExpiresAt: number | null
          qrByUrl?: Record<string, string>
        }>,
      onEvent: (callback: (event: unknown) => void) => {
        const listener = (_event: unknown, payload: unknown) => callback(payload)
        ipcRenderer.on("nomi:director:mobile:event", listener as never)
        return () => {
          ipcRenderer.removeListener("nomi:director:mobile:event", listener as never)
        }
      },
    },
  },
  review: {
    onEvent: (callback: (payload: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("nomi:review:event", listener as never);
      return () => ipcRenderer.removeListener("nomi:review:event", listener as never);
    },
  },
  // Generation strategy resolver：GUI 分镜表审阅的 stateless resolve。主进程 planning seam 计算，
  // 返回与 agent/MCP 完全同源的执行计划建议（候选只在 main，渲染层不自构）。信封 ok=false 带 code。
  generationStrategy: {
    resolvePlan: (payload: unknown) =>
      ipcRenderer.invoke("nomi:generation:resolve-plan", payload) as Promise<unknown>,
  },
  dreamina: {
    status: () => ipcRenderer.invoke("nomi:dreamina:status"),
    loginStart: () => ipcRenderer.invoke("nomi:dreamina:login-start"),
    loginPoll: (deviceCode: string) => ipcRenderer.invoke("nomi:dreamina:login-poll", deviceCode),
    logout: () => ipcRenderer.invoke("nomi:dreamina:logout"),
    install: () => ipcRenderer.invoke("nomi:dreamina:install"),
  },
};
