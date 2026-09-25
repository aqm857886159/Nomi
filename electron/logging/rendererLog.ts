// 渲染层失败证据的主进程入口 —— 渲染层 → 主进程日志**唯一**的一条通道（`nomi:log:renderer`）。
//
// 2026-09-24 Windows 用户的诊断包里只有主进程日志：界面上弹的是「项目保存失败」，真实原因
// （`WorkspaceManifestLockBusyError`）只进了渲染层 console——打包版里没人接，包里一个字都没有。
// 渲染层所有「失败了」的证据都经 `src/desktop/rendererLog.ts` 走到这里，再落进同一份按天日志。
//
// 这一层只做三件事，脱敏规则一条都不另写（复用 `redact.ts`，P1）：
//   ① **形状校验**：事件名、字段名、字段值都是封闭形状；不合格整条拒收，记一行 `renderer-log-rejected`
//      ——拒收也要留痕，不然「为什么这条没进来」又是一个查不到的问题。
//   ② **限流**：IPC 是信任边界，而每一行都是主进程上一次同步写盘。渲染层某个 effect 一旦进了循环，
//      console.error 只是刷屏，这里会变成主进程卡顿 + 把当天日志挤满。每个事件每分钟最多 20 行、
//      全部事件合计 200 行；超了只记一行 `renderer-log-suppressed`。**按事件分开计数**是有意的：
//      一批坏图片刷 `image-load-failed` 时，同一分钟里那一行 `project-save-failed` 不能被挤掉——那才是要的证据。
//   ③ **分级落盘**：warn / error 进通用日志（scope=renderer）；crash 走崩溃道（崩溃文件 + 通用日志）。
import { z } from "zod";
import { logCrash } from "../crashLog";
import { logError, logWarn, type LogFields } from "./logger";
import {
  RENDERER_LOG_EVENT_PATTERN,
  RENDERER_LOG_FIELD_KEY_PATTERN,
  RENDERER_LOG_MAX_FIELDS,
  RENDERER_LOG_MAX_TEXT_CHARS,
  type RendererLogEntry,
  type RendererLogError,
} from "../shared/contracts/rendererLog";

export const RENDERER_LOG_CHANNEL = "nomi:log:renderer";

const WINDOW_MS = 60_000;
const MAX_LINES_PER_EVENT = 20;
const MAX_LINES_TOTAL = 200;

const text = z.string().max(RENDERER_LOG_MAX_TEXT_CHARS);

/** 渲染层来的报文不可信：按封闭形状收，任何一项不合格就整条拒收（不做「能收多少收多少」）。 */
const rendererLogEntrySchema: z.ZodType<RendererLogEntry> = z.object({
  level: z.enum(["warn", "error", "crash"]),
  event: z.string().regex(RENDERER_LOG_EVENT_PATTERN),
  error: z.object({ name: text, message: text, code: text.optional(), stack: text.optional() }).optional(),
  fields: z
    .record(z.string().regex(RENDERER_LOG_FIELD_KEY_PATTERN), z.union([text, z.number().finite(), z.boolean(), z.null()]))
    .refine((fields) => Object.keys(fields).length <= RENDERER_LOG_MAX_FIELDS)
    .optional(),
});

/** 拒收原因取第一处不合格的顶层字段（`bad-event` / `bad-fields`…），整条不是对象就是 `bad-entry`。 */
export function parseRendererLogEntry(raw: unknown): { ok: true; entry: RendererLogEntry } | { ok: false; reason: string } {
  const parsed = rendererLogEntrySchema.safeParse(raw);
  if (parsed.success) return { ok: true, entry: parsed.data };
  const field = parsed.error.issues[0]?.path[0];
  return { ok: false, reason: field === undefined ? "bad-entry" : `bad-${String(field)}` };
}

/**
 * 摊平的错误 → 一个 Error，交给 `redactError` 按主进程同一套规则脱敏（名字、码、逐帧剥路径）。
 * `stack` 必须整条覆盖：留着 `new Error()` 自带的栈，日志里就会出现**主进程这里**的帧，看着像是在主进程出的事。
 */
function toLoggableError(error: RendererLogError): Error {
  const loggable = new Error(error.message);
  loggable.name = error.name;
  loggable.stack = error.stack ?? `${error.name}: ${error.message}`;
  if (error.code !== undefined) Object.assign(loggable, { code: error.code });
  return loggable;
}

function writeEntry(entry: RendererLogEntry): void {
  const error = entry.error ? toLoggableError(entry.error) : undefined;
  const fields: LogFields | undefined = entry.fields;
  if (entry.level === "warn") logWarn("renderer", entry.event, fields, error);
  else if (entry.level === "error") logError("renderer", entry.event, error, fields);
  else logCrash(`renderer:${entry.event}`, error ?? "(no error object)", fields);
}

/**
 * 一个带限流状态的记录器：按整分钟分桶，一分钟一换、旧桶整个丢掉（计数表只装得下这一分钟放进来的事件，
 * 最多 200 个名字，不会被渲染层撑爆）。导出工厂而不是单例：单测要能拿到干净的计数与假时钟。
 */
export function createRendererLogRecorder(now: () => number = Date.now): (raw: unknown) => void {
  let minute = Number.NaN;
  let total = 0;
  let perEvent = new Map<string, number>();
  let announced = new Set<string>();

  const admit = (key: string): boolean => {
    const current = Math.floor(now() / WINDOW_MS);
    if (current !== minute) {
      minute = current;
      total = 0;
      perEvent = new Map();
      announced = new Set();
    }
    const count = perEvent.get(key) ?? 0;
    const overTotal = total >= MAX_LINES_TOTAL;
    if (count < MAX_LINES_PER_EVENT && !overTotal) {
      perEvent.set(key, count + 1);
      total += 1;
      return true;
    }
    // 每分钟对每个桶只说一次「后面的被略掉了」，不然这一行本身又成了刷屏。
    const bucket = overTotal ? "*" : key;
    if (!announced.has(bucket)) {
      announced.add(bucket);
      logWarn("renderer", "renderer-log-suppressed", {
        event: bucket,
        limit: overTotal ? MAX_LINES_TOTAL : MAX_LINES_PER_EVENT,
        windowMs: WINDOW_MS,
      });
    }
    return false;
  };

  return (raw) => {
    const parsed = parseRendererLogEntry(raw);
    if (!admit(parsed.ok ? parsed.entry.event : "renderer-log-rejected")) return;
    if (parsed.ok) writeEntry(parsed.entry);
    else logWarn("renderer", "renderer-log-rejected", { reason: parsed.reason });
  };
}

/** IPC 边界形状：ipcMain.on 与 sender 守卫作为注入面，单测不引 electron。 */
export type RendererLogIpcBoundary<E = unknown> = {
  onMessage: (channel: string, handler: (event: E, message: unknown) => void) => void;
  assertTrusted: (event: E) => void;
};

/**
 * 主窗口与挂 Nomi preload 的辅助窗都可报，但都要过 sender 守卫——任何挂 preload 的窗口
 * 都能往这里发，不守就是一个可以无限刷写日志的口子。
 * 注册住在这里而非 main.ts：main.ts 是已知巨壳，门岗只减不增。
 */
export function registerRendererLogIpc<E>(
  boundary: RendererLogIpcBoundary<E>,
  record: (raw: unknown) => void = createRendererLogRecorder(),
): void {
  boundary.onMessage(RENDERER_LOG_CHANNEL, (event, message) => {
    boundary.assertTrusted(event);
    record(message);
  });
}
