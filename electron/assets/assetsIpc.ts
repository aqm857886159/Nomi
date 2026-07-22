// 素材域 IPC 注册器（2026-07-22 素材面收敛时从 main.ts 抽出,R9 巨壳门岗）：
// 文件夹读写 + 本地文件导入 + 素材下载。列表(nomi:assets:list)因依赖 runtime 懒加载留在 main。
import { ipcMain } from "electron";

export function registerAssetsIpc(): void {
  ipcMain.handle("nomi:assets:folders-get", async (_event, payload) => {
    const { getAssetFolders } = await import("./assetFolders");
    return getAssetFolders(payload);
  });
  ipcMain.handle("nomi:assets:folders-save", async (_event, payload) => {
    const { saveAssetFolders } = await import("./assetFolders");
    return saveAssetFolders(payload);
  });
  ipcMain.handle("nomi:assets:import-file", async (_event, payload) => {
    const { importLocalFile } = await import("./localFileImport");
    return importLocalFile(payload);
  });
  ipcMain.handle("nomi:assets:download", async (_event, payload) => {
    const { downloadAssetToDisk } = await import("./downloadAsset");
    return downloadAssetToDisk(payload);
  });
}
