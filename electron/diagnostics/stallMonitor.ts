// 主进程卡顿监视器：把「主进程那一刻堵了多久」记进本机时间线（`stallTimeline.ts`）。
//
// 量具是 Node 标准的 `perf_hooks.monitorEventLoopDelay`（直方图本身不自写，P0）；这里自写的只有
// 领域归因——把停顿挂到 Nomi 的「所在页 / 有没有生成在跑 / 节点数档位」上，并管三件事：
// 睡眠唤醒不算卡顿、启动期不算、窗口无响应 / 恢复各记一行。
//
// 采样间隔取 80ms，不是 20ms：真 Electron 主进程里每次采样要唤醒两个线程（libuv 轮询线程 + 主线程），
// 20ms 实测空闲 60 秒多吃约 0.43 个百分点 CPU、每秒多 94 次空闲唤醒，超了预算（0.2 / 50）；64ms 十次实测中位 0.17、
// 最大 0.205，贴着预算；80ms 留出余量（设计卡 ★7）。直方图记录的是「相邻两次采样的间隔」，含采样间隔本身，所以时长取
// 「最大间隔 − 半个间隔」（无偏估计，误差约 ±40ms）：≥140ms 的停顿必记，100ms 左右约一半，文案一律写「约 100ms 以上」。
import { monitorEventLoopDelay } from "node:perf_hooks";
import { app, powerMonitor } from "electron";
import { z } from "zod";
import { assertTrustedFireAndForget } from "../ipcSenderGuard";
import { PERF_FIELD_VALUES } from "../shared/contracts/perfTelemetry";
import {
  STALL_MAX_MS,
  STALL_RENDERER_FRAME_MIN_MS,
  STALL_REPORT_CHANNEL,
  STALL_SAMPLE_INTERVAL_MS,
  STALL_REPORT_MAX_FRAMES,
  type StallReport,
  type StallScene,
} from "../shared/contracts/stallTimeline";
import { createStallTimeline, createStallTimelineAppend, type StallTimeline } from "./stallTimeline";

export { STALL_SAMPLE_INTERVAL_MS };
export const STALL_READ_INTERVAL_MS = 10_000;
/** 估计时长到这个数才记一行；到下一个数标冻结。 */
export const STALL_RECORD_MIN_MS = 100;
export const STALL_FREEZE_MIN_MS = 1_000;
/** 启动后这么久内的读数丢弃（模块装载、开窗的卡顿是启动期的事，不是「用着卡」）。 */
export const STALL_STARTUP_GRACE_MS = 20_000;
/** 唤醒后这么久内的读数丢弃（睡眠会让一个采样间隔跨过整段睡眠）。 */
export const STALL_RESUME_GRACE_MS = 10_000;
const REPORT_CLOCK_SKEW_PAST_MS = 10 * 60_000;
const REPORT_CLOCK_SKEW_FUTURE_MS = 60_000;

type HistogramLike = { enable(): unknown; disable(): unknown; reset(): void; readonly max: number };
type EventSourceLike = { on(event: string, listener: () => void): unknown };

export type StallMonitorStatus = {
  running: boolean;
  /** 没在运行时的原因码，写进诊断包清单。 */
  reason?: "not-installed" | "install-failed";
  /** 这次启动写进盘里的行数。 */
  rowsThisSession: number;
};

