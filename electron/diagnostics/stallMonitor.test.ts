// 主进程卡顿监视器：门槛、冻结标记、启动 / 睡眠唤醒不算、窗口事件、渲染层报文、无停顿 0 次写盘。
// 直方图、定时器、时钟、窗口、power 全部注入；真 Electron 里的阳性对照在 tests/perf/canvas-scale/stallProbe.mjs。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  STALL_RESUME_GRACE_MS,
  STALL_SAMPLE_INTERVAL_MS,
  STALL_STARTUP_GRACE_MS,
  createStallMonitor,
  getStallMonitorStatus,
  installStallMonitor,
  parseStallReport,
  registerStallReportIpc,
  resetStallMonitorForTests,
} from "./stallMonitor";
import { createStallTimeline } from "./stallTimeline";
import { UntrustedIpcSenderError } from "../ipcSenderGuard";
import { STALL_REPORT_CHANNEL } from "../shared/contracts/stallTimeline";

const SCENE = { page: "generation", nodes: "21-100", generating: true } as const;
let clock = 0;
let tickCallback: (() => void) | null = null;

function harness(options: { failHistogram?: boolean } = {}) {
  const lines: Record<string, unknown>[] = [];
  const append = vi.fn((line: string) => { lines.push(JSON.parse(line) as Record<string, unknown>); });
  const histogram = { max: 0, enable: vi.fn(), disable: vi.fn(), reset: vi.fn(() => { histogram.max = 0; }) };
  const timeline = createStallTimeline({ append, now: () => clock });
  const monitor = createStallMonitor({
    timeline,
    now: () => clock,
    createHistogram: () => { if (options.failHistogram) throw new Error("no histogram"); return histogram; },
    setInterval: (callback) => { tickCallback = callback; return 1; },
    clearInterval: () => { tickCallback = null; },
  });
  /** 模拟「窗口内最长一次采样间隔」= 停顿 + 一个采样间隔内的相位（取半个间隔，估计值正好还原）。 */
  const stall = (stallMs: number): void => { histogram.max = (stallMs + STALL_SAMPLE_INTERVAL_MS / 2) * 1e6; };
  const readTick = (afterMs = 10_000): void => { clock += afterMs; tickCallback?.(); };
  return { monitor, histogram, append, lines, stall, readTick, timeline };
}

beforeEach(() => {
  clock = 1_000_000;
  tickCallback = null;
  resetStallMonitorForTests();
});

describe("主进程停顿：门槛与冻结", () => {
  it("1200ms 的停顿记一行 main-stall，时长在 1200ms 附近，标冻结，带最近一份场景", () => {
    const h = harness();
    expect(h.monitor.start()).toBe(true);
    h.monitor.ingestReport({ scene: SCENE });
    h.readTick(STALL_STARTUP_GRACE_MS + 1);
    h.stall(1200);
    h.readTick();
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatchObject({ kind: "main-stall", frozen: true, ...SCENE });
    expect(Math.abs((h.lines[0]!.ms as number) - 1200)).toBeLessThanOrEqual(2);
  });

  it("约 100ms 以上才记：132ms 必记且不标冻结，88ms 不记，999ms 不冻结，1000ms 冻结", () => {
    const h = harness();
    h.monitor.start();
    h.readTick(STALL_STARTUP_GRACE_MS + 1);
    const run = (ms: number): void => { h.stall(ms); h.readTick(); };
    run(88);
    expect(h.lines).toHaveLength(0);
    run(132);
    expect(h.lines.at(-1)).toMatchObject({ kind: "main-stall", frozen: false });
    run(999);
    expect(h.lines.at(-1)).toMatchObject({ frozen: false });
    run(1000);
    expect(h.lines.at(-1)).toMatchObject({ frozen: true });
  });

  it("没报过场景时行里不带 page / nodes / generating（不猜）", () => {
    const h = harness();
    h.monitor.start();
    h.readTick(STALL_STARTUP_GRACE_MS + 1);
    h.stall(500);
    h.readTick();
    expect(Object.keys(h.lines[0]!).sort()).toEqual(["frozen", "kind", "ms", "t"]);
  });

  it("启动期读数丢弃：启动 20 秒内再大的停顿也不记", () => {
    const h = harness();
    h.monitor.start();
    h.stall(2000);
    h.readTick(10_000);
    expect(h.lines).toHaveLength(0);
    expect(h.histogram.reset).toHaveBeenCalled();
  });

  it("睡眠唤醒不算卡顿：suspend 后的读数丢弃，resume 后再宽限一段，之后恢复记录", () => {
    const h = harness();
    const power = new EventEmitter();
    h.monitor.start();
    h.monitor.attachPower({ on: (event, listener) => power.on(event, listener) });
    h.readTick(STALL_STARTUP_GRACE_MS + 1);
    power.emit("suspend");
    h.stall(8 * 3600_000);
    h.readTick(8 * 3600_000);
    power.emit("resume");
    h.stall(8 * 3600_000);
    h.readTick(1_000);
    expect(h.lines).toHaveLength(0);
    h.stall(400);
    h.readTick(STALL_RESUME_GRACE_MS + 1);
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatchObject({ kind: "main-stall", ms: 400 });
  });

  it("无停顿时 0 次写盘：360 次安静读数一次都不写；之后一次停顿恰好写一次（防空断言）", () => {
    const h = harness();
    h.monitor.start();
    h.readTick(STALL_STARTUP_GRACE_MS + 1);
    for (let i = 0; i < 360; i += 1) { h.histogram.max = (STALL_SAMPLE_INTERVAL_MS + 8) * 1e6; h.readTick(); }
    expect(h.append).toHaveBeenCalledTimes(0);
    h.stall(300);
    h.readTick();
    expect(h.append).toHaveBeenCalledTimes(1);
  });
});

