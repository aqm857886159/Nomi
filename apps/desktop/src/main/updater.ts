import { BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

export function checkForUpdates(win: BrowserWindow): void {
  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on('update-available', (info) => {
    win.webContents.send('update-available', info);
  });

  autoUpdater.on('update-downloaded', () => {
    win.webContents.send('update-ready');
  });
}
