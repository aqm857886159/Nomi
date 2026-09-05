// 主进程日志的**唯一出口**。
//
// 在这之前，主进程里 99 处 `console.error/warn/log` 只写进 stdout——开发时终端能看到，
// 打包成 .app 双击启动后没有任何地方接住它，进程一退就没了。于是「不崩溃的失败」
// （模型调不通、导出中途放弃）这一整档在用户机器上是**零证据**的，而它恰好是用户报障的大头。
//
// 这个模块把那 99 处收进一个出口，并顺手把「日志不能变成新的隐私泄漏面」这件事
// 做进 API 形状里（R28：防线建在最早能拦住的那层）：
//
//   · `event` 是**短标识**，不是自由文本——调用点写 `"ffmpeg-exit"`，不是拼一句话；
//   · `fields` 只收标量，且每个字段名都过黑名单（`redact.ts`）——想记提示词的调用点
//     拿到的是 `<omitted:prompt>`，不是提示词；
//   · 供应商调用走 `logVendorCall`，它只有六个字段（供应商/模型/状态/耗时/花费/请求 id）。
//     请求体、响应体、素材 URL **没有参数位可以进来**。
//
// 落盘细节（按天、大小上限、保留期）在 `logFiles.ts`——那是仓库里唯一一份文件写手，
// 崩溃道（`crashLog.ts`）与本模块共用它。
import { app } from "electron";
import path from "node:path";
import {
  createLogFileSink,
  dailyLogFileName,
  DAILY_LOG_MAX_BYTES,
  LOG_RETENTION_DAYS,
  logsDir,
  pruneExpiredLogs,
  type LogFileSink,
} from "./logFiles";
import { capLogLine, redactError, redactField, redactLogValue } from "./redact";

/**
 * 模块域。刻意是**闭合**的：开放的 string 会让日志里长出 30 个拼法各异的同义域
 * （`vendor` / `Vendor` / `vendors` / `[vendor]`），grep 时谁也数不清一共有几类。
 * 加一个域 = 在这里加一行，改动是显式的。
 */
export type LogScope =
  | "main"
  | "window"
  | "update"
  | "catalog"
  | "vendor"
  | "ai"
  | "agent"
  | "mcp"
  | "capability"
  | "production-run"
  | "export"
  | "assets"
  | "tasks"
  | "browser"
  | "screenshot"
  | "workspace"
  | "review"
  | "events"
  | "onboarding"
  | "proxy"
  | "crash"
  | "diagnostics";

/**
 * 字段值只收标量。收 `unknown` 或 `object` 就等于开了一个「把整个请求体 JSON 进来」的口子，
 * 那正是本模块要堵的东西。
 */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export type LogLevel = "INFO" | "WARN" | "ERROR";

/**
 * 供应商调用的**全部**可记内容。这是一个封闭结构体而不是 `LogFields`：
 * 排查供应商问题真正需要的就是这六项，多给一个自由字段就会有人把响应体塞进来。
 */
export type VendorCallSummary = {
  /** 供应商 key（`apimart` / `kie` / `comfyui-local`…），不是 base URL。 */
  vendor: string;
  /** 模型 key（`seedance-1-0-pro`…）。 */
  model: string;
  /** HTTP 状态码，或非 HTTP 的收场方式。 */
  status: number | "error" | "timeout" | "canceled";
  /** 耗时（毫秒）。 */
  ms: number;
  /** 供应商侧请求 id——对方查日志要的就是这个。 */
  requestId?: string;
  /** 这次调用的花费（美元）。 */
  costUsd?: number;
  /** 第几次尝试（重试链路的排查靠它）。 */
  attempt?: number;
};

let sink: LogFileSink | null = null;

function ensureSink(): LogFileSink {
  if (sink) return sink;
  sink = createLogFileSink({
    resolvePath: () => path.join(logsDir(), dailyLogFileName(new Date())),
    maxBytes: DAILY_LOG_MAX_BYTES,
    rotate: "archive",
    // 换到新文件（首次写入 / 跨天 / 滚动）时顺手清过期的：不另起定时器，
    // 定时器在一个「用完就关」的桌面 app 里多半等不到触发。
    onNewFile: (file) => {
      pruneExpiredLogs(path.dirname(file), LOG_RETENTION_DAYS, new Date());
    },
  });
  return sink;
}

/**
 * 读不到 `app`（单测把 electron 整个 mock 掉）时按「已打包」处理——保守的一侧是
 * **不往 stderr 喷**：真实 dev 里 app.isPackaged 永远读得到，读不到就说明这不是 dev 终端。
 */
