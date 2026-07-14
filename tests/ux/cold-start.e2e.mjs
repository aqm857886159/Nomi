// 冷启动 J3 走查（全新安装模拟）——隔离 userData + 空 NOMI_PROJECTS_DIR 启动，验证：
//   CS1：全新安装直接落标准项目库页（空库不再有介绍 hero），动作卡片可见、能新建项目。
//   CS2：模型目录有可用文本模型时显示常态弱入口；确实为零时，缺模型状态条
//        [data-model-banner] 升权承载恢复路径。两种合法初始状态都不能形成死路。
// 空库 hero（「30 秒体验」主 CTA）已随空库介绍首屏一起删除，模型接入路径改由状态条承载。
//
// 用法：node tests/ux/cold-start.e2e.mjs
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// 每次跑都用全新的隔离目录（带时间戳），确保是「全新安装」状态，不被上次残留污染。
const stamp = `${Date.now()}`;
const userDataDir = path.join(os.tmpdir(), `nomi-cold-userdata-${stamp}`);
const projectsDir = path.join(os.tmpdir(), `nomi-cold-projects-${stamp}`);
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(projectsDir, { recursive: true });
console.log(`隔离 userData: ${userDataDir}`);
console.log(`隔离 projects: ${projectsDir}`);

const shotsDir = path.join(repoRoot, "tests/ux/shots");
fs.mkdirSync(shotsDir, { recursive: true });

const app = await electron.launch({
  executablePath: require("electron"),
  args: [".", `--user-data-dir=${userDataDir}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_PROJECTS_DIR: projectsDir },
});
const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(2000);

let passed = 0;
const findings = [];
function check(label, ok, detail) {
  if (ok) { passed += 1; console.log(`  ✓ ${label}`); }
  else { findings.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

try {
  // 取证 1：冷启动首页快照
  await win.screenshot({ path: path.join(shotsDir, "cold-01-library.png") });

  // CS0：确认确实是全新安装——项目库为空、模型目录零文本模型。
  // 经主进程桥 window.nomiDesktop.modelCatalog 读（built dist 下可用；不走 dev-only 的 /src import）。
  const initial = await win.evaluate(() => {
    let textModels = -1;
    try {
      const mc = window.nomiDesktop?.modelCatalog;
      if (mc) textModels = mc.listModels({ kind: "text", enabled: true }).length;
    } catch { /* ignore */ }
    const projectCards = document.querySelectorAll('[data-project-card]').length;
    return { textModels, projectCards };
  });
  console.log(`\n── 冷启动初始状态 ──\n  文本模型数=${initial.textModels}，项目卡数=${initial.projectCards}`);
  check("全新安装：项目库为空（0 张项目卡）", initial.projectCards === 0, `projectCards=${initial.projectCards}`);
  check("全新安装：模型目录查询成功", initial.textModels >= 0, `textModels=${initial.textModels}`);

  // CS1：空库直接落标准项目库页——动作卡片「新建空白项目 / 打开已有文件夹」可见可点。
  const libraryProbe = await win.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".tc-action-card"));
    const titles = cards.map((el) => el.querySelector("span span")?.textContent?.trim() || "");
    return {
      actionCardCount: cards.length,
      hasNewBlank: titles.some((t) => /新建空白项目/.test(t)),
      hasOpenFolder: titles.some((t) => /打开已有文件夹/.test(t)),
      // hero 已删：确认不再渲染旧的「30 秒体验」主 CTA / 介绍标题
      heroGone: !document.querySelector("[data-try-now-hero-cta], [data-hero-title]"),
      titles,
    };
  });
  console.log("\n── CS1：空库 = 标准项目库页（动作卡片入口）──");
  check("空库渲染动作卡片（≥2 张 .tc-action-card）", libraryProbe.actionCardCount >= 2, `count=${libraryProbe.actionCardCount}`);
  check("可见「新建空白项目」主入口", libraryProbe.hasNewBlank, `titles=${JSON.stringify(libraryProbe.titles)}`);
  check("可见「打开已有文件夹」入口", libraryProbe.hasOpenFolder, `titles=${JSON.stringify(libraryProbe.titles)}`);
  check("旧空库介绍 hero / 「30 秒体验」CTA 已删除（不再渲染）", libraryProbe.heroGone);

  // CS2：目录状态决定入口形态。最新版可预置文本模型，不能再硬编码“新安装必为零”。
  // hasTextModel 异步查询完成后，有模型显示弱入口；无模型显示升权恢复条。
  const banner = win.locator("[data-model-banner]").first();
  await banner.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
  const bannerProbe = await win.evaluate(() => {
    const el = document.querySelector("[data-model-banner]");
    if (!el) return { shown: false, hasCta: false };
    const ctaBtn = Array.from(el.querySelectorAll("button")).find((b) => /接入文本模型/.test(b.textContent || ""));
    return { shown: true, hasCta: Boolean(ctaBtn) };
  });
  const normalEntryVisible = await win.locator('[aria-label="模型接入"]:visible').count() > 0;
  console.log("\n── CS2：模型目录状态与接入入口互斥 ──");
  check("模型入口与目录状态一致", initial.textModels > 0 ? normalEntryVisible && !bannerProbe.shown : bannerProbe.shown && !normalEntryVisible,
    `models=${initial.textModels}, normal=${normalEntryVisible}, banner=${bannerProbe.shown}`);
  if (initial.textModels === 0) check("状态条带「接入文本模型」按钮", bannerProbe.hasCta);

  if (initial.textModels === 0 && bannerProbe.shown && bannerProbe.hasCta) {
    // 点状态条「接入文本模型」→ 应打开模型接入面板，让用户当场能填 key 往下走（不死路）。
    await win.locator("[data-model-banner] button", { hasText: "接入文本模型" }).first().click().catch(() => {});
    await win.waitForTimeout(1200);
    await win.screenshot({ path: path.join(shotsDir, "cold-02-after-model-cta.png") });
    const onboardingOpen = await win.evaluate(() =>
      Boolean(document.querySelector('[aria-label="模型设置"], [aria-label="模型接入"]')),
    );
    check("点「接入文本模型」打开模型接入面板（不死路）", onboardingOpen, `onboardingOpen=${onboardingOpen}`);
  } else if (initial.textModels > 0) {
    await win.locator('[aria-label="模型接入"]:visible').click();
    await win.waitForTimeout(800);
    const onboardingOpen = await win.evaluate(() =>
      Boolean(document.querySelector('[aria-label="模型设置"], [aria-label="模型接入"]')),
    );
    check("常态「模型接入」入口可打开目录（不死路）", onboardingOpen, `onboardingOpen=${onboardingOpen}`);
  }

  console.log(`\n冷启动 J3：${passed} 项达标，${findings.length} 项断路/缺口`);
  if (findings.length) {
    console.log("断路/缺口清单：\n - " + findings.join("\n - "));
    process.exitCode = 1;
  } else {
    console.log("✅ 冷启动 J3 全通");
  }
} catch (error) {
  console.error(`\nERROR: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(projectsDir, { recursive: true, force: true });
}
