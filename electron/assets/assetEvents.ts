// 素材写入层的回流广播：writeAsset/moveAssetFile 落盘后通知所有窗口刷新。
// 为什么在写入层而不是各导入入口：入口会不断新增（捕捞/拖拽/上传/agent/MCP），
// 写入层是唯一咽喉，挂在这里整类导入路径免费获得「素材库面板/素材盒徽章」回流
// （替代 M0 捕捞窗私有的 nomi:browser-capture:imported 广播）。
// fire-and-forget：动态 import 在 vitest 纯 node 环境会 reject（无 electron）→ 静默 no-op，
// 不影响纯函数测试；主进程里 CJS 输出等价于惰性 require。
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
