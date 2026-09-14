// 素材写入层的回流广播：writeAsset/moveAssetFile 落盘后通知所有窗口刷新。
// 为什么在写入层而不是各导入入口：入口会不断新增（捕捞/拖拽/上传/agent/MCP），
// 写入层是唯一咽喉，挂在这里整类导入路径免费获得「素材库面板/素材盒徽章」回流
// （替代 M0 捕捞窗私有的 nomi:browser-capture:imported 广播）。
// fire-and-forget：动态 import 在 vitest 纯 node 环境会 reject（无 electron）→ 静默 no-op，
// 不影响纯函数测试；主进程里 CJS 输出等价于惰性 require。
import type { AssetLocalizationEvent } from "../shared/assets/assetLocalizationEvent";

export type { AssetLocalizationEvent };

export function broadcastAssetsUpdated(projectId: string): void {
  void import("electron")
    .then(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("nomi:assets:updated", { projectId });
      }
    })
    .catch(() => {
      /* 测试环境无 electron → no-op */
    });
}

/**
 * 单个节点的「字节正在进项目」生命周期（nomi:assets:localization-started）。
 *
 * 一条通道两种用法，不新开第二条：
 * - 生成结果本地化只发一次（无 bytes 字段）= 开始的信号；
 * - 本地导入在拷贝流上连发（带 copiedBytes/totalBytes，首条带 previewUrl）= 进度。
 * 订阅方按 projectId+nodeId 认领，两种用法天然互不相干（生成节点不会是导入节点）。
 */
function sendAssetLocalizationEvent(payload: AssetLocalizationEvent): Promise<void> {
  return import("electron").then(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("nomi:assets:localization-started", payload);
    }
  }).catch(() => { /* Pure Node tests have no Electron window. */ });
}

/** Catalog generation owns this signal, before importing bytes into the project. */
export function broadcastAssetLocalizationStarted(payload: { projectId: string; nodeId: string }): Promise<void> {
  return sendAssetLocalizationEvent(payload);
}

/** 本地导入的拷贝进度（节流在 assetImportProgress 那层做，这里只负责发）。 */
export function broadcastAssetImportProgress(payload: AssetLocalizationEvent): Promise<void> {
  return sendAssetLocalizationEvent(payload);
}
