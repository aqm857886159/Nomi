import { app, ipcMain, Notification, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export function registerIpcHandlers(): void {
  // 系统通知
  ipcMain.handle('show-notification', (_event, { title, body }: { title: string; body: string }) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  });

  // 读取本地文件（拖拽上传用）
  ipcMain.handle('read-local-file', async (_event, filePath: string) => {
    const stat = await fs.promises.stat(filePath);
    const buffer = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4',
      mov: 'video/quicktime', webm: 'video/webm',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
    return {
      name: path.basename(filePath),
      size: stat.size,
      dataUrl,
    };
  });

  // 开机自启
  ipcMain.handle('set-login-item', (_event, enabled: boolean) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true,
      name: 'Nomi',
    });
  });

  ipcMain.handle('get-login-item', () => {
    return app.getLoginItemSettings().openAtLogin;
  });

  // 版本信息
  ipcMain.handle('get-version', () => app.getVersion());

  // 安装更新
  ipcMain.handle('install-update', () => {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.quitAndInstall();
  });

  // 在系统文件管理器中显示文件
  ipcMain.handle('show-item-in-folder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  // 在系统浏览器中打开 URL
  ipcMain.handle('open-external', (_event, url: string) => {
    shell.openExternal(url);
  });
}
