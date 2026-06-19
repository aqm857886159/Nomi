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

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = "/tmp/nomi-ui";
const SHOTS = path.join(repoRoot, "tests/ux/shots");
fs.mkdirSync(DIR, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const f of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, f), { force: true });

const app = await electron.launch({ executablePath: require("electron"), args: ["."], cwd: repoRoot, env: { ...process.env } });
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
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(1200);
fs.writeFileSync(path.join(DIR, "ready"), String(process.pid));
console.log("DRIVER READY pid=" + process.pid + " — app 已开，保持运行。用 tests/ux/ui.mjs 发命令。");

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
    case "wait": await getWin().waitForTimeout(cmd.ms ?? 500); return { ok: true };
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
