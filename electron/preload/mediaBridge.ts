/**
 * 素材 / 浏览器 / 视频 / 截图 / 导出这一族的 preload 桥面。
 *
 * 从 electron/preload.ts 抽出来（R9：preload.ts 顶着 800 行硬上限，每加一条桥都在撞线）。
 * 这里**只搬家、不改行为**：每个键、每条频道名、每句注释都逐字保留，preload.ts 用 `...mediaBridge` 组装，暴露给渲染层的对象形状逐字节不变。
 */
import { ipcRenderer, webUtils } from "electron";
import type { AssetLocalizationEvent } from "../shared/assets/assetLocalizationEvent";
import { invokeSync } from "./ipcCall";
import { importNativeFileFromPreload } from "../assets/nativeFileBridge";

export const mediaBridge = {
  assets: {
    list: (payload: unknown) => ipcRenderer.invoke("nomi:assets:list", payload),
    // 素材文件夹（素材面收敛 2026-07-22 转正）：per-project 落盘,素材库唯一消费者。
    foldersGet: (payload: unknown) => ipcRenderer.invoke("nomi:assets:folders-get", payload),
    foldersSave: (payload: unknown) => ipcRenderer.invoke("nomi:assets:folders-save", payload),
    // 素材写入层（writeAsset/moveAssetFile）落盘即广播——素材库面板/素材盒徽章的统一回流信号，
    // 任何导入路径（浏览器捕捞/拖拽/上传/agent）免费获得刷新（M0 捕捞窗私有 onImported 的接任者）。
    onUpdated: (cb: (payload: unknown) => void) => {
      const listener = (_: unknown, v: unknown) => cb(v);
      ipcRenderer.on("nomi:assets:updated", listener);
      return () => ipcRenderer.removeListener("nomi:assets:updated", listener);
    },
    // 一条通道两种用法：生成本地化只发一次（无 bytes）；本地导入在拷贝流上连发（带 copiedBytes/totalBytes）。
    onLocalizationStarted: (cb: (payload: AssetLocalizationEvent) => void) => {
      const listener = (_: unknown, value: AssetLocalizationEvent) => cb(value);
      ipcRenderer.on("nomi:assets:localization-started", listener);
      return () => ipcRenderer.removeListener("nomi:assets:localization-started", listener);
    },
    importRemoteUrl: (payload: unknown) => ipcRenderer.invoke("nomi:assets:import-remote-url", payload),
    importFile: (payload: unknown) => ipcRenderer.invoke("nomi:assets:import-file", payload),
    // 原生文件选择器返回的 File 由 preload 就地解析路径；路径不暴露给页面，且大视频不再整份穿过 renderer IPC。
    importNativeFile: (file: File, payload: Record<string, unknown>) => importNativeFileFromPreload(file, payload, {
      getPathForFile: (nativeFile) => webUtils.getPathForFile(nativeFile),
      invoke: (channel, request) => ipcRenderer.invoke(channel, request),
    }),
    copyFiles: (payload: unknown) => ipcRenderer.invoke("nomi:assets:copy-files", payload),
    storageCapacity: (payload: unknown) => ipcRenderer.invoke("nomi:assets:storage-capacity", payload),
    reportVideoCodecs: (payload: unknown) => ipcRenderer.invoke("nomi:assets:report-video-codecs", payload),
    copyProjectAsset: (payload: unknown) => ipcRenderer.invoke("nomi:assets:copy-project-asset", payload),
    // 播放懒自愈：nomi-local 视频解不了（HEVC 存量/供应商 HEVC 产物）→ 主进程转码出新 MP4 资产。
    ensurePlayable: (payload: unknown) => ipcRenderer.invoke("nomi:assets:ensure-playable", payload),
    ensurePreview: (payload: unknown) => ipcRenderer.invoke("nomi:assets:ensure-preview", payload),
    // 引导示例项目：把随包成图落成项目资产，回 clientId → nomi-local URL（渲染侧算不出稳定地址）。
    seedOnboardingDemo: (payload: unknown) => ipcRenderer.invoke("nomi:assets:seed-onboarding-demo", payload),
    download: (payload: unknown) =>
      ipcRenderer.invoke("nomi:assets:download", payload) as Promise<{
        ok: boolean;
        canceled?: boolean;
        path?: string;
      }>,
    // 自动另存（生成完成即调，best-effort）+ 集中设置页读写/选目录。
    autoSave: (payload: unknown) =>
      ipcRenderer.invoke("nomi:assets:auto-save", payload) as Promise<{ ok: boolean; path?: string }>,
    getAutoSavePrefs: () =>
      ipcRenderer.invoke("nomi:settings:auto-save-get") as Promise<{ enabled: boolean; dir: string }>,
    setAutoSavePrefs: (payload: unknown) =>
      ipcRenderer.invoke("nomi:settings:auto-save-set", payload) as Promise<{ enabled: boolean; dir: string }>,
    pickSaveDir: () => ipcRenderer.invoke("nomi:settings:pick-dir") as Promise<{ dir: string }>,
  },
  browser: {
    createView: (payload: unknown) => ipcRenderer.invoke("browser:view:create", payload) as Promise<{ viewId: number }>,
    destroyView: (payload: unknown) => ipcRenderer.send("browser:view:destroy", payload),
    navigate: (payload: unknown) => ipcRenderer.send("browser:view:navigate", payload),
    back: (payload: unknown) => ipcRenderer.send("browser:view:back", payload),
    forward: (payload: unknown) => ipcRenderer.send("browser:view:forward", payload),
    reload: (payload: unknown) => ipcRenderer.send("browser:view:reload", payload),
    resize: (payload: unknown) => ipcRenderer.send("browser:view:resize", payload),
    show: (payload: unknown) => ipcRenderer.send("browser:view:show", payload),
    hide: (payload: unknown) => ipcRenderer.send("browser:view:hide", payload),
    importMedia: (payload: unknown) => ipcRenderer.invoke("browser:view:import-media", payload),
    capturePromptImage: (payload: unknown) => ipcRenderer.invoke("browser:view:capture-prompt-image", payload),
    selectPromptScreenshot: (payload: unknown) =>
      ipcRenderer.invoke("browser:view:select-prompt-screenshot", payload),
    capturePromptScreenshot: (payload: unknown) =>
      ipcRenderer.invoke("browser:view:capture-prompt-screenshot", payload),
    readPromptExtractionSettings: (payload: unknown) =>
      ipcRenderer.invoke("browser:prompt-extraction-settings:read", payload),
    writePromptExtractionSettings: (payload: unknown) =>
      ipcRenderer.invoke("browser:prompt-extraction-settings:write", payload),
    setResourceCapture: (payload: unknown) => ipcRenderer.send("browser:view:set-resource-capture", payload),
    captureResource: (payload: unknown) => ipcRenderer.send("browser:view:capture-resource", payload),
    showChromeMenu: (payload: unknown) => ipcRenderer.invoke("browser:chrome-menu:show", payload),
    assetOverlay: {
      open: (payload: unknown) => ipcRenderer.send("browser:asset-overlay:open", payload),
      updateHost: (payload: unknown) => ipcRenderer.send("browser:asset-overlay:update-host", payload),
      close: () => ipcRenderer.send("browser:asset-overlay:close"),
      captureRequest: (payload: unknown) => ipcRenderer.send("browser:asset-overlay:capture-request", payload),
      ready: () => ipcRenderer.send("browser:asset-overlay:ready"),
      setInteractive: (payload: unknown) => ipcRenderer.send("browser:asset-overlay:set-interactive", payload),
      finishDrag: () => ipcRenderer.send("browser:asset-overlay:finish-drag"),
      setState: (payload: unknown) => ipcRenderer.send("browser:asset-overlay:set-state", payload),
      importToCanvas: (payload: unknown) => ipcRenderer.send("browser:asset-overlay:import-to-canvas", payload),
      canvasImportAvailable: () => ipcRenderer.invoke("browser:asset-overlay:canvas-import-available"),
      onConfig: (callback: (event: unknown) => void) => {
        const listener = (_event: unknown, payload: unknown) => callback(payload);
        ipcRenderer.on("browser:asset-overlay:config", listener as never);
        return () => {
          ipcRenderer.removeListener("browser:asset-overlay:config", listener as never);
        };
      },
      onState: (callback: (event: unknown) => void) => {
        const listener = (_event: unknown, payload: unknown) => callback(payload);
        ipcRenderer.on("browser:asset-overlay:state", listener as never);
        return () => {
          ipcRenderer.removeListener("browser:asset-overlay:state", listener as never);
        };
      },
      onImportToCanvas: (callback: (event: unknown) => void) => {
        const listener = (_event: unknown, payload: unknown) => callback(payload);
        ipcRenderer.on("browser:asset-overlay:import-to-canvas", listener as never);
        return () => {
          ipcRenderer.removeListener("browser:asset-overlay:import-to-canvas", listener as never);
        };
      },
    },
    onPromptCapture: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("browser:view:prompt-capture", listener as never);
      return () => {
        ipcRenderer.removeListener("browser:view:prompt-capture", listener as never);
      };
    },
    onTextPromptSave: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("browser:view:text-prompt-save", listener as never);
      return () => {
        ipcRenderer.removeListener("browser:view:text-prompt-save", listener as never);
      };
    },
    onResourceCapture: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("browser:view:resource-capture", listener as never);
      return () => {
        ipcRenderer.removeListener("browser:view:resource-capture", listener as never);
      };
    },
    onState: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("browser:view:state", listener as never);
      return () => {
        ipcRenderer.removeListener("browser:view:state", listener as never);
      };
    },
  },
  video: {
    extractFrame: (payload: unknown) =>
      ipcRenderer.invoke("nomi:video:extract-frame", payload) as Promise<{ url: string }>,
    extractFilmstrip: (payload: unknown) =>
      ipcRenderer.invoke("nomi:video:extract-filmstrip", payload) as Promise<{ url: string; tiles: number; tileHeight: number }>,
    detectShotCuts: (payload: unknown) =>
      ipcRenderer.invoke("nomi:video:detect-shot-cuts", payload) as Promise<unknown>,
    onDeconstructionProgress: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("nomi:video:deconstruction-progress", listener);
      return () => { ipcRenderer.removeListener("nomi:video:deconstruction-progress", listener); };
    },
    deconstruct: (payload: unknown) =>
      ipcRenderer.invoke("nomi:video:deconstruct", payload) as Promise<unknown>,
  },
  screenshot: {
    get: () => ipcRenderer.invoke("nomi:screenshot:get") as Promise<unknown>,
    set: (payload: unknown) => ipcRenderer.invoke("nomi:screenshot:set", payload) as Promise<unknown>,
    openPermissionSettings: () => ipcRenderer.invoke("nomi:screenshot:open-permission-settings") as Promise<unknown>,
    // 走查专用：对应的 handler 只在主进程 NOMI_E2E=1 时注册，生产环境这里会直接 reject（门禁在主进程侧）。
    e2eCapture: () => ipcRenderer.invoke("nomi:screenshot:e2e-capture") as Promise<unknown>,
    onCaptured: (cb: (payload: { url: string; width: number; height: number; surfaceBinding: unknown }) => void) => {
      const listener = (_: unknown, value: { url: string; width: number; height: number; surfaceBinding: unknown }) => cb(value);
      ipcRenderer.on("nomi:screenshot:captured", listener);
      return () => ipcRenderer.removeListener("nomi:screenshot:captured", listener);
    },
    onDenied: (cb: (payload: { screenAccess: string }) => void) => {
      const listener = (_: unknown, value: { screenAccess: string }) => cb(value);
      ipcRenderer.on("nomi:screenshot:denied", listener);
      return () => ipcRenderer.removeListener("nomi:screenshot:denied", listener);
    },
    onFailed: (cb: (payload: { reason: string }) => void) => {
      const listener = (_: unknown, value: { reason: string }) => cb(value);
      ipcRenderer.on("nomi:screenshot:failed", listener);
      return () => ipcRenderer.removeListener("nomi:screenshot:failed", listener);
    },
  },
  image: {
    decomposeLayers: (payload: unknown) =>
      ipcRenderer.invoke("nomi:image:decompose-layers", payload) as Promise<{ layers: string[] }>,
  },
  videoDepth: {
    prepare: (payload: unknown) => ipcRenderer.invoke("nomi:video-depth:prepare", payload) as Promise<unknown>,
    readFrames: (payload: unknown) =>
      ipcRenderer.invoke("nomi:video-depth:read-frames", payload) as Promise<{ frames: Uint8Array[] }>,
    writeFrames: (payload: unknown) => ipcRenderer.invoke("nomi:video-depth:write-frames", payload) as Promise<{ ok: true }>,
    finish: (payload: unknown) =>
      ipcRenderer.invoke("nomi:video-depth:finish", payload) as Promise<{ url: string; assetId?: string; frames: number }>,
    cancel: (payload: unknown) => ipcRenderer.invoke("nomi:video-depth:cancel", payload) as Promise<{ ok: true }>,
    onEvent: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("nomi:video-depth:event", listener as never);
      return () => {
        ipcRenderer.removeListener("nomi:video-depth:event", listener as never);
      };
    },
  },
  exports: {
    startJob: (payload: unknown) => ipcRenderer.invoke("nomi:exports:start-job", payload),
    list: () => ipcRenderer.invoke("nomi:exports:list"),
    writeTempInput: (payload: unknown) => ipcRenderer.invoke("nomi:exports:write-temp-input", payload),
    finishTempInput: (payload: unknown) => ipcRenderer.invoke("nomi:exports:finish-temp-input", payload),
    status: (jobId: string) => ipcRenderer.invoke("nomi:exports:status", jobId),
    verify: (jobId: string) => ipcRenderer.invoke("nomi:exports:verify", jobId),
    cancel: (jobId: string) => ipcRenderer.invoke("nomi:exports:cancel", jobId),
    onEvent: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("nomi:exports:event", listener as never);
      return () => {
        ipcRenderer.removeListener("nomi:exports:event", listener as never);
      };
    },
    showInFolder: (payload: unknown) => ipcRenderer.invoke("nomi:exports:show-in-folder", payload),
  },
  assetTransport: {
    /** 每种媒体类型现在实际会走的第一条上传通道（设置页状态卡；优先级真相在 main 的解析器里）。 */
    describeChannels: () => invokeSync("nomi:asset-transport:channels:describe"),
  },
};
