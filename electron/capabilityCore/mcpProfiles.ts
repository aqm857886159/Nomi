// 自定义 MCP 客户端 profile 的对外桥接：IPC 注册 + 文件变化 → 窗口刷新回流。
//
// 拆成独立模块而不是塞进 mcpConfig（真相源）或 main.ts（巨壳）：
//   - IPC transport：三条 profile 通道（list/register/remove）都改 async（ipcMain.handle，renderer 走
//     invoke 而非 sendSync），对齐「IPC 读路径异步化」方向；每条都过 assertTrustedSender（renderer
//     主 frame 才能调，防内置浏览器远程页面冒调）。
//   - 文件 watch：检测发生在 mcpNodeLauncher（bare-Node 进程）里，它写 mcp-client-profiles.json，GUI 读
//     同一文件。watchFile 该文件，变化即广播 nomi:mcp:profiles-changed，renderer 收到后刷新。为什么
//     watchFile 而不是 fs.watch：Windows 上 fs.watch 对「tmp→rename 整文件替换」会失联（检测写入正是这种
//     原子替换）；watchFile 按 mtime 轮询，跨平台稳定，1s 延迟对「设置页刷新」完全够。
// 真相源在 mcpConfig.ts，这里只做 transport + 回流。
import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { assertTrustedSender } from '../ipcSenderGuard'
import { listCustomMcpProfiles, registerCustomMcpProfile, removeCustomMcpProfile } from './mcpConfig'
import { profilesPath } from './mcpDetectedClients'

export function registerCustomMcpProfileIpc(): void {
  ipcMain.handle('nomi:capability:mcp-custom-profiles', (event) => {
    assertTrustedSender(event)
    return listCustomMcpProfiles()
  })
  ipcMain.handle('nomi:capability:mcp-custom-profile-register', (event, profile: unknown) => {
    assertTrustedSender(event)
    return registerCustomMcpProfile(profile)
  })
  ipcMain.handle('nomi:capability:mcp-custom-profile-remove', (event, key: string) => {
    assertTrustedSender(event)
    return removeCustomMcpProfile(key)
  })
}

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
