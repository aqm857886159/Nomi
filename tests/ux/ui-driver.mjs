// 常驻交互式 UI 驱动（开一次、不关、边看边点）。
//
// 解决两个老毛病：① 每个一次性脚本都 launch→点→close，app 闪开闪关；
// ② 选择器全靠提前盲猜。改成：app 启动一次保持开着，AI 用 `snap` 看真实可点元素、
// `shot` 截图判断、`click`/`fill` 操作、再 `shot` 看结果——感知→决策→行动→再感知。
//
// 用法：
//   后台启动：  node tests/ux/ui-driver.mjs   （用 Bash run_in_background:true）
//   发命令：    node tests/ux/ui.mjs <action> ...   （见 ui.mjs）
//   关闭：      node tests/ux/ui.mjs quit
//
// Electron 专用（Nomi 要主进程+IPC 桥，普通浏览器预览工具附不上去）。
import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { UI_DIR } from "./uiDir.mjs";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// 按 worktree 派生的唯一 IPC 目录（不再写死 /tmp/nomi-ui，根治多会话串台，见 uiDir.mjs）。
const DIR = UI_DIR;
const SHOTS = path.join(repoRoot, "tests/ux/shots");
fs.mkdirSync(DIR, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const f of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, f), { force: true });

// 多会话隔离（另一半根治）：单实例锁是 per-userData（main.ts:63）。默认用系统 userData
// （单会话便利:能开已有/示例项目）；设 NOMI_UI_USER_DATA=<dir> 则用隔离 userData 起一份
// 全新实例——多会话同时跑时必须用它，否则抢默认 userData 的锁会起不来/聚焦到别人的窗口。
const isolateArgs = process.env.NOMI_UI_USER_DATA ? [`--user-data-dir=${process.env.NOMI_UI_USER_DATA}`] : [];
const app = await electron.launch({ executablePath: require("electron"), args: [".", ...isolateArgs], cwd: repoRoot, env: { ...process.env } });
const ERRLOG = path.join(DIR, "errors.log");
const logErr = (kind, msg) => { try { fs.appendFileSync(ERRLOG, `[${kind}] ${msg}\n`); } catch { /* ignore */ } };
// 多窗口（v0.10.13+）：打开项目会新开一个 studio 窗口、关掉起始窗口。固定 firstWindow 引用会失效。
// 改成始终追最新一个「活着」的窗口：新窗口出现即接管，命令前用 getWin() 取活窗口。
let win = await app.firstWindow();
function wireWin(w) {
  w.on("pageerror", (e) => logErr("pageerror", (e && e.stack) || String(e)));
  w.on("console", (m) => { if (m.type() === "error") logErr("console.error", m.text()); });
  w.on("crash", () => logErr("crash", "renderer crashed"));
  w.on("close", () => logErr("close", "page closed"));
}
wireWin(win);
// 不再每次新窗口都 latch（会粘上检查更新等瞬时弹窗）；只 wire 日志，由 getWin 选活窗口。
app.on("window", (w) => { wireWin(w); logErr("window", "new window seen"); });
// 命令执行前确保 win 指向一个未关闭的窗口；当前的关了就回退到「最像主界面」的活窗口
// （优先 hash 含 studio/library 的，再退最后一个），避免粘在已关闭页上。
function pickLiveWin() {
  const live = app.windows().filter((w) => !w.isClosed());
  if (live.length === 0) return win;
  const main = live.find((w) => { try { return /studio|library|#\//.test(w.url()); } catch { return false; } });
  return main || live[live.length - 1];
}
function getWin() {
  if (win && !win.isClosed()) return win;
  win = pickLiveWin();
  return win;
}
// ── E5 体验探针（页面侧）：延迟 / 帧率 / 认知密度 / 对比度。注入式，不改产品行为。
// 见 docs/plan/2026-06-20-experience-feel-audit.md §3。
const PROBE_SRC = `(() => {
  if (window.__nomiProbe) return 'exists';
  // 任意 CSS 颜色（含 oklch/hsl/var）→ 真实 RGBA：靠 canvas 渲染回读，不靠正则猜格式。
  const _cv = document.createElement('canvas'); _cv.width = _cv.height = 1; const _ctx = _cv.getContext('2d', { willReadFrequently: true });
  const toRGBA = (s) => { _ctx.clearRect(0,0,1,1); _ctx.fillStyle = '#000000'; _ctx.fillStyle = String(s||''); _ctx.fillRect(0,0,1,1); const d = _ctx.getImageData(0,0,1,1).data; return [d[0], d[1], d[2], d[3]]; };
  const overWhite = (c) => { const a = c[3]/255; return [Math.round(c[0]*a + 255*(1-a)), Math.round(c[1]*a + 255*(1-a)), Math.round(c[2]*a + 255*(1-a))]; };
  const relLum = (c) => { const [r,g,b] = c.map((v) => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*r + 0.7152*g + 0.0722*b; };
  const loadingHit = (n, rec) => {
    if (!(n instanceof Element)) return;
    const raw = n.className; const cls = String(raw && raw.baseVal !== undefined ? raw.baseVal : (raw || ''));
    if (/skeleton|shimmer|animate-pulse/i.test(cls)) rec.sawSkeleton = true;
    if (/spinner|loading|loader|animate-spin/i.test(cls)) rec.sawSpinner = true;
    if ((n.getAttribute && n.getAttribute('role') === 'progressbar') || /progress/i.test(cls)) rec.sawProgress = true;
  };
  window.__nomiProbe = {
    startLatency() {
      const rec = { t0: performance.now(), first: null, last: performance.now(), mutations: 0, sawSkeleton: false, sawSpinner: false, sawProgress: false };
      const mo = new MutationObserver((muts) => {
        const now = performance.now();
        if (rec.first === null) rec.first = now;
        rec.last = now; rec.mutations += muts.length;
        for (const m of muts) { loadingHit(m.target, rec); m.addedNodes && m.addedNodes.forEach((x) => loadingHit(x, rec)); }
      });
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      rec.mo = mo; this._lat = rec; return 'started';
    },
    readLatency() {
      const rec = this._lat; if (!rec) return null; rec.mo.disconnect(); this._lat = null;
      return { firstFeedbackMs: rec.first ? Math.round(rec.first - rec.t0) : null, contentSettleMs: Math.round(rec.last - rec.t0), mutations: rec.mutations, sawSkeleton: rec.sawSkeleton, sawSpinner: rec.sawSpinner, sawProgress: rec.sawProgress };
    },
    startFps() {
      const rec = { t0: performance.now(), frames: 0, lastFrame: performance.now(), maxGap: 0, longTasks: 0, longTaskMs: 0 };
      const loop = () => { const now = performance.now(); const gap = now - rec.lastFrame; if (gap > rec.maxGap) rec.maxGap = gap; rec.lastFrame = now; rec.frames++; rec.raf = requestAnimationFrame(loop); };
      rec.raf = requestAnimationFrame(loop);
      try { rec.po = new PerformanceObserver((list) => { for (const e of list.getEntries()) { rec.longTasks++; rec.longTaskMs += e.duration; } }); rec.po.observe({ entryTypes: ['longtask'] }); } catch (e) { /* ignore */ }
      this._fps = rec; return 'started';
    },
    readFps() {
      const rec = this._fps; if (!rec) return null; cancelAnimationFrame(rec.raf); if (rec.po) rec.po.disconnect(); this._fps = null;
      const elapsed = performance.now() - rec.t0;
      return { elapsedMs: Math.round(elapsed), frames: rec.frames, fps: Math.round((rec.frames / elapsed) * 1000 * 10) / 10, longTasks: rec.longTasks, longTaskMs: Math.round(rec.longTaskMs), maxFrameGapMs: Math.round(rec.maxGap) };
    },
    density() {
      const sel = 'button,a,[role="button"],[role="tab"],input,select,textarea,[contenteditable="true"]';
      let vis = 0;
      for (const e of document.querySelectorAll(sel)) { const r = e.getBoundingClientRect(); if (r.width > 3 && r.height > 3 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) vis++; }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let runs = 0, chars = 0, node;
      while ((node = walker.nextNode())) { const t = node.textContent.trim(); if (t) { runs++; chars += t.length; } }
      return { visibleClickable: vis, textRuns: runs, textChars: chars, vw: innerWidth, vh: innerHeight };
    },
    contrast(sel) {
      const el = document.querySelector(sel); if (!el) return null;
      const fg = overWhite(toRGBA(getComputedStyle(el).color));
      let bgEl = el, bg = [255, 255, 255];
      while (bgEl) { const c = toRGBA(getComputedStyle(bgEl).backgroundColor); if (c[3] > 0) { bg = overWhite(c); break; } bgEl = bgEl.parentElement; }
      const L1 = relLum(fg) + 0.05, L2 = relLum(bg) + 0.05; const ratio = L1 > L2 ? L1 / L2 : L2 / L1;
      return { ratio: Math.round(ratio * 100) / 100, fg, bg };
    },
  };
  return 'installed';
})()`;
async function ensureProbe(w) { try { await w.evaluate(PROBE_SRC); } catch { /* ignore */ } }

await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(1200);
fs.writeFileSync(path.join(DIR, "ready"), String(process.pid));
console.log(`DRIVER READY pid=${process.pid} repoRoot=${repoRoot} IPC=${DIR} — app 已开，保持运行。用 tests/ux/ui.mjs 发命令。`);

async function shot(name) {
  const p = path.join(SHOTS, (name || "live") + ".png");
  await getWin().screenshot({ path: p });
  return p;
}
// 快照：当前所有"可交互元素"的 标签/文字/aria/位置——AI 据此决定点哪，不用盲猜。
async function snap() {
  return getWin().evaluate(() => {
    const out = [];
    const els = document.querySelectorAll('button,a,[role="button"],[role="tab"],input,select,textarea,[contenteditable="true"]');
    for (const e of els) {
      const r = e.getBoundingClientRect();
      if (r.width < 3 || r.height < 3 || r.bottom < 0 || r.top > innerHeight) continue;
      const text = (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48);
      const aria = e.getAttribute("aria-label") || "";
      const ph = e.getAttribute("placeholder") || "";
      out.push({ tag: e.tagName.toLowerCase(), text, aria, ph, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    }
    return out.slice(0, 140);
  });
}
// 点击：支持 "aria:xxx" / "css:sel" / "text:xxx" / 纯文字（默认按可见文字模糊匹配）/ "xy:120,80"。
async function click(target) {
  const w = getWin();
  if (target.startsWith("xy:")) {
    const [x, y] = target.slice(3).split(",").map(Number);
    await w.mouse.click(x, y);
    return "clicked xy " + x + "," + y;
  }
  let loc;
  if (target.startsWith("css:")) loc = w.locator(target.slice(4));
  else if (target.startsWith("aria:")) loc = w.locator(`[aria-label="${target.slice(5)}"]`);
  else loc = w.getByText(target.startsWith("text:") ? target.slice(5) : target, { exact: false });
  await loc.first().click({ timeout: 5000 });
  return "clicked: " + target;
}

async function run(cmd) {
  switch (cmd.action) {
    case "shot": return { shot: await shot(cmd.name) };
    case "snap": return { snap: await snap() };
    case "click": { const r = await click(cmd.target); await getWin().waitForTimeout(cmd.wait ?? 700); return { ok: r, shot: await shot("live") }; }
    case "fill": { await getWin().locator(cmd.sel).first().fill(cmd.val, { timeout: 5000 }); await getWin().waitForTimeout(300); return { ok: true, shot: await shot("live") }; }
    case "setfile": { await getWin().locator(cmd.sel).first().setInputFiles(cmd.path, { timeout: 5000 }); await getWin().waitForTimeout(cmd.wait ?? 800); return { ok: true, shot: await shot("live") }; }
    case "eval": return { value: await getWin().evaluate(cmd.js) };
    case "drag": {
      // 真鼠标拖拽：按下→分步移动→松手。用于 trim/拖片/reorder/scrub 等手势（click 测不了）。
      const w = getWin();
      const steps = Math.max(1, cmd.steps ?? 12);
      await w.mouse.move(cmd.x1, cmd.y1);
      await w.mouse.down();
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        await w.mouse.move(cmd.x1 + (cmd.x2 - cmd.x1) * t, cmd.y1 + (cmd.y2 - cmd.y1) * t);
        await w.waitForTimeout(12);
      }
      await w.mouse.up();
      await w.waitForTimeout(cmd.wait ?? 400);
      return { ok: `drag ${cmd.x1},${cmd.y1} -> ${cmd.x2},${cmd.y2}`, shot: await shot("live") };
    }
    case "move": { await getWin().mouse.move(cmd.x, cmd.y); await getWin().waitForTimeout(cmd.wait ?? 250); return { ok: `move ${cmd.x},${cmd.y}`, shot: await shot("live") }; }
    case "wait": await getWin().waitForTimeout(cmd.ms ?? 500); return { ok: true };
    // ── E5 探针动作 ──
    case "probe-latency": {
      // 测「click→首视觉反馈」与「内容沉降」延迟 + 有无 skeleton/spinner/进度。target 同 click 语法。
      const w = getWin(); await ensureProbe(w);
      await w.evaluate("window.__nomiProbe.startLatency()");
      const r = await click(cmd.target);
      await w.waitForTimeout(cmd.wait ?? 1800);
      const m = await w.evaluate("window.__nomiProbe.readLatency()");
      return { ok: r, latency: m, shot: await shot(cmd.name || "live") };
    }
    case "fps-start": { const w = getWin(); await ensureProbe(w); await w.evaluate("window.__nomiProbe.startFps()"); return { ok: "fps measuring…" }; }
    case "fps-stop": { const m = await getWin().evaluate("window.__nomiProbe.readFps()"); return { fps: m }; }
    case "density": { const w = getWin(); await ensureProbe(w); return { density: await w.evaluate("window.__nomiProbe.density()") }; }
    case "contrast": { const w = getWin(); await ensureProbe(w); return { contrast: await w.evaluate(`window.__nomiProbe.contrast(${JSON.stringify(cmd.sel)})`) }; }
    case "quit": return { quit: true };
    default: return { error: "unknown action: " + cmd.action };
  }
}

let running = true;
while (running) {
  const reqP = path.join(DIR, "req.json");
  if (fs.existsSync(reqP)) {
    let cmd = null;
    try { cmd = JSON.parse(fs.readFileSync(reqP, "utf8")); } catch { /* ignore */ }
    fs.rmSync(reqP, { force: true });
    let res;
    try { res = cmd ? await run(cmd) : { error: "bad req" }; }
    catch (e) { res = { error: String((e && e.message) || e) }; }
    fs.writeFileSync(path.join(DIR, "res.json"), JSON.stringify(res));
    if (res.quit) running = false;
  }
  await new Promise((r) => setTimeout(r, 150));
}
await app.close().catch(() => {});
console.log("DRIVER STOPPED");
