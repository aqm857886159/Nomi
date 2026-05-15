import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let tray: Tray | null = null;

function getIconPath(): string {
  // 尝试多个路径：打包后 / 开发模式
  const candidates = [
    path.join(__dirname, '../../resources/icons/tray.png'),
    path.join(process.resourcesPath || '', 'icons', 'tray.png'),
    path.join(__dirname, '../../resources/icons/icon.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // 返回空路径，Electron 会用默认图标
  return candidates[0];
}

export function setupTray(win: BrowserWindow): void {
  const iconPath = getIconPath();
  let icon = nativeImage.createEmpty();
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
    if (process.platform === 'darwin') {
      icon = icon.resize({ width: 16, height: 16 });
      icon.setTemplateImage(true);
    }
  }

  tray = new Tray(icon);
  tray.setToolTip('Nomi');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开 Nomi',
      click: () => {
        win.show();
        win.focus();
      },
    },
    { type: 'separator' },
    {
      label: `版本 ${app.getVersion()}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.exit(0);
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (win.isVisible()) {
      win.focus();
    } else {
      win.show();
    }
  });

  tray.on('double-click', () => {
    win.show();
    win.focus();
  });
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