function isPackaged(): boolean {
  try {
    return app.isPackaged !== false;
  } catch {
    return true;
  }
}

/**
 * 开发态把日志同时喷到 stderr —— 收口 console.* 不该让开发时的终端变哑。
 * 用 `process.stderr.write` 而不是 `console.*`：后者被 `check:main-console` 硬零拦着，
 * 而这里正是那条规则唯一该有的例外（它就是那个出口本身）。
 */
function mirrorToStderr(line: string): void {
  if (isPackaged() && process.env.NOMI_LOG_STDERR !== "1") return;
  try {
    process.stderr.write(`${line}\n`);
  } catch {
    /* stderr 坏掉（EIO/EPIPE）本身就是常见崩溃源，绝不能因为写它失败而再抛一次 */
  }
}

function formatFields(fields?: LogFields): string {
  if (!fields) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    parts.push(`${key}=${redactField(key, value)}`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function write(level: LogLevel, scope: LogScope, event: string, fields?: LogFields, error?: unknown): void {
  // 落盘与 stderr 共用同一份**已脱敏**文本：两条通路一旦各自格式化，就会有一条先漂移，
  // 而漂移的那条多半是没人看的那条（开发时看 stderr，出事时看文件）。
  const detail = `${redactLogValue(event)}${formatFields(fields)}${error === undefined ? "" : ` ${redactError(error)}`}`;
  ensureSink().append(capLogLine(`${level.padEnd(5)} ${scope.padEnd(14)} ${detail}`));
  mirrorToStderr(`[nomi:${scope}] ${detail}`);
}

export function logInfo(scope: LogScope, event: string, fields?: LogFields): void {
  write("INFO", scope, event, fields);
}

export function logWarn(scope: LogScope, event: string, fields?: LogFields, error?: unknown): void {
  write("WARN", scope, event, fields, error);
}

/**
 * `error` 单独一个参数：它要走 `redactError`（逐帧剥掉绝对路径），不能混进 fields。
 * 参数顺序按各自的主用法排：错误道最常只带一个 error，警告道最常只带字段。
 */
export function logError(scope: LogScope, event: string, error?: unknown, fields?: LogFields): void {
  write("ERROR", scope, event, fields, error);
}

/**
 * 开发态诊断：**只喷 stderr，永不落盘**。
 *
 * 给那一族「在终端里有用、但不该留在用户硬盘上」的输出用——渲染层 console 转发（自由文本，
 * 可能带用户输入）、userData 目录与 dev server URL（本机路径）。它们从前是 `console.log`，
 * 打包后本来就没人接；把它们塞进日志文件反而会开一个新的隐私口子，所以这条通路刻意到此为止。
 * 打包版里整条是空操作。
 */
export function logDevDetail(scope: LogScope, detail: string): void {
  if (isPackaged()) return;
  try {
    process.stderr.write(`[nomi:${scope}] ${detail}\n`);
  } catch {
    /* stderr 坏掉时不再抛 */
  }
}

export function logVendorCall(summary: VendorCallSummary): void {
  const failed = typeof summary.status === "number" ? summary.status >= 400 : true;
  write(failed ? "WARN" : "INFO", "vendor", "call", {
    vendor: summary.vendor,
    model: summary.model,
    status: summary.status,
    ms: Math.round(summary.ms),
    ...(summary.attempt === undefined ? {} : { attempt: summary.attempt }),
    ...(summary.costUsd === undefined ? {} : { cost: summary.costUsd.toFixed(4) }),
    // 供应商侧请求 id 不是我们的凭据，但它够长会被密钥形规则吃掉——留前 12 位足够对账。
    ...(summary.requestId ? { req: summary.requestId.slice(0, 12) } : {}),
  });
}

/** 当前正在写哪个文件（诊断包与走查用）。 */
export function currentLogFile(): string {
  return ensureSink().currentFile();
}

/**
 * 启动时调一次：把当天文件建出来、写下会话表头、清掉过期文件。
 * 不做这一步的话，一个从头到尾没出过错的会话在盘上一行记录都没有——
 * 用户报「什么都没发生」时，我们连"他到底起没起来"都答不出。
 */
export function installMainLogger(): void {
  logInfo("main", "session-start", {
    version: safeVersion(),
    electron: process.versions.electron ?? "?",
    platform: `${process.platform}-${process.arch}`,
  });
}

function safeVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return "unknown";
  }
}
