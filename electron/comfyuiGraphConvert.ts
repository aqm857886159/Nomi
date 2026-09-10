// ComfyUI「界面格式 → API 格式」转换（T1 · 2026-08-02 拍板）。
//
// 用户摩擦：ComfyUI 分享/保存的默认是**界面格式**（nodes[]/links[]），官方自带的 493 个模板也全是它；
// 而我们只吃 API 格式。等于用户手上的文件大半贴进来直接被拒（疑为群 #4173「就是连不上去」真凶）。
//
// 为什么借 ComfyUI 自己的前端而不是自己写转换器（2026-08-01 真机实测，非推测）：
//   自己写：14 张真实模板只对 2 张。根因是 widgets_values 数组要按节点的 widget 声明顺序映射回具名
//           输入，而 ComfyUI 有无穷多自定义 widget 类型（AUDIO_RECORD / COMFY_DYNAMICCOMBO_V3…），
//           白名单永远追不完；subgraph（节点 type 是 UUID）更是完全展不开。
//   借前端：14/14 结构全对，subgraph 自动展开（40 节点那种也行）。剩余报错全是「本机缺模型」
//           （缺件对账负责）和「模板自带示例图不在 input 目录」（Nomi 里被首帧绑定覆盖，非问题）。
//   这是 Electron 独有的结构性优势——Krita 那类 Python 插件没有浏览器，做不到这件事。
//
// 安全：隐藏窗口只加载**用户自己配置的那个 ComfyUI 地址**；不注入 preload、关 nodeIntegration、
// 开 contextIsolation；只执行一段取图的脚本，不留驻、不导航别处。
import { BrowserWindow } from "electron";
import { normalizeComfyuiBaseUrl } from "./comfyui/endpointResolver";
import { registerAppWindow } from "./appWindowRegistry";

/** 前端就绪 + 转换的总超时（首次要下载 ComfyUI 前端资源，给足）。实测冷启 ~1.5s、热 ~0.4s。 */
const CONVERT_TIMEOUT_MS = 45_000;
/** 独立 session 分区：躲开 Nomi 自己的 CSP 注入（见下方窗口创建处注释）。 */
const CONVERTER_PARTITION = "persist:comfyui-graph-convert";
/** 窗口闲置多久后关掉（连续导入多张时复用，省掉每次几秒的前端加载）。 */
const IDLE_CLOSE_MS = 60_000;

type Holder = { win: BrowserWindow; ready: Promise<boolean>; timer: NodeJS.Timeout | null };
const windowsByBase = new Map<string, Holder>();

function normalizeBase(baseUrl: string): string {
  return normalizeComfyuiBaseUrl(baseUrl);
}

function scheduleIdleClose(base: string): void {
  const holder = windowsByBase.get(base);
  if (!holder) return;
  if (holder.timer) clearTimeout(holder.timer);
  holder.timer = setTimeout(() => closeConverterWindow(base), IDLE_CLOSE_MS);
  holder.timer.unref?.();
}

export function closeConverterWindow(base: string): void {
  const holder = windowsByBase.get(normalizeBase(base));
  if (!holder) return;
  windowsByBase.delete(normalizeBase(base));
  if (holder.timer) clearTimeout(holder.timer);
  try {
    if (!holder.win.isDestroyed()) holder.win.destroy();
  } catch { /* 已销毁 */ }
}

export function closeAllConverterWindows(): void {
  for (const base of [...windowsByBase.keys()]) closeConverterWindow(base);
}

