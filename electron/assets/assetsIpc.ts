// 素材域 IPC 注册器（2026-07-22 素材面收敛时从 main.ts 抽出,R9 巨壳门岗）：
// 文件夹读写 + 本地文件导入 + 素材下载 + 自动另存/设置（集中设置页「文件与保存」）。
import { app, clipboard, dialog, ipcMain } from "electron";
import path from "node:path";
import { assertTrustedSender, assertTrustedUiSender } from "../ipcSenderGuard";
import { getAutoSavePrefs, setAutoSavePrefs, type AutoSavePrefs } from "./downloadPrefs";
import { CLIPBOARD_FILE_PATH_FORMATS, parseClipboardFilePaths } from "./clipboardFilePaths";
import { copyProjectAsset, importRemoteAsset, type RemoteAssetImportPayload } from "./projectAssetStore";
import type { AssetImportResult } from '../shared/contracts/assetImportResult';
import type { AssetImportFailure } from '../shared/contracts/assetImportResult';
import type { ProjectInteractionCapture } from './projectInteractionCapture';
import { surfacePortFailure } from '../shared/surfacePortBinding';
import { registerOnboardingDemoAssetSourceDir } from '../onboarding/demoAssetSource';
import { createIpcRequestRegistry, type IpcRequestRegistry, type IpcRequestSender } from '../ipcRequestRegistry';
import { registerQuitDrain } from '../quitTeardown';

/**
 * 退出排空最多等多久（quitTeardown 的整个退出预算也是 3 秒，实际拿到的是剩下的那部分）。
 * 杀进程组是信号一发就生效的；要等的是 ffmpeg 真退出（不退就 250ms 后升级 SIGKILL）、半成品和临时目录删掉。
 */
const IMPORT_QUIT_DRAIN_TIMEOUT_MS = 3_000;

function importFailure(error: unknown, reason: AssetImportFailure['reason'] = 'import-failed'): AssetImportResult<never> {
  return { ok: false, failure: { code: surfacePortFailure(error).code, reason } };
}

/**
 * 导入类请求（界面导入、拷贝文件、懒自愈）都登在中立的 ipcRequestRegistry 上，不带请求号：
 * 没有渲染层撤回口，同一个窗口同时来几件互不相撤。登记里回 null = 停下；懒自愈自己会合法地回 null
 * （本就可播 / 无法处理），所以结果先装进箱子，箱子是 null 才是停下。
 */
