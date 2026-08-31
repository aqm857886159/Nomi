import { ipcMain } from "electron";

import {
  readVideoAnalysisSettings,
  writeVideoAnalysisSettings,
  type VideoAnalysisSettings,
} from "./videoAnalysisSettings";

export type VideoAnalysisSettingsStore = {
  read: () => VideoAnalysisSettings;
  write: (value: unknown) => VideoAnalysisSettings;
};

export function registerVideoAnalysisSettingsIpc(
  store: VideoAnalysisSettingsStore = {
    read: readVideoAnalysisSettings,
    write: writeVideoAnalysisSettings,
  },
): void {
  ipcMain.handle("nomi:settings:video-analysis-get", async () => store.read());
  ipcMain.handle("nomi:settings:video-analysis-set", async (_event, payload: unknown) => store.write(payload));
}
