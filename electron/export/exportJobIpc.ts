import { ipcMain, webContents as electronWebContents } from "electron";
import type { WebContents } from "electron";
import {
  cancelExportJob,
  finishExportTempInput,
  getExportJobStatus,
  showExportInFolder,
  startExportJob,
  subscribeExportJobEvents,
  writeExportTempInput,
} from "./exportJobs";

const exportJobEventSubscriptions = new Map<number, () => void>();

export function registerExportJobIpc(): void {
  ipcMain.handle("nomi:exports:start-job", (event, payload) => {
    registerExportJobEventForwarding(event.sender);
    return startExportJob(payload);
  });
  ipcMain.handle("nomi:exports:write-temp-input", (event, payload) => {
    registerExportJobEventForwarding(event.sender);
    return writeExportTempInput(payload);
  });
  ipcMain.handle("nomi:exports:finish-temp-input", (event, payload) => {
    registerExportJobEventForwarding(event.sender);
    return finishExportTempInput(payload);
  });
  ipcMain.handle("nomi:exports:status", (event, jobId) => {
    registerExportJobEventForwarding(event.sender);
    return getExportJobStatus(jobId);
  });
  ipcMain.handle("nomi:exports:cancel", (event, jobId) => {
    registerExportJobEventForwarding(event.sender);
    return cancelExportJob(jobId);
  });
  ipcMain.handle("nomi:exports:show-in-folder", (_event, payload) => showExportInFolder(payload));
}

export function registerExportJobEventForwarding(contents: WebContents): void {
  if (exportJobEventSubscriptions.has(contents.id)) return;
  const unsubscribe = subscribeExportJobEvents((payload) => {
    const target = electronWebContents.fromId(contents.id);
    if (!target || target.isDestroyed()) return;
    target.send("nomi:exports:event", payload);
  });
  exportJobEventSubscriptions.set(contents.id, unsubscribe);
  contents.once("destroyed", () => {
    exportJobEventSubscriptions.get(contents.id)?.();
    exportJobEventSubscriptions.delete(contents.id);
  });
}
