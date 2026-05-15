import { BrowserWindow, shell } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false, // 等待 ready-to-show
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // 需要 false 才能在 preload 中使用 require
    },
  });

  // 内容准备好后再显示，避免白屏闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 外部链接在系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 关闭时隐藏到托盘（而非退出）
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin') {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function setMainWindowReady(): void {
  // no-op 占位，未来可在此触发 splash 隐藏等逻辑
}
