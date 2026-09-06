// 生产崩溃落盘（多维审计 P0-8）：主进程未捕获异常与
// 渲染层崩溃统一落到 app logs 目录，省得用户报"打不开"时无任何日志可查（盲修）。
//
// 三层证据，缺一层就有整类崩溃是「黑的」（2026-08-12 Windows 改保存名闪退时我们手上零信息）：
//   ① JS 异常 → uncaughtExceptionMonitor（installCrashHandlers）；
//   ② 子进程/渲染进程死亡 → render-process-gone / child-process-gone（installProcessGoneHandlers）；
//   ③ 原生层崩溃（第三方 DLL、原生对话框线程）→ Crashpad minidump（startNativeCrashCapture）+
//      面包屑（logBreadcrumb）。原生 access violation 不是 JS 异常，①②都拦不到、进程直接消失，
//      唯一线索是「日志最后一行停在哪」和 minidump 里的模块名。
import { app, crashReporter } from "electron";
import path from "node:path";
import { CRASH_LOG_FILE_NAME, createLogFileSink, logsDir } from "./logging/logFiles";
import { logError } from "./logging/logger";
import { redactError, redactLogValue } from "./logging/redact";

const MAX_BYTES = 2 * 1024 * 1024; // 2MB 简单滚动

/**
 * 崩溃道的写手。滚动/表头/吞异常这套机制**共用** `logging/logFiles.ts` 那一份
 * （P1：仓库里只有一个文件写手），这里只声明本道特有的三件事：
 *   · 独立文件 `nomi-crash.log`——崩溃证据要能一眼找到，不跟通用日志混在按天文件里；
 *   · 2MB 到顶**就地清空**（不是改名留一代）：这条道要的是"最后发生了什么"，
 *     旧的那一代对定位当前崩溃没有价值，留着只会在用户硬盘上白占一份；
 *   · 同步 append——原生崩溃会把进程直接带走，异步写在那一刻就丢了（见文件顶部第 ③ 层）。
 */
const crashSink = createLogFileSink({
  resolvePath: () => path.join(logsDir(), CRASH_LOG_FILE_NAME),
  maxBytes: MAX_BYTES,
  rotate: "truncate",
});

function append(line: string): void {
  crashSink.append(line);
}

/**
 * 落盘前过一遍 `logging/redact`：栈里**全是**绝对路径
 * （`/Users/<人名>/…` / `/Applications/Nomi.app/Contents/…`），而崩溃日志是要进诊断包、
 * 由用户发给我们的。帧里真正指认崩点的是文件名与行号，不是它装在谁的硬盘哪个目录下。
 * 2026-09-06 走查实测：不脱敏时，一次隔离实例的导出里出现了另一台 worktree 的完整路径。
 */
function recordCrash(scope: string, error: unknown): void {
  append(`[${scope}] ${redactError(error)}`);
}

export function logCrash(scope: string, error: unknown): void {
  recordCrash(scope, error);
  // 崩溃道之外再进一次通用日志：排查时想看的是「崩之前那几分钟发生了什么」，
  // 而那条时间线在通用日志里。从前这里是 console.error，打包后没人接（P1 删旧）。
  logError("crash", scope, error);
}

/**
 * 面包屑：进入/离开「可能把整个进程带走」的原生调用时各记一笔。
 *
 * 为什么必须有：原生崩溃（access violation）不走 JS，try/catch 和 uncaughtExceptionMonitor 都拦不到，
 * 进程直接消失——事后唯一能指认崩点的证据就是「日志最后一行停在哪」。必须同步落盘
 * （append 用 appendFileSync），异步写在进程被带走的那一刻会丢。
 */
export function logBreadcrumb(scope: string, detail: string): void {
  append(`[${scope}] ${redactLogValue(detail)}`);
}

export type ProcessGoneTarget = {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
};

type GoneDetails = {
  reason?: string;
  exitCode?: number;
  type?: string;
  name?: string;
  serviceName?: string;
};

/**
 * 渲染进程/子进程（GPU、utility、network service…）死亡落盘。
 *
 * 装在 app 上而不是某个 webContents 上：辅助窗口（浏览器菜单/叠加窗）的渲染进程一样会死，
 * 挂单个窗口会漏掉它们。这两个事件不代表主进程还活着——但只要它们先落了盘，
 * 「app 整个没了」就能区分是渲染层先死还是主进程原生崩溃。
 */
export function installProcessGoneHandlers(
  // 默认就是 Electron 的 app。这里必须 cast：Electron 把 app.on 声明成上百条按事件名字面量重载，
  // 结构类型表达不出来（写成 (event: string, …) 会反过来不被 App 满足）。单测注入自己的假 target。
  target: ProcessGoneTarget = app as unknown as ProcessGoneTarget,
  // 默认走 logCrash（落盘 + console）：这里主进程本身是健康的，不像 uncaughtExceptionMonitor
  // 那样要防"stderr 已经坏了"，开发时直接在终端看到进程死因更省事。
  record: CrashRecorder = logCrash,
): void {
  target.on("render-process-gone", (...args: unknown[]) => {
    const details = (args[2] ?? {}) as GoneDetails;
    record("render-process-gone", `reason=${details.reason ?? "?"} exitCode=${details.exitCode ?? "?"}`);
  });
  target.on("child-process-gone", (...args: unknown[]) => {
    const details = (args[1] ?? {}) as GoneDetails;
    const name = details.serviceName || details.name || "-";
    record(
      "child-process-gone",
      `type=${details.type ?? "?"} name=${name} reason=${details.reason ?? "?"} exitCode=${details.exitCode ?? "?"}`,
    );
  });
}

export type NativeCrashReporter = { start(options: { uploadToServer: boolean }): void };