function ensureWindow(base: string): Holder {
  const existing = windowsByBase.get(base);
  if (existing && !existing.win.isDestroyed()) return existing;

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      // 只是借它的 JS 转换一次图：不给 preload、不给 node、保持隔离。
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      // ⚠️ 必须用**独立 session 分区**：Nomi 的 CSP 是 session 级注入的
      //（main.ts installContentSecurityPolicy → session.webRequest.onHeadersReceived），
      // 用默认 session 会把 Nomi 的 CSP（script-src/connect-src 白名单）强行套到 ComfyUI 网页上，
      // 它的前端根本起不来 → 转换永远超时。真机走查实测到的坑，不是理论风险。
      // 独立分区同时也把 ComfyUI 的 cookie/storage 与 Nomi 自身隔开。
      partition: CONVERTER_PARTITION,
    },
  });
  // 显式登记成 untrusted：这个窗口装的是**第三方 ComfyUI 网页**，不挂 preload、不该有任何 IPC 权限。
  // 写下来而不是「不登记」——漏登记和有意不给权限在代码里长得一样，在审计时含义相反。
  registerAppWindow(win, "untrusted", base);
  win.on("closed", () => windowsByBase.delete(base));
  // 隐藏窗口绝不能弹任何原生框：ComfyUI 前端会挂 beforeunload（「工作流未保存」）等对话框，
  // 弹出来会**卡死整个转换**且用户根本看不见（窗口是隐藏的）。全部静默放行。
  win.webContents.on("will-prevent-unload", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // 页面里的 alert/confirm/prompt 一律变成 no-op：隐藏窗口弹原生框 = 用户看不见的死锁。
  // 每次导航后都注入（did-finish-load 早于我们执行转换脚本）。
  win.webContents.on("did-finish-load", () => {
    void win.webContents
      .executeJavaScript(
        `(() => { try { window.alert = () => {}; window.confirm = () => true; window.prompt = () => null;
          window.onbeforeunload = null; } catch {} })()`,
      )
      .catch(() => undefined);
  });

  const ready = (async () => {
    try {
      await win.loadURL(`${base}/`);
      // 等 ComfyUI 前端把 app 挂到 window 上（版本差异靠能力探测，不靠版本号猜）。
      const deadline = Date.now() + CONVERT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        // 窗口被 closeConverterWindow 销毁后别再空转轮询（每 400ms 对已销毁 webContents
        // executeJavaScript，throw 被 catch 成 false，白转到 deadline）。
        if (win.isDestroyed()) return false;
        const ok = await win.webContents
          .executeJavaScript(`Boolean(window.app && window.app.graphToPrompt && window.app.loadGraphData)`)
          .catch(() => false);
        if (ok) return true;
        await new Promise((r) => setTimeout(r, 400));
      }
      return false;
    } catch {
      return false;
    }
  })();

  const holder: Holder = { win, ready, timer: null };
  windowsByBase.set(base, holder);
  return holder;
}

export type GraphConvertResult =
  | { ok: true; api: Record<string, unknown>; nodeCount: number }
  | { ok: false; error: string };

/**
 * 把界面格式 workflow 文本转成 API 格式。
 * 失败一律返回 { ok:false }（**绝不抛**）——调用方回落到既有的「请在 ComfyUI 里 Export (API)」提示，
 * 用户永远有一条能走通的路（P1：不是加逃生口，是这条转换本身就是尽力而为的增强）。
 */
export async function convertUiWorkflowToApi(baseUrl: string, uiWorkflowText: string): Promise<GraphConvertResult> {
  const base = normalizeBase(baseUrl);
  let parsed: unknown;
  try {
    parsed = JSON.parse(uiWorkflowText);
  } catch {
    return { ok: false, error: "不是合法 JSON" };
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { nodes?: unknown }).nodes)) {
    return { ok: false, error: "不是 ComfyUI 界面格式（缺 nodes 数组）" };
  }

  const holder = ensureWindow(base);
  // race 的超时 timer 必须 clear：ready 先成时留着它就是 CONVERT_TIMEOUT_MS 的空挂定时器。
  let raceTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((r) => { raceTimer = setTimeout(() => r(false), CONVERT_TIMEOUT_MS); });
  let ready: boolean;
  try {
    ready = await Promise.race([holder.ready, timeout]);
  } finally {
    clearTimeout(raceTimer);
  }
  if (!ready) {
    closeConverterWindow(base);
    return { ok: false, error: `连不上 ComfyUI 网页（${base}），无法自动转换格式` };
  }

  try {
    const raw = await holder.win.webContents.executeJavaScript(
      `(async () => {
        try {
          const ui = ${JSON.stringify(parsed)};
          await window.app.loadGraphData(ui, true, false);
          await new Promise((r) => setTimeout(r, 400));
          const p = await window.app.graphToPrompt();
          const api = (p && (p.output || p.workflow_api)) || null;
          if (!api || typeof api !== 'object') return { ok: false, error: '转换结果为空' };
          return { ok: true, api };
        } catch (e) {
          return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 200) };
        }
      })()`,
    );
    scheduleIdleClose(base);
    const result = raw as { ok?: boolean; api?: Record<string, unknown>; error?: string };
    if (!result?.ok || !result.api) return { ok: false, error: result?.error || "转换失败" };
    const nodeCount = Object.keys(result.api).length;
    if (nodeCount === 0) return { ok: false, error: "转换结果没有任何节点" };
    return { ok: true, api: result.api, nodeCount };
  } catch (e) {
    scheduleIdleClose(base);
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200) };
  }
}

/** 纯函数（可单测）：这段文本看起来是不是「界面格式」——决定要不要试转换。 */
export function looksLikeUiWorkflow(text: string): boolean {
  try {
    const json = JSON.parse(text) as { nodes?: unknown; links?: unknown };
    return Array.isArray(json?.nodes) || Array.isArray(json?.links);
  } catch {
    return false;
  }
}
