import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDurabilityMode } from "../durability";
import { canvasRunIdFor } from "../productionRun/canvasShotRunIndex";
import { CANVAS_TEST_PROJECT, setupCanvasShots } from "./canvasShotTestUtils";

// 画布付费口的性能尾巴（发动机收敛第一刀第 3–4 步，设计卡 §7）。三个数：
// ① 单节点 ↑：从「交」进主进程到供应商请求发出的耗时（p50 / p95）；
// ② 批量卡 10 镜：确认（10 份出价落盘）用了多久，确认后 10 镜按画布默认并发 6 交出，最后一镜什么时候到供应商；
// ③ 项目里已有 500 个收尾了的画布 Run（外加几笔还在路上的）：打开项目那一下（recoverOrphans + listRuns）用了多久。
// 真仓库、真收据、真提交出口、真落盘屏障（durable：真 fsync）；只有供应商是进程内假的。
// 不进常规套件（量的是本机磁盘，数随机器变）：`NOMI_PERF=1 pnpm exec vitest run electron/capabilityCore/canvasShotLatency.perf.test.ts --silent=false`；
// 加 `NOMI_PERF_EPHEMERAL=1` 关掉落盘屏障，量「不算 fsync」的底（剩下的是读写文件次数与序列化）。

const enabled = process.env.NOMI_PERF === "1";

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

function report(name: string, numbers: Record<string, number>): void {
  console.log(`[canvas-shot-perf] ${name} ${JSON.stringify(Object.fromEntries(Object.entries(numbers).map(([key, value]) => [key, Math.round(value * 10) / 10])))}`);
}

/** 让假供应商在「请求发出」那一刻记下时间，返回排队中（渲染层随后去查，不在这次计时里）。 */
function queuedVendor(setup: ReturnType<typeof setupCanvasShots>, stamps: number[]): void {
  setup.vendor.answer = async (call) => {
    stamps.push(performance.now());
    return { id: `task-queued-${call}`, kind: "text_to_image", status: "queued", assets: [], raw: {} };
  };
}

describe.skipIf(!enabled)("canvas paid shot latency (NOMI_PERF=1)", () => {
  beforeEach(() => setDurabilityMode(process.env.NOMI_PERF_EPHEMERAL === "1" ? "ephemeral" : "durable"));
  afterEach(() => setDurabilityMode("ephemeral"));

  it("single node ↑: main process → provider request", async () => {
    const setup = setupCanvasShots();
    const stamps: number[] = [];
    queuedVendor(setup, stamps);
    const samples: number[] = [];
    const total = 60;
    for (let index = 0; index < total; index += 1) {
      const started = performance.now();
      await setup.submit(`node-${index}`, `record-${index}`, `prompt ${index}`);
      samples.push(stamps[index]! - started);
    }
    expect(setup.vendor.executes).toHaveLength(total);
    const warm = samples.slice(5);
    report("single", { n: warm.length, p50: percentile(warm, 50), p95: percentile(warm, 95), max: Math.max(...warm) });
    fs.rmSync(setup.root, { recursive: true, force: true });
  }, 600_000);

  it("batch card with 10 shots: consent, then 10 submits at the canvas default concurrency", async () => {
    const rounds: Array<{ consent: number; lastProvider: number; perShotP95: number }> = [];
    for (let round = 0; round < 5; round += 1) {
      const setup = setupCanvasShots();
      const stamps: number[] = [];
      queuedVendor(setup, stamps);
      const shots = Array.from({ length: 10 }, (_, index) => ({ nodeId: `node-${index}`, runRecordId: `batch-${index}` }));
      const clicked = performance.now();
      setup.consent(shots);
      const consented = performance.now();
      const queue = [...shots];
      const perShot: number[] = [];
      const worker = async () => {
        for (let shot = queue.shift(); shot; shot = queue.shift()) {
          const started = performance.now();
          const before = stamps.length;
          await setup.submit(shot.nodeId, shot.runRecordId, `prompt ${shot.nodeId}`);
          perShot.push(stamps[before]! - started);
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      expect(setup.vendor.executes).toHaveLength(10);
      rounds.push({ consent: consented - clicked, lastProvider: Math.max(...stamps) - clicked, perShotP95: percentile(perShot, 95) });
      fs.rmSync(setup.root, { recursive: true, force: true });
    }
    report("batch10", {
      consentP50: percentile(rounds.map((round) => round.consent), 50),
      lastProviderP50: percentile(rounds.map((round) => round.lastProvider), 50),
      lastProviderMax: Math.max(...rounds.map((round) => round.lastProvider)),
      perShotP95: percentile(rounds.map((round) => round.perShotP95), 50),
    });
  }, 600_000);

  it("opening a project that already holds 500 settled canvas Runs", async () => {
    const setup = setupCanvasShots();
    // 铺数据不量：落盘屏障关掉（读路径与它无关）。
    setDurabilityMode("ephemeral");
    for (let index = 0; index < 500; index += 1) await setup.submit(`node-${index}`, `done-${index}`, `prompt ${index}`);
    const stamps: number[] = [];
    queuedVendor(setup, stamps);
    for (let index = 0; index < 3; index += 1) await setup.submit(`node-open-${index}`, `open-${index}`);
    setDurabilityMode("durable");
    expect(setup.repository.read(CANVAS_TEST_PROJECT, canvasRunIdFor("done-499"))?.status).toBe("completed");

    const samples: number[] = [];
    for (let round = 0; round < 10; round += 1) {
      const started = performance.now();
      setup.runs.recoverOrphans(CANVAS_TEST_PROJECT);
      setup.repository.listRuns(CANVAS_TEST_PROJECT);
      samples.push(performance.now() - started);
    }
    report("open500", { p50: percentile(samples, 50), max: Math.max(...samples) });
    fs.rmSync(setup.root, { recursive: true, force: true });
  }, 600_000);
});
