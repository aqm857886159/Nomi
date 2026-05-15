import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { createMainWindow, setMainWindowReady } from './window';
import { startApiServer } from './api-server';
import { registerIpcHandlers } from './ipc-handlers';
import { setupTray } from './tray';
import { checkForUpdates } from './updater';

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  // 第二个实例启动时，聚焦已有窗口
  const { getMainWindow } = require('./window');
  const win = getMainWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  // 1. 注册 IPC handlers（在窗口创建前）
  registerIpcHandlers();

  // 2. 创建主窗口（显示 loading 状态）
  const win = createMainWindow();

  // 3. 启动 Hono API Server
  let apiPort: number;
  try {
    const result = await startApiServer();
    apiPort = result.port;
    console.log(`[desktop] API server ready on port ${apiPort}`);
  } catch (err) {
    console.error('[desktop] Failed to start API server:', err);
    // 在开发模式下，fallback 到外部运行的 API
    apiPort = Number(process.env.NOMI_DEV_API_PORT || 8788);
    console.log(`[desktop] Dev fallback: using external API on port ${apiPort}`);
  }

  // 4. 通知预加载脚本 API 端口（通过环境变量在 webContents 创建前设置）
  process.env.NOMI_API_PORT = String(apiPort);

  // 5. 加载 Web UI
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    const devWebPort = process.env.NOMI_DEV_WEB_PORT || '5173';
    await win.loadURL(`http://localhost:${devWebPort}`);
    win.webContents.openDevTools();
  } else {
    const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
    await win.loadFile(rendererPath);
  }

  setMainWindowReady();

  // 6. 设置托盘
  setupTray(win);

  // 7. 检查更新（生产环境）
  if (!isDev) {
    checkForUpdates(win);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      win.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 处理 .nomi 文件关联（macOS）
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  const { getMainWindow } = require('./window');
  const win = getMainWindow();
  if (win) {
    win.webContents.send('open-nomi-file', filePath);
  }
});