/**
 * 开 Crashpad：原生层崩溃（第三方输入法 DLL、GPU、原生对话框线程）只有 minidump 能留下
 * 「崩在哪个模块」。本地留证不外传（uploadToServer:false），dump 落 app.getPath("crashDumps")。
 * 必须在 app ready 之前调用，否则装不上。
 */
export function startNativeCrashCapture(reporter: NativeCrashReporter = crashReporter): void {
  try {
    reporter.start({ uploadToServer: false });
  } catch {
    /* 崩溃采集起不来也不能拖垮启动 */
  }
}

export type CrashMonitorTarget = {
  on(
    event: "uncaughtExceptionMonitor",
    listener: (error: Error, origin: string) => void,
  ): unknown;
};

export type CrashRecorder = (scope: string, error: unknown) => void;

export function installCrashHandlers(
  target: CrashMonitorTarget = process,
  record: CrashRecorder = recordCrash,
): void {
  // 只观察、不接管：Node 会在 monitor 之后保持默认的非零退出。
  // 这里绝不能 console.*；stderr/stdout 本身损坏（EIO/EPIPE）正是常见崩溃源，
  // 再写一次会让崩溃处理器递归触发。
  target.on("uncaughtExceptionMonitor", (error, origin) => record(origin, error));
}

/**
 * 「响应流拆除竞态」——undici（Node 内置 fetch 的实现）在拆除响应流时，把**已经关掉的**
 * controller 再关一次，抛出 ERR_INVALID_STATE。
 *
 * 为什么必须在这一层认它，而不是去 call site 修：这个抛发生在 undici 内部的 microtask 里，
 * 那时 promise 早已 settle、'error' 监听也已摘掉 —— **call site 的 try/catch 根本抓不到**
 * （nodejs/undici#1564、#5586；Next.js/Hono/Remix 都撞过同一条）。我们主进程这边所有 fetch
 * 都已经规规矩矩地消费完 body、带 AbortSignal（2026-08-24 全量走查过一遍），改不出这个毛病来。
 * 真正的根治是升 Electron（换掉捆绑的 undici），那是另一件事，不该塞进一个用户反馈修复里。
 *
 * 判据刻意收得很窄，只认「全栈都在 Node 内部的流拆除」：
 *   ① code === ERR_INVALID_STATE；② 栈里出现 webstreams/undici；
 *   ③ **每一帧都是 node: 内建模块**——只要出现一帧我们自己的代码，就说明是**我们**把流关了两次，
 *      那是真 bug，必须照旧弹框给我们看，绝不能被这条顺手吞掉。
 *      注意不能写成 `node:internal/`：真实栈里混着 `node:async_hooks` 这种**没有 internal 段**的内建模块
 *      （用户那条栈第 4 帧就是），写窄了会把要认的那一条漏掉——单测里钉的就是逐字照抄的那份栈。
 */
const NODE_BUILTIN_FRAME = /(?:\(node:|^at node:)/;

export function isUpstreamStreamTeardownError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ((error as NodeJS.ErrnoException).code !== "ERR_INVALID_STATE") return false;
  const frames = (error.stack || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "));
  if (frames.length === 0) return false;
  if (!frames.some((f) => f.includes("node:internal/webstreams/") || f.includes("undici"))) return false;
  return frames.every((f) => NODE_BUILTIN_FRAME.test(f));
}

export type UncaughtExceptionTarget = {
  on(event: "uncaughtException", listener: (error: Error, origin: string) => void): unknown;
  removeListener(event: "uncaughtException", listener: (error: Error, origin: string) => void): unknown;
  emit(event: "uncaughtException", error: Error, origin: string): unknown;
};

/**
 * 把上面那一类上游噪音挡在崩溃弹框之外 —— **只挡弹框，不改存活语义**。
 *
 * 先说清今天真实发生了什么（查过 Electron v31.7.7 lib/browser/init.ts 才敢写）：主进程未捕获异常
 * 走的是 Electron 自带的 uncaughtException 处理器，它 `dialog.showErrorBox` 弹一个
 * 「A JavaScript error occurred in the main process」，**然后不调用 process.exit()**——进程接着跑。
 * 所以这类异常**从来就不是致命的**，用户原话也印证：「确定后，可以正常用」。唯一的伤害就是那个吓人的模态框，
 * 而它挡在一个后台排队探针的库内部竞态前面，用户既看不懂也无从下手。
 *
 * 于是这里只做一件事：认得的那一类 → 落盘留证、不弹框；**其余一律原样交回 Electron 的默认路径**
 * （照弹、照记、照跑），行为与今天逐字一致。之所以是「摘掉自己再 emit」而不是自己弹一个框：
 * Electron 的处理器开头有 `if (process.listenerCount('uncaughtException') > 1) return`——只要我们挂着，
 * 它就不弹了。摘掉后 emit，计数回到 1，弹的是**它自己那个框**，我们不复制第二份弹框逻辑（P1 无并行版）。
 * 那个 listenerCount 判定在处理器入口同步跑完，所以 emit 之后立刻把自己装回来是安全的，下一次照守。
 */
export function installUncaughtExceptionNoiseFilter(
  target: UncaughtExceptionTarget = process,
  record: CrashRecorder = recordCrash,
): void {
  const handler = (error: Error, origin: string): void => {
    if (isUpstreamStreamTeardownError(error)) {
      // 留证：不弹框不等于当没发生过。它要是变多了，得能在 nomi-crash.log 里看出来。
      record("uncaughtException:upstream-stream-teardown", error);
      return;
    }
    target.removeListener("uncaughtException", handler);
    try {
      target.emit("uncaughtException", error, origin);
    } finally {
      target.on("uncaughtException", handler);
    }
  };
  target.on("uncaughtException", handler);
}