export type StallMonitorOptions = {
  timeline: StallTimeline;
  createHistogram?: (resolutionMs: number) => HistogramLike;
  now?: () => number;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

export type StallMonitor = {
  start(): boolean;
  stop(): void;
  /** 主窗口的 `unresponsive` / `responsive`（Electron 现成事件）。 */
  watchWindow(window: EventSourceLike): void;
  /** 睡眠 / 唤醒（`powerMonitor`，app ready 之后才能用）。 */
  attachPower(power: EventSourceLike): void;
  /** 渲染层来的报文：最近一份场景 + 一批长帧。 */
  ingestReport(report: StallReport): void;
  status(): StallMonitorStatus;
};

const sceneSchema = z.object({ page: z.enum(PERF_FIELD_VALUES.page), nodes: z.enum(PERF_FIELD_VALUES.nodes), generating: z.boolean() }).strict();
const reportSchema = z
  .object({
    scene: sceneSchema.optional(),
    longFrames: z
      .array(z.object({ endedAtMs: z.number().finite(), ms: z.number().finite().min(0).max(STALL_MAX_MS), scene: sceneSchema }).strict())
      .max(STALL_REPORT_MAX_FRAMES)
      .optional(),
  })
  .strict();

/** 渲染层的报文不可信：按封闭形状整条收，不合格整条丢（不做「能收多少收多少」）。 */
export function parseStallReport(raw: unknown): StallReport | null {
  const parsed = reportSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function createStallMonitor(options: StallMonitorOptions): StallMonitor {
  const now = options.now ?? Date.now;
  const createHistogram = options.createHistogram ?? ((resolution: number) => monitorEventLoopDelay({ resolution }));
  const startTimer = options.setInterval ?? ((callback, ms) => setInterval(callback, ms));
  const stopTimer = options.clearInterval ?? ((handle) => clearInterval(handle as NodeJS.Timeout));
  const { timeline } = options;
  let histogram: HistogramLike | null = null;
  let timer: unknown = null;
  let running = false;
  let failed = false;
  let discardUntil = 0;
  /** 启动宽限期的结束时刻（只在 start 时定一次）；界面长帧按它判，唤醒宽限不管界面长帧。 */
  let startupEndsAt = 0;
  let suspended = false;
  let lastScene: StallScene | null = null;
  const unresponsiveSince = new Map<EventSourceLike, number>();

  const iso = (ms: number): string => new Date(ms).toISOString();
  const sceneFields = (): Partial<StallScene> => (lastScene ? { page: lastScene.page, nodes: lastScene.nodes, generating: lastScene.generating } : {});

  function tick(): void {
    if (!histogram) return;
    const maxNs = histogram.max;
    histogram.reset();
    const nowMs = now();
    if (suspended || nowMs < discardUntil) return;
    const estimateMs = Math.max(0, Math.round(maxNs / 1e6 - STALL_SAMPLE_INTERVAL_MS / 2));
    if (estimateMs >= STALL_RECORD_MIN_MS) {
      timeline.record({ t: iso(nowMs), kind: "main-stall", ms: Math.min(estimateMs, STALL_MAX_MS), frozen: estimateMs >= STALL_FREEZE_MIN_MS, ...sceneFields() });
    }
    timeline.tick();
  }

  return {
    start() {
      if (running) return true;
      try {
        histogram = createHistogram(STALL_SAMPLE_INTERVAL_MS);
        histogram.enable();
        startupEndsAt = now() + STALL_STARTUP_GRACE_MS;
        discardUntil = startupEndsAt;
        timer = startTimer(tick, STALL_READ_INTERVAL_MS);
        (timer as { unref?: () => void } | null)?.unref?.();
        running = true;
        failed = false;
      } catch {
        histogram = null;
        running = false;
        failed = true;
      }
      return running;
    },
    stop() {
      if (timer !== null) stopTimer(timer);
      try { histogram?.disable(); } catch { /* 关不掉也不影响退出 */ }
      timer = null;
      histogram = null;
      running = false;
    },
    watchWindow(window) {
      window.on("unresponsive", () => {
        const nowMs = now();
        unresponsiveSince.set(window, nowMs);
        timeline.record({ t: iso(nowMs), kind: "window-unresponsive", ...sceneFields() });
      });
      window.on("responsive", () => {
        const nowMs = now();
        const since = unresponsiveSince.get(window);
        unresponsiveSince.delete(window);
        timeline.record({ t: iso(nowMs), kind: "window-responsive", ...(since === undefined ? {} : { ms: Math.max(0, Math.round(nowMs - since)) }), ...sceneFields() });
      });
      window.on("closed", () => unresponsiveSince.delete(window));
    },
    attachPower(power) {
      power.on("suspend", () => {
        suspended = true;
        histogram?.reset();
      });
      power.on("resume", () => {
        suspended = false;
        histogram?.reset();
        discardUntil = now() + STALL_RESUME_GRACE_MS;
      });
    },
    ingestReport(report) {
      if (report.scene) lastScene = report.scene;
      const nowMs = now();
      const frames = [...(report.longFrames ?? [])].sort((a, b) => b.ms - a.ms).slice(0, STALL_REPORT_MAX_FRAMES);
      for (const frame of frames) {
        if (frame.ms < STALL_RENDERER_FRAME_MIN_MS) continue;
        const endedAt = Math.min(Math.max(frame.endedAtMs, nowMs - REPORT_CLOCK_SKEW_PAST_MS), nowMs + REPORT_CLOCK_SKEW_FUTURE_MS);
        if (endedAt < startupEndsAt) continue; // 启动期（界面首次渲染、装载）的长帧同主进程一样不算「用着卡」
        timeline.record({ t: iso(endedAt), kind: "renderer-long-frame", ms: Math.round(frame.ms), page: frame.scene.page, nodes: frame.scene.nodes, generating: frame.scene.generating });
      }
    },
    status: () => ({
      running,
      ...(running ? {} : { reason: failed ? ("install-failed" as const) : ("not-installed" as const) }),
      rowsThisSession: timeline.stats().written,
    }),
  };
}

// ── 进程内唯一一份（lifecycle 装入）──────────────────────────────────────────────────────────
let installed: StallMonitor | null = null;

/**
 * 装监视器。MCP stdio 子进程（`NOMI_MCP_STDIO=1`）不装：它没有窗口、不是用户在「用」的那个实例，
 * 装了只会往同一份时间线里掺别的进程的行。回滚 = 删 lifecycle 里调用它的那一行。
 */
export function installStallMonitor(options: { env?: NodeJS.ProcessEnv; monitor?: StallMonitor } = {}): StallMonitor | null {
  if (installed) return installed;
  if ((options.env ?? process.env).NOMI_MCP_STDIO === "1") return null;
  const monitor =
    options.monitor ?? createStallMonitor({ timeline: createStallTimeline({ append: createStallTimelineAppend(), now: Date.now }) });
  monitor.start();
  installed = monitor;
  try {
    // powerMonitor 要 app ready 之后才能用。
    void app.whenReady().then(() => {
      if (powerMonitor && typeof powerMonitor.on === "function") monitor.attachPower(powerMonitor as unknown as EventSourceLike);
    }).catch(() => undefined);
  } catch { /* 拿不到睡眠事件时，最坏是唤醒后多记一行，不阻断启动 */ }
  return monitor;
}

export function getStallMonitorStatus(): StallMonitorStatus {
  return installed?.status() ?? { running: false, reason: "not-installed", rowsThisSession: 0 };
}

/** 主窗口建好后调；没装监视器时什么都不做。 */
export function watchMainWindowResponsiveness(window: EventSourceLike): void {
  installed?.watchWindow(window);
}

export function resetStallMonitorForTests(): void {
  installed?.stop();
  installed = null;
}

// ── 渲染层 → 主进程（一条单向 IPC；形状照 `logging/rendererLog.ts`）─────────────────────────────
export type StallReportIpcBoundary<E = unknown> = {
  onMessage: (channel: string, handler: (event: E, message: unknown) => void) => void;
  assertTrusted: (event: E) => void;
};

export function registerStallReportIpc<E>(
  boundary: StallReportIpcBoundary<E>,
  ingest: (report: StallReport) => void = (report) => installed?.ingestReport(report),
): void {
  boundary.onMessage(STALL_REPORT_CHANNEL, (event, message) => {
    if (!assertTrustedFireAndForget(event, STALL_REPORT_CHANNEL, boundary.assertTrusted)) return;
    const report = parseStallReport(message);
    if (report) ingest(report);
  });
}
