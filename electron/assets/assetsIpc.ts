// 素材域 IPC 注册器（2026-07-22 素材面收敛时从 main.ts 抽出,R9 巨壳门岗）：
// 文件夹读写 + 本地文件导入 + 素材下载 + 自动另存/设置（集中设置页「文件与保存」）。
import { clipboard, dialog, ipcMain } from "electron";
import { assertTrustedSender, assertTrustedUiSender } from "../ipcSenderGuard";
import { getAutoSavePrefs, setAutoSavePrefs, type AutoSavePrefs } from "./downloadPrefs";
import { CLIPBOARD_FILE_PATH_FORMATS, parseClipboardFilePaths } from "./clipboardFilePaths";
import { copyProjectAsset, importRemoteAsset } from "./projectAssetStore";
import type { AssetImportResult } from '../shared/contracts/assetImportResult';
import type { AssetImportFailure } from '../shared/contracts/assetImportResult';
import type { ProjectInteractionCapture } from './projectInteractionCapture';
import { surfacePortFailure } from '../shared/surfacePortBinding';

function importFailure(error: unknown, reason: AssetImportFailure['reason'] = 'import-failed'): AssetImportResult<never> {
  return { ok: false, failure: { code: surfacePortFailure(error).code, reason } };
}

async function importAssetResult(payload: unknown, capture: () => (() => void) | undefined, allowSourcePath = false): Promise<AssetImportResult<unknown>> {
  let assertCurrent: (() => void) | undefined;
  try { assertCurrent = capture(); } catch (error) { return importFailure(error); }
  const { importLocalFile, MediaImportRejectedError } = await import('./localFileImport');
  try {
    return { ok: true, asset: await importLocalFile(payload, { allowSourcePath, assertCurrent }) };
  } catch (error) {
    return importFailure(error, error instanceof MediaImportRejectedError ? error.rejection.reason : 'import-failed');
  }
}

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

export function parseCopyProjectAssetPayload(payload: unknown): {
  sourceProjectId: string
  targetProjectId: string
  relativePath: string
} | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const raw = payload as { sourceProjectId?: unknown; targetProjectId?: unknown; relativePath?: unknown };
  const sourceProjectId = typeof raw.sourceProjectId === "string" ? raw.sourceProjectId.trim() : "";
  const targetProjectId = typeof raw.targetProjectId === "string" ? raw.targetProjectId.trim() : "";
  const relativePath = typeof raw.relativePath === "string" ? raw.relativePath.trim().replace(/\\/g, "/") : "";
  if (!sourceProjectId || !targetProjectId || !relativePath || relativePath.startsWith("/") || relativePath.split("/").some((segment) => segment === "..")) return null;
  return { sourceProjectId, targetProjectId, relativePath };
}

export function registerAssetsIpc(captureInteraction: ProjectInteractionCapture): void {
  // Explicit project/background imports retain disk identity without acquiring
  // interactive authority. Agent artifacts always provide the full binding.
  ipcMain.handle("nomi:clipboard:read-file-paths", (event) => {
    // 外泄面：剪贴板里的文件路径会暴露用户磁盘布局，只准主窗口读。
    assertTrustedSender(event);
    return readClipboardFilePathsFromFormats(clipboard.availableFormats(), (format) =>
      format === "text/plain" ? Buffer.from(clipboard.readText(), "utf8") : clipboard.readBuffer(format),
    );
  });
  // Finder 拖入 / 粘贴素材库：与「上传」按钮走同一条落盘路（importLocalFile），
  // 不再另有一份只收图片的窄实现（2026-09-14 删 localFileCopy.ts）。
  ipcMain.handle("nomi:assets:copy-files", async (event, payload) => {
    assertTrustedSender(event);
    const parsed = parseCopyFilesPayload(payload);
    if (!parsed) throw new Error("projectId and paths are required");
    const { importLocalFilePaths } = await import("./localFileCopy");
    return importLocalFilePaths(parsed.projectId, parsed.paths);
  });
  // 本机视频解码能力：渲染层探一次送进来，决定导入要不要转码（原来是 hardcode 白名单在猜）。
  ipcMain.handle("nomi:assets:report-video-codecs", async (event, payload) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as { codecs?: unknown };
    const codecs = Array.isArray(raw.codecs) ? raw.codecs.filter((c): c is string => typeof c === "string") : [];
    const { setProbedVideoCodecs } = await import("./videoPlaybackSupport");
    setProbedVideoCodecs(codecs);
  });
  // 渲染层做导入预检用的磁盘余量快照（上限从磁盘派生，不是常量）。
  ipcMain.handle("nomi:assets:storage-capacity", async (event, payload) => {
    assertTrustedUiSender(event);
    const { readStorageCapacity } = await import("./storageCapacity");
    return readStorageCapacity(String((payload as { projectId?: unknown } | null)?.projectId || ""));
  });
  ipcMain.handle("nomi:assets:copy-project-asset", async (event, payload) => {
    assertTrustedSender(event);
    const parsed = parseCopyProjectAssetPayload(payload);
    if (!parsed) throw new Error("sourceProjectId, targetProjectId and relativePath are required");
    return copyProjectAsset(parsed);
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
  // UI 面而非主窗专属：素材盒浮层窗的拖入导入走这条（同 nomi:assets:list 的理由）。
  ipcMain.handle("nomi:assets:import-file", async (event, payload) => {
    assertTrustedUiSender(event);
    const raw = (payload || {}) as Record<string, unknown>;
    // 字节通道不接受 renderer 自报路径；原生路径只能经 webUtils 桥进入下面的专用通道。
    return importAssetResult({ ...raw, sourcePath: undefined }, () => captureInteraction(event, raw));
  });
  ipcMain.handle("nomi:assets:import-native-file", async (event, payload) => {
    assertTrustedSender(event);
    return importAssetResult(payload, () => captureInteraction(event, payload), true);
  });
  ipcMain.handle("nomi:assets:import-remote-url", async (event, payload): Promise<AssetImportResult<unknown>> => {
    assertTrustedSender(event);
    try {
      const assertCurrent = captureInteraction(event, payload);
      return { ok: true, asset: await importRemoteAsset(payload, { assertCurrent }) };
    } catch (error) { return importFailure(error); }
  });
  ipcMain.handle("nomi:assets:ensure-playable", async (event, payload) => {
    assertTrustedSender(event);
    const { ensurePlayableAsset } = await import("./localFileImport");
    return ensurePlayableAsset(payload);
  });
  ipcMain.handle("nomi:assets:ensure-preview", async (event, payload) => {
    assertTrustedSender(event);
    const { ensureLocalAssetPreview } = await import("./localFileImport");
    return ensureLocalAssetPreview(payload);
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
