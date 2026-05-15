import { contextBridge, ipcRenderer } from 'electron';

// 从主进程环境中读取 API 端口，注入到渲染进程全局
const apiPort = process.env.NOMI_API_PORT || '8788';

contextBridge.exposeInMainWorld('__nomiDesktop__', {
  // 标识当前运行在 Electron 桌面环境
  isDesktop: true,

  // API base URL（渲染进程的 httpClient 会读取这个）
  apiBase: `http://127.0.0.1:${apiPort}`,

  // 系统通知
  showNotification: (title: string, body: string) =>
    ipcRenderer.invoke('show-notification', { title, body }),

  // 文件拖拽回调注册
  onFileDrop: (callback: (paths: string[]) => void) => {
    ipcRenderer.on('file-dropped', (_event, paths: string[]) => callback(paths));
  },

  // 打开 .nomi 文件回调注册
  onOpenNomiFile: (callback: (filePath: string) => void) => {
    ipcRenderer.on('open-nomi-file', (_event, filePath: string) => callback(filePath));
  },

  // 读取本地文件（用于拖拽上传）
  readLocalFile: (filePath: string): Promise<{ name: string; size: number; dataUrl: string }> =>
    ipcRenderer.invoke('read-local-file', filePath),

  // 开机自启设置
  setLoginItem: (enabled: boolean) =>
    ipcRenderer.invoke('set-login-item', enabled),

  getLoginItem: (): Promise<boolean> =>
    ipcRenderer.invoke('get-login-item'),

  // 版本信息
  getVersion: (): Promise<string> =>
    ipcRenderer.invoke('get-version'),

  // 自动更新
  onUpdateAvailable: (callback: (info: unknown) => void) => {
    ipcRenderer.on('update-available', (_event, info) => callback(info));
  },
  onUpdateReady: (callback: () => void) => {
    ipcRenderer.on('update-ready', () => callback());
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
});
