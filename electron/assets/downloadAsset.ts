// 把生成结果（本地 nomi-local 资源 或 远端 http(s) 链接）另存到用户选定位置，默认落「下载」目录。
// 统一一条下载路径：图片/视频/素材都走这里（按 url 协议取字节，不为不同类型分叉）。从 main.ts 抽出（规则 12 巨壳净减）。
import { app, dialog } from "electron";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolveProjectRelativePath } from "../projects/repository";
import { logBreadcrumb, logCrash } from "../crashLog";
import { hardenedFetch } from "../hardenedFetch";
import { getLastDownloadDir, pickDownloadDir, rememberDownloadDir } from "./downloadPrefs";

function isDirectory(dir: string): boolean {
  try {
    return existsSync(dir) && statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export function sanitizeDownloadName(name: string): string {
  // 去控制字符（\p{Cc} 含 0x00-0x1F/0x7F-0x9F）+ 文件系统非法字符；折叠空白。保留中英文/数字/连字符。
  let s = name.replace(/\p{Cc}/gu, "").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
  // Windows：文件名不能以「.」或空格结尾——否则原生保存对话框拿 defaultPath 时可能异常（闪退面之一）。
  s = s.replace(/[. ]+$/g, "").trim();
  // Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）整段占用即非法 → 加前缀避开。
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s)) s = `_${s}`;
  return s.slice(0, 120);
}

/** 取资产字节（本地 nomi-local 读盘 / 远端 http(s) 下载）。下载与自动另存共用单一真相，不各抄一份。 */
export async function fetchAssetBytes(rawUrl: string): Promise<Buffer> {
  if (rawUrl.startsWith("nomi-local://")) {
    const url = new URL(rawUrl);
    const [projectId, ...relativeParts] = decodeURIComponent(url.pathname.replace(/^\/+/, "")).split("/");
    return readFile(resolveProjectRelativePath(projectId, relativeParts.join("/")));
  }
  if (/^https?:/i.test(rawUrl)) {
    // Provider result URLs must use the same proxy-aware, bounded, SSRF-safe
    // route as generation localization. Electron's net.fetch follows the
    // Chromium session, while production generation uses the app-owned
    // undici route; splitting them made a result downloadable in one path but
    // unreachable in auto-save/manual download when a fake-IP proxy was active.
    // Keep the URL policy and byte limits identical for every remote asset.
    const fetched = await hardenedFetch(rawUrl, {
      timeoutMs: 60_000,
      maxBytes: 200 * 1024 * 1024,
    });
    return fetched.bytes;
  }
  throw new Error("不支持的资源地址");
}

// 同一时刻只允许一个保存对话框。对话框不再 modal（见下方根因注释），系统不会再替我们挡住
// 第二次点击；没有这个闸，连点两次下载会开出两个原生对话框叠在一起。
let saveDialogInFlight = false;

export async function downloadAssetToDisk(
  payload: { url?: unknown; suggestedName?: unknown } | null,
): Promise<{ ok: boolean; canceled?: boolean; path?: string }> {
  const rawUrl = String(payload?.url || "").trim();
  if (!rawUrl) throw new Error("url is required");
  if (saveDialogInFlight) return { ok: false, canceled: true };
  const bytes = await fetchAssetBytes(rawUrl);
  const fallbackExt = (() => {
    try {
      const ext = path.extname(new URL(rawUrl).pathname);
      return ext && ext.length <= 6 ? ext : "";
    } catch {
      return "";
    }
  })();
  let suggested = sanitizeDownloadName(String(payload?.suggestedName || ""));
  if (!suggested) suggested = `nomi-asset${fallbackExt || ".bin"}`;
  else if (!path.extname(suggested) && fallbackExt) suggested += fallbackExt;
  // 默认目录：上次另存到的目录（仍存在）优先，否则系统下载夹——省得每次手动导航（fb-20260724）。
  const baseDir = pickDownloadDir(getLastDownloadDir(), app.getPath("downloads"), isDirectory);
  // 永不给原生保存对话框传父窗口——这是本文件唯一一条铁律，别再"优化"回去。
  //
  // 根因（2026-08-12「Windows 上改保存名闪退，搜狗输入法必崩、微软拼音不崩」）：Electron 把原生
  // 文件对话框跑在**自己的专用 COM STA 线程**上（dialog_thread.cc: CreateCOMSTATaskRunner + DEDICATED），
  // 而我们传进去的父窗口 HWND 属于**主 UI 线程**——于是 IFileDialog::Show(parent) 造出一个「跨线程持有
  // 属主」的模态对话框，两个线程的输入队列被 Windows 绑到一起。第三方中文输入法（搜狗）的 DLL 被 TSF
  // 注入进本进程后，会在 TranslateMessage 里调 PeekMessage，从而在别人的线程上处理跨线程 sent message，
  // 撞上微软自己记录在案的 IME 重入崩溃（learn.microsoft.com/troubleshoot/windows/win32/
  // ime-crash-processing-cross-thread-sent-message）。微软拼音走的路径不同，所以不崩——但这不代表
  // 是"搜狗的问题"：跨线程模态属主是我们造的，输入法只是把它引爆的那一下。
  //
  // 上一轮（2026-07-30）只把父窗口从"辅助窗"换成"可靠主窗口"，没有去掉**跨线程持有属主**这件事本身，
  // 所以这一类崩溃活了下来。不传父窗口 → Show(nullptr) → 没有跨线程属主、没有输入队列绑定，
  // 也与本仓库其余所有对话框保持同一条路径（workspaceIpc / projectLocationIpc / assetsIpc 一直如此）。
  // 代价：对话框不再 modal，用上面的 saveDialogInFlight 单飞闸补住"连点开两个"。
  //
  // try/catch 只能兜 JS 异常：原生 access violation 不走 JS，进程会直接消失。所以前后各打一条同步
  // 面包屑——万一还崩，日志最后一行停在 open 就能锤死"崩在原生对话框里"，配 Crashpad minidump 看模块名。
  const dialogOptions = { defaultPath: path.join(baseDir, suggested) };
  saveDialogInFlight = true;
  logBreadcrumb("assets:download", `save-dialog:open name=${suggested}`);
  try {
    const result = await dialog.showSaveDialog(dialogOptions);
    logBreadcrumb("assets:download", `save-dialog:closed canceled=${result.canceled}`);
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await mkdir(path.dirname(result.filePath), { recursive: true }).catch(() => undefined); // 目标目录兜底
    await writeFile(result.filePath, bytes);
    rememberDownloadDir(path.dirname(result.filePath)); // 记住这次目录，下次默认弹到这里
    return { ok: true, path: result.filePath };
  } catch (error) {
    logCrash("assets:download", error);
    return { ok: false };
  } finally {
    saveDialogInFlight = false;
  }
}