function runImport<T>(
  imports: IpcRequestRegistry,
  sender: IpcRequestSender,
  assertCurrent: (() => void) | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<{ result: T } | null> {
  return imports.run(sender, "", assertCurrent, async (signal) => ({ result: await work(signal) }));
}

async function importAssetResult(
  payload: unknown,
  capture: () => (() => void) | undefined,
  allowSourcePath: boolean,
  imports: IpcRequestRegistry,
  sender: IpcRequestSender,
): Promise<AssetImportResult<unknown>> {
  let assertCurrent: (() => void) | undefined;
  try { assertCurrent = capture(); } catch (error) { return importFailure(error); }
  const { importLocalFile, MediaImportRejectedError, AssetImportCancelledError } = await import('./localFileImport');
  try {
    const done = await runImport(imports, sender, assertCurrent, (signal) => importLocalFile(payload, {
      allowSourcePath,
      assertCurrent,
      signal,
    }));
    if (!done) {
      // 停下了：既不是成功也不是普通失败，不发布资产。项目会话失效的话照旧抛 project_binding_stale（下面的 catch
      // 收成同样的失败回执）；否则（窗口没了 / 退出）就是「已取消」。
      assertCurrent?.();
      return importFailure(new AssetImportCancelledError());
    }
    return { ok: true, asset: done.result };
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
  const imports = createIpcRequestRegistry();
  // 退出时停导入：界面发起的导入请求（连临时目录一起收尾），加上任何一扇门起的导入转码
  // （Agent 的 asset.import 不走这张请求表）。两次调用都幂等，同一个函数按 quitTeardown 的语义登记两次：
  // · 可选项在 will-quit（退出已不可撤销）那一刻就挨着内置收尾链跑：立刻中止。必选项排在 Agent 收尾之后，
  //   而 Agent 收尾可能正等着一个在转码的导入落定——只靠必选项就互相等到期限，ffmpeg 在退出时还活着；
  // · 必选项排进串行收尾链、拖住退出：等进程真没了、半成品和临时目录真删了，最多 3 秒（退出预算封顶）。
  const stopImports = async () => {
    const requests = imports.drain();
    const { stopVideoImportTranscodes } = await import('./videoImportNormalize');
    await Promise.all([requests, stopVideoImportTranscodes()]);
  };
  registerQuitDrain('asset-import-abort', stopImports, { required: false });
  registerQuitDrain('asset-import-transcode', stopImports, { required: true, timeoutMs: IMPORT_QUIT_DRAIN_TIMEOUT_MS });
  // 随包引导示例图目录：引导 seed 与「旧项目里的构建产物地址 → 项目资产」迁移都从这里读原图。
  // 放 `resources/` 而不是 `src/`（Vite 加内容哈希，只有渲染进程算得出地址——事故起点）或 `public/`（进包两份）；
  // `resources/**` 在 package.json > build.files 里随包走，dev（仓库根）与打包版（app.asar 根）是同一条相对路径。
  // 登记的是解析函数：用到时才取 app 路径，注册本身不依赖 Electron app 已就绪。
  registerOnboardingDemoAssetSourceDir(() => path.join(app.getAppPath(), "resources", "onboarding-demo"));
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
    const { AssetImportCancelledError } = await import("./localFileImport");
    const done = await runImport(imports, event.sender, undefined, (signal) => importLocalFilePaths(parsed.projectId, parsed.paths, "asset-library", { signal }));
    // 停下 → invoke 被拒（渲染层的约定），不是一份空的成功结果。
    if (!done) throw new AssetImportCancelledError();
    return done.result;
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
    return importAssetResult({ ...raw, sourcePath: undefined }, () => captureInteraction(event, raw), false, imports, event.sender);
  });
  ipcMain.handle("nomi:assets:import-native-file", async (event, payload) => {
    assertTrustedSender(event);
    return importAssetResult(payload, () => captureInteraction(event, payload), true, imports, event.sender);
  });
  ipcMain.handle("nomi:assets:import-remote-url", async (event, payload): Promise<AssetImportResult<unknown>> => {
    assertTrustedSender(event);
    try {
      const assertCurrent = captureInteraction(event, payload);
      // 渲染层载荷不可信：expectedKind 由 importRemoteAsset 自己再读一遍，生成产物说不清就拒。
      return { ok: true, asset: await importRemoteAsset(payload as RemoteAssetImportPayload, { assertCurrent }) };
    } catch (error) { return importFailure(error); }
  });
  // 懒自愈也是导入转码那扇门：跟着发起窗口和应用退出走，同一个排空等它真停。
  ipcMain.handle("nomi:assets:ensure-playable", async (event, payload) => {
    assertTrustedSender(event);
    const { ensurePlayableAsset, AssetImportCancelledError } = await import("./localFileImport");
    const done = await runImport(imports, event.sender, undefined, (signal) => ensurePlayableAsset(payload, { signal }));
    // 停下 → invoke 被拒；「本就可播 / 无法处理」是 ensurePlayableAsset 合法回的 null，照原样交回（不是取消）。
    if (!done) throw new AssetImportCancelledError();
    return done.result;
  });
  // 补预览：带发起项目的绑定与请求号，项目关了 / 换了 / 窗口没了 / 渲染层撤了就杀掉在途 ffmpeg（中立的请求登记 ipcRequestRegistry）。
  const previewRequests = createIpcRequestRegistry();
  ipcMain.handle("nomi:assets:ensure-preview", async (event, payload) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as Record<string, unknown>;
    let assertCurrent: (() => void) | undefined;
    try { assertCurrent = captureInteraction(event, raw); } catch { return null; }
    const requestId = typeof raw.requestId === "string" ? raw.requestId.trim() : "";
    const { ensureLocalAssetPreview } = await import("./localFileImport");
    return previewRequests.run(event.sender, requestId, assertCurrent, (signal) => ensureLocalAssetPreview(raw, { signal }));
  });
  ipcMain.handle("nomi:assets:cancel-preview", (event, payload) => {
    assertTrustedSender(event);
    const requestId = typeof (payload as { requestId?: unknown } | null)?.requestId === "string" ? String((payload as { requestId: string }).requestId).trim() : "";
    return previewRequests.cancel(event.sender.id, requestId);
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
