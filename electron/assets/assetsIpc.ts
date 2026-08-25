// 素材域 IPC 注册器（2026-07-22 素材面收敛时从 main.ts 抽出,R9 巨壳门岗）：
// 文件夹读写 + 本地文件导入 + 素材下载 + 自动另存/设置（集中设置页「文件与保存」）。
import { clipboard, dialog, ipcMain } from "electron";
import { assertTrustedSender } from "../ipcSenderGuard";
import { getAutoSavePrefs, setAutoSavePrefs, type AutoSavePrefs } from "./downloadPrefs";
import { CLIPBOARD_FILE_PATH_FORMATS, parseClipboardFilePaths } from "./clipboardFilePaths";
import { copyLocalImageFiles } from "./localFileCopy";

export function readClipboardFilePathsFromFormats(
  availableFormats: readonly string[],
  readBuffer: (format: string) => Buffer,
): string[] {
  for (const format of CLIPBOARD_FILE_PATH_FORMATS) {
    if (!availableFormats.includes(format)) continue;
    try {
      const paths = parseClipboardFilePaths(format, readBuffer(format));
      if (paths.length > 0) return paths;
    } catch {
      // A clipboard format can disappear between availableFormats and readBuffer.
    }
  }
  return [];
}

export function parseCopyFilesPayload(payload: unknown): { projectId: string; paths: string[] } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const raw = payload as { projectId?: unknown; paths?: unknown };
  const projectId = typeof raw.projectId === "string" ? raw.projectId.trim() : "";
  const paths = Array.isArray(raw.paths)
    ? [...new Set(raw.paths.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))]
    : [];
  return projectId && paths.length > 0 ? { projectId, paths } : null;
}

export function registerAssetsIpc(): void {
  ipcMain.handle("nomi:clipboard:read-file-paths", (event) => {
    // 外泄面：剪贴板里的文件路径会暴露用户磁盘布局，只准主窗口读。
    assertTrustedSender(event);
    return readClipboardFilePathsFromFormats(clipboard.availableFormats(), (format) =>
      format === "text/plain" ? Buffer.from(clipboard.readText(), "utf8") : clipboard.readBuffer(format),
    );
  });
  ipcMain.handle("nomi:assets:copy-files", (event, payload) => {
    assertTrustedSender(event);
    const parsed = parseCopyFilesPayload(payload);
    if (!parsed) throw new Error("projectId and paths are required");
    return copyLocalImageFiles(parsed.projectId, parsed.paths);
  });
  ipcMain.handle("nomi:assets:folders-get", async (event, payload) => {
    assertTrustedSender(event);
    const { getAssetFolders } = await import("./assetFolders");
    return getAssetFolders(payload);
  });
  ipcMain.handle("nomi:assets:folders-save", async (event, payload) => {
    assertTrustedSender(event);
    const { saveAssetFolders } = await import("./assetFolders");
    return saveAssetFolders(payload);
  });
  ipcMain.handle("nomi:assets:import-file", async (event, payload) => {
    assertTrustedSender(event);
    const { importLocalFile } = await import("./localFileImport");
    const raw = (payload || {}) as Record<string, unknown>;
    // 字节通道不接受 renderer 自报路径；原生路径只能经 webUtils 桥进入下面的专用通道。
    return importLocalFile({ ...raw, sourcePath: undefined });
  });
  ipcMain.handle("nomi:assets:import-native-file", async (event, payload) => {
    assertTrustedSender(event);
    const { importLocalFile } = await import("./localFileImport");
    return importLocalFile(payload, { allowSourcePath: true });
  });
  ipcMain.handle("nomi:assets:ensure-playable", async (event, payload) => {
    assertTrustedSender(event);
    const { ensurePlayableAsset } = await import("./localFileImport");
    return ensurePlayableAsset(payload);
  });
  // 引导示例项目的预置成图 → 真项目资产（拿稳定 nomi-local URL；构建产物 URL 不配写进用户数据）。
  ipcMain.handle("nomi:assets:seed-onboarding-demo", async (event, payload) => {
    assertTrustedSender(event);
    const { seedOnboardingDemoAssets } = await import("../onboarding/demoAssetSeed");
    return seedOnboardingDemoAssets(payload);
  });
  ipcMain.handle("nomi:assets:download", async (event, payload) => {
    assertTrustedSender(event);
    const { downloadAssetToDisk } = await import("./downloadAsset");
    return downloadAssetToDisk(payload);
  });
  // 自动另存：生成完成时渲染层调这里，把生成物静默复制一份到用户目录（best-effort，关/失败不打断生成）。
  ipcMain.handle("nomi:assets:auto-save", async (event, payload) => {
    assertTrustedSender(event);
    const { autoSaveAssetToDisk } = await import("./autoSaveAsset");
    const p = (payload || {}) as { url?: unknown; suggestedName?: unknown };
    return autoSaveAssetToDisk(String(p.url || ""), String(p.suggestedName || ""));
  });
  // 集中设置页「文件与保存」：读/写自动另存开关+目录、选目录。
  ipcMain.handle("nomi:settings:auto-save-get", (event) => {
    assertTrustedSender(event);
    return getAutoSavePrefs();
  });
  ipcMain.handle("nomi:settings:auto-save-set", (event, payload) => {
    assertTrustedSender(event);
    const p = (payload || {}) as Partial<AutoSavePrefs>;
    setAutoSavePrefs({ enabled: Boolean(p.enabled), dir: String(p.dir || "") });
    return getAutoSavePrefs();
  });
  ipcMain.handle("nomi:settings:pick-dir", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return { dir: result.canceled || !result.filePaths[0] ? "" : result.filePaths[0] };
  });
}
