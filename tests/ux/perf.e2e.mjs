// 性能基准 harness（卡顿专项 before/after 工具）。
//
// 在标准重 fixture(96 节点+156 边+20 clip)上跑三场景，用注入探针量 longTasks/maxFrameGap/fps：
//   canvas-pan   画布平移（god-component 每帧重渲的规模卡顿，P0-D）
//   canvas-zoom  画布缩放
//   timeline-play 时间轴播放（playhead 每帧 {...timeline} → TimelinePreview 重渲，P0-B）
//
// 用法（先 pnpm run build；fixture 先 node tests/ux/fixtures/gen-perf-fixture.mjs）：
//   node tests/ux/perf.e2e.mjs <label>     label 默认 "run"，结果写 tests/ux/perf-results/<label>.json
// before/after：改前 `node tests/ux/perf.e2e.mjs baseline`，改后 `... after-A`，diff 两个 JSON。
import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const label = process.argv[2] || "run";
const outDir = path.join(repoRoot, "tests/ux/perf-results");
fs.mkdirSync(outDir, { recursive: true });

const PROBE = `(() => {
  if (window.__perfProbe) return 'exists';
  window.__perfProbe = {
    start() {
      const r = { t0: performance.now(), frames: 0, last: performance.now(), maxGap: 0, longTasks: 0, longTaskMs: 0 };
      const loop = () => { const n = performance.now(); const g = n - r.last; if (g > r.maxGap) r.maxGap = g; r.last = n; r.frames++; r.raf = requestAnimationFrame(loop); };
      r.raf = requestAnimationFrame(loop);
      try { r.po = new PerformanceObserver((l) => { for (const e of l.getEntries()) { r.longTasks++; r.longTaskMs += e.duration; } }); r.po.observe({ entryTypes: ['longtask'] }); } catch (e) {}
      this._r = r; return 'started';
    },
    stop() {
      const r = this._r; if (!r) return null; cancelAnimationFrame(r.raf); if (r.po) r.po.disconnect(); this._r = null;
      const ms = performance.now() - r.t0;
      return { elapsedMs: Math.round(ms), frames: r.frames, fps: Math.round(r.frames / ms * 1000 * 10) / 10, longTasks: r.longTasks, longTaskMs: Math.round(r.longTaskMs), maxFrameGapMs: Math.round(r.maxGap) };
    },
  };
  return 'installed';
})()`;

const app = await electron.launch({ executablePath: require("electron"), args: ["."], cwd: repoRoot, env: { ...process.env } });
let win = await app.firstWindow();
const live = () => app.windows().filter((w) => !w.isClosed());
const getWin = () => (win && !win.isClosed() ? win : (win = live().find((w) => /studio|library|#\//.test(w.url())) || live().slice(-1)[0] || win));

async function probeStart() { const w = getWin(); await w.evaluate(PROBE); await w.evaluate("window.__perfProbe.start()"); }
async function probeStop() { return getWin().evaluate("window.__perfProbe.stop()"); }
async function sleep(ms) { await getWin().waitForTimeout(ms); }

const results = { label, fixture: "ZZ 性能基准 fixture (96 节点/156 边/20 clip)", scenarios: {} };
const log = (...a) => console.log(...a);

try {
  await win.waitForLoadState("domcontentloaded");
  await sleep(2500);

  // 开 fixture 项目
  const card = getWin().locator("[data-project-card]", { hasText: "ZZ 性能基准" }).first();
  if ((await card.count()) === 0) throw new Error("库里找不到 ZZ 性能基准 fixture——先跑 gen-perf-fixture.mjs");
  await card.click();
  await sleep(1200);
  // 卡片可能要点「继续创作」覆盖按钮
  const cont = getWin().locator("[data-project-card]", { hasText: "ZZ 性能基准" }).getByText("继续创作").first();
  if (await cont.count().catch(() => 0)) { await cont.click().catch(() => {}); }
  await sleep(4000);

  const onCanvas = await getWin().evaluate(() => ({
    url: location.hash,
    nodes: document.querySelectorAll(".generation-canvas-v2-node").length,
    onStudio: !document.querySelector("[data-project-card]"),
  }));
  log("opened:", JSON.stringify(onCanvas));
  results.opened = onCanvas;

  // 切到「生成」画布
  await getWin().getByRole("button", { name: "生成", exact: false }).first().click().catch(() => {});
  await sleep(1500);
  const nodeCount = await getWin().evaluate(() => document.querySelectorAll(".generation-canvas-v2-node").length);
  results.visibleNodes = nodeCount;
  log("画布可见节点 DOM:", nodeCount);

  // ── 场景 1：画布平移（持续拖拽 ~4s）──
  await probeStart();
  for (let i = 0; i < 8; i += 1) {
    await getWin().mouse.move(640, 420); await getWin().mouse.down();
    for (let s = 1; s <= 14; s += 1) { await getWin().mouse.move(640 - s * 22, 420 - s * 10); await getWin().waitForTimeout(11); }
    await getWin().mouse.up();
    await getWin().mouse.move(300, 280); await getWin().mouse.down();
    for (let s = 1; s <= 14; s += 1) { await getWin().mouse.move(300 + s * 22, 280 + s * 10); await getWin().waitForTimeout(11); }
    await getWin().mouse.up();
  }
  results.scenarios["canvas-pan"] = await probeStop();
  log("canvas-pan:", JSON.stringify(results.scenarios["canvas-pan"]));

  // ── 场景 2：画布缩放（wheel 连续）──
  await probeStart();
  for (let i = 0; i < 30; i += 1) { await getWin().mouse.move(660, 420); await getWin().mouse.wheel(0, i % 2 ? 120 : -120); await getWin().waitForTimeout(60); }
  results.scenarios["canvas-zoom"] = await probeStop();
  log("canvas-zoom:", JSON.stringify(results.scenarios["canvas-zoom"]));

  // ── 场景 3：时间轴播放 ~6s ──
  await getWin().getByRole("button", { name: "预览", exact: false }).first().click().catch(() => {});
  await sleep(2000);
  const playBtn = getWin().locator('[aria-label="播放"]').first();
  if (await playBtn.count().catch(() => 0)) {
    await probeStart();
    await playBtn.click().catch(() => {});
    await sleep(6000);
    results.scenarios["timeline-play"] = await probeStop();
    log("timeline-play:", JSON.stringify(results.scenarios["timeline-play"]));
  } else {
    results.scenarios["timeline-play"] = { skipped: "未找到播放按钮（时间轴可能空）" };
    log("timeline-play: 跳过（无播放按钮）");
  }

  const outPath = path.join(outDir, `${label}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  log(`\n✅ 结果写入 ${outPath}`);
} catch (e) {
  console.error("\nPERF HARNESS ERROR:", e?.message || e);
  results.error = String(e?.message || e);
  fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
}
