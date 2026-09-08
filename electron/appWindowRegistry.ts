// Nomi 自有窗口登记表：**每个 BrowserWindow 的信任角色在建窗那一刻就声明清楚**，
// 之后由 IPC 守卫按角色查表，而不是在守卫里现场「猜这个发送方是不是我们自己的窗口」。
//
// 为什么必须是登记表（2026-09-08 素材盒浮层「导入恒失败 + 素材一条列不出来」根因）：
// 原来信任是在守卫里**各自再推导**一次的，两处推导用了两套不同的偶然属性——
//   · assertTrustedSender：和 getMainWindow() 比 webContents（只认主窗）
//   · assertTrustedUiSender：看发送方窗口顶层帧的 URL 是不是 file://
// 于是同一个类的三次事故：
//   ① 素材盒浮层（独立 BrowserWindow）调 nomi:assets:list / import-file / workspace:delete-files
//      过不了「只认主窗」那条 → 拖文件恒失败、素材恒空态（渲染层 catch 吞成空数组，像是真没素材）；
//   ② 浏览器 chrome 菜单窗加载的是 data:text/html，origin 是 "null" 不是 file://
//      → 它自己的 select/cancel 两条通道被守卫全打回；
//   ③ 开发模式渲染层跑在 http://127.0.0.1:5273，file:// 那条硬编码把**主窗口**也一起打回
//      → 全部 browser:* 通道在 dev 下整体失效（已实测复现）。
// 三次是同一个病：信任没有唯一 owner，每加一个窗口/换一次载入方式就得重新漏一次。
//
// 现在的规则：建窗即登记角色；没登记的窗口**一条受守卫的通道都拿不到**（fail-closed），
// 且 scripts/check-ipc-sender-binding.mjs 盯着 electron/ 里每处 `new BrowserWindow(`
// 必须在同文件登记——防线挪到「加窗口的那一刻」，不再等用户来报。
import type { BrowserWindow } from "electron";

export type AppWindowRole =
  /** 工作台主窗口：最高权限，账号/额度/供应商这类通道只认它。 */
  | "main"
  /** 我们自己建、加载我们自己页面、挂了 Nomi preload 的辅助 UI 窗（素材盒浮层、浏览器 chrome 菜单）。 */
  | "app-surface"
  /**
   * 我们建来**装第三方网页**的窗口（ComfyUI 工作流转换窗）：不挂 preload、不给任何 IPC 权限。
   * 显式登记成 untrusted 而不是干脆不登记，是要让「这个窗口不该有权限」成为写下来的决定，
   * 而不是某次漏登记的副作用——两者在代码里长得一样，在审计时含义完全相反。
   */
  | "untrusted";

type AppWindowRecord = {
  window: BrowserWindow;
  role: AppWindowRole;
  /**
   * 建窗时就知道的入口 origin；守卫要求发送帧的 origin 与它逐字相等，堵住「窗口被导航去别处」。
   * null = 以窗口自己当前 URL 的 origin 为准（主窗口用这条：它在 dev 跑 http、打包跑 file://，
   * 两种都合法，写死任何一个都会像 ③ 那样误伤自己）。
   */
  expectedOrigin: string | null;
};

const recordsByWindowId = new Map<number, AppWindowRecord>();
let mainWindowId: number | null = null;

/** file: 一律折叠成 "file://"（file URL 的 origin 各平台不一致）；解析不了 → null。 */
export function originOfUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "file:" ? "file://" : parsed.origin;
  } catch {
    return null;
  }
}

/**
 * 登记一个我们自己创建的辅助窗口。`entryUrl` 是**这个窗口即将加载的 URL**——登记时页面还没加载完，
 * getURL() 取不到，必须由建窗方交出来。窗口 closed 自动注销。
 */
export function registerAppWindow(win: BrowserWindow, role: AppWindowRole, entryUrl: string): void {
  if (win.isDestroyed()) return;
  const id = win.id;
  recordsByWindowId.set(id, { window: win, role, expectedOrigin: originOfUrl(entryUrl) });
  if (role === "main") mainWindowId = id;
  win.once("closed", () => {
    if (recordsByWindowId.get(id)?.window === win) recordsByWindowId.delete(id);
    if (mainWindowId === id) mainWindowId = null;
  });
}

/**
 * 登记/注销主窗口。与 registerAppWindow 是同一张表的两个入口，不是两套登记：
 * 主窗口由 main.ts 在建窗与 closed 时显式登记/清空（closed 里带条件判断，防窗口重建竞态误清新窗），
 * 且它的合法 origin 随运行模式变（dev http / 打包 file://），所以 expectedOrigin 留 null。
 */
export function setMainWindow(win: BrowserWindow | null): void {
  if (mainWindowId !== null) recordsByWindowId.delete(mainWindowId);
  mainWindowId = null;
  if (!win || win.isDestroyed()) return;
  mainWindowId = win.id;
  recordsByWindowId.set(win.id, { window: win, role: "main", expectedOrigin: null });
}

/** 该窗口登记的记录；没登记/已销毁 → null（守卫据此 fail-closed）。 */
export function appWindowRecordOf(win: BrowserWindow | null | undefined): AppWindowRecord | null {
  if (!win || win.isDestroyed()) return null;
  const record = recordsByWindowId.get(win.id);
  return record && record.window === win ? record : null;
}

/**
 * 仍存活的主窗口；未登记/已销毁 → null。
 *
 * 消费方是需要「可靠父窗口」的原生调用（保存/打开对话框等）：Nomi 同时开多个 BrowserWindow，
 * 用 getFocusedWindow()/getAllWindows()[0] 可能拿到辅助/短生命周期窗口，把 modal 对话框附上去
 * Windows 原生层会崩（2026-07-30 群反馈「下载文件改保存名会闪退」的根因）。拿不到则调用方走 non-modal。
 */
export function getMainWindow(): BrowserWindow | null {
  if (mainWindowId === null) return null;
  const record = recordsByWindowId.get(mainWindowId);
  if (!record || record.window.isDestroyed()) return null;
  return record.window;
}
