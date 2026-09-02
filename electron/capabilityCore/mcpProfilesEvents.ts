// 自定义 MCP 客户端列表的「文件变化 → 窗口刷新」回流。
//
// 检测发生在 mcpNodeLauncher（bare-Node 进程）里，它写 mcp-client-profiles.json；GUI 读同一文件。
// 这里 watchFile 该文件，变化即广播 nomi:mcp:profiles-changed，renderer 收到后刷新列表。
// 为什么 watchFile 而不是 fs.watch：Windows 上 fs.watch 对「tmp→rename 整文件替换」会失联（检测写入
// 正是这种原子替换）；watchFile 按 mtime 轮询，跨平台稳定，1s 延迟对「设置页刷新」完全够。
import fs from 'node:fs'
import path from 'node:path'
import { profilesPath } from './mcpDetectedClients'

/** 广播给所有窗口（fire-and-forget；测试环境无 electron → no-op，仿 assetEvents）。 */
export function broadcastMcpProfilesChanged(): void {
  void import('electron')
    .then(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('nomi:mcp:profiles-changed')
      }
    })
    .catch(() => {
      /* 测试环境无 electron → no-op */
    })
}

/** 启动时挂文件监听。失败不致命——用户仍可重进设置页/重启刷新。 */
export function watchMcpProfiles(): void {
  try {
    const target = profilesPath()
    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (!fs.existsSync(target)) fs.writeFileSync(target, '[]')
    fs.watchFile(target, { interval: 1000 }, broadcastMcpProfilesChanged)
  } catch {
    /* no-op */
  }
}