describe("窗口无响应 / 恢复", () => {
  it("unresponsive 与 responsive 各写一行，responsive 带无响应的时长", () => {
    const h = harness();
    const win = new EventEmitter();
    h.monitor.start();
    h.monitor.watchWindow({ on: (event, listener) => win.on(event, listener) });
    h.monitor.ingestReport({ scene: { page: "library", nodes: "0", generating: false } });
    clock += 1000;
    win.emit("unresponsive");
    clock += 5200;
    win.emit("responsive");
    expect(h.lines.map((row) => row.kind)).toEqual(["window-unresponsive", "window-responsive"]);
    expect(h.lines[1]).toMatchObject({ ms: 5200, page: "library", nodes: "0", generating: false });
    expect(h.lines[0]).not.toHaveProperty("ms");
  });

  it("没先收到 unresponsive 的 responsive 不带时长，不抛", () => {
    const h = harness();
    const win = new EventEmitter();
    h.monitor.start();
    h.monitor.watchWindow({ on: (event, listener) => win.on(event, listener) });
    win.emit("responsive");
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).not.toHaveProperty("ms");
  });
});

describe("渲染层报文", () => {
  it("≥200ms 的长帧进时间线，带页面和场景；最长的一条先写，其余被限频略掉；低于 200ms 的丢弃", () => {
    const h = harness();
    h.monitor.start();
    h.monitor.ingestReport({
      scene: SCENE,
      longFrames: [
        { endedAtMs: clock - 1000, ms: 250, scene: SCENE },
        { endedAtMs: clock - 900, ms: 900, scene: { page: "preview", nodes: "1-20", generating: false } },
        { endedAtMs: clock - 800, ms: 150, scene: SCENE },
      ],
    });
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatchObject({ kind: "renderer-long-frame", ms: 900, page: "preview", nodes: "1-20", generating: false });
  });

  it("时刻被夹在合理范围内（渲染层的钟不可信）", () => {
    const h = harness();
    h.monitor.start();
    h.monitor.ingestReport({ longFrames: [{ endedAtMs: 0, ms: 300, scene: SCENE }] });
    expect(Date.parse(h.lines[0]!.t as string)).toBe(clock - 10 * 60_000);
  });

  it("报文形状不可信：多余键、非法页面、超长数组、非对象整条拒收", () => {
    expect(parseStallReport({ scene: SCENE })).not.toBeNull();
    expect(parseStallReport({ scene: { ...SCENE, path: "/Users/x" } })).toBeNull();
    expect(parseStallReport({ scene: { ...SCENE, page: "/Users/x" } })).toBeNull();
    expect(parseStallReport({ extra: 1 })).toBeNull();
    expect(parseStallReport({ longFrames: Array.from({ length: 21 }, () => ({ endedAtMs: 1, ms: 300, scene: SCENE })) })).toBeNull();
    expect(parseStallReport("hello")).toBeNull();
    expect(parseStallReport(null)).toBeNull();
  });

  it("IPC：不可信发送方、坏形状都不进监视器；合格的才进", () => {
    const ingest = vi.fn();
    let handler: ((event: { trusted: boolean }, message: unknown) => void) | null = null;
    registerStallReportIpc<{ trusted: boolean }>(
      { onMessage: (channel, fn) => { expect(channel).toBe(STALL_REPORT_CHANNEL); handler = fn; }, assertTrusted: (event) => { if (!event.trusted) throw new UntrustedIpcSenderError(); } },
      ingest,
    );
    handler!({ trusted: false }, { scene: SCENE });
    handler!({ trusted: true }, { scene: { ...SCENE, page: "nope" } });
    expect(ingest).not.toHaveBeenCalled();
    handler!({ trusted: true }, { scene: SCENE });
    expect(ingest).toHaveBeenCalledWith({ scene: SCENE });
  });
});

describe("状态：三态里「监视器没运行」的两个原因", () => {
  it("没装：not-installed；MCP stdio 子进程不装", () => {
    expect(getStallMonitorStatus()).toEqual({ running: false, reason: "not-installed", rowsThisSession: 0 });
    expect(installStallMonitor({ env: { NOMI_MCP_STDIO: "1" } })).toBeNull();
    expect(getStallMonitorStatus().reason).toBe("not-installed");
  });

  it("装了但直方图起不来：install-failed，不抛", () => {
    const h = harness({ failHistogram: true });
    expect(h.monitor.start()).toBe(false);
    expect(h.monitor.status()).toEqual({ running: false, reason: "install-failed", rowsThisSession: 0 });
  });

  it("运行中：running，并如实报本次启动写了几行", () => {
    const h = harness();
    h.monitor.start();
    h.readTick(STALL_STARTUP_GRACE_MS + 1);
    h.stall(500);
    h.readTick();
    expect(h.monitor.status()).toEqual({ running: true, rowsThisSession: 1 });
    h.monitor.stop();
    expect(h.monitor.status().running).toBe(false);
    expect(h.histogram.disable).toHaveBeenCalled();
  });

  it("installStallMonitor 经注入的监视器装入，状态可查", () => {
    const h = harness();
    expect(installStallMonitor({ env: {}, monitor: h.monitor })).toBe(h.monitor);
    expect(getStallMonitorStatus().running).toBe(true);
  });
});
