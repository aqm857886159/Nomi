// 穿透式体验走查 harness（CLAUDE.md 规则 13）—— Playwright _electron 驱动真实 app。
// 用法: node tests/ux/walkthrough.mjs
// 产出: tests/ux/shots/*.png 截图 + stdout 的每步 DOM/可点击元素清单。
//
// 真实用户旅程逐步驱动；每步截图 + dump 交互元素，由多模态判断体感。
// 真实外呼/花额度步骤（调 AI 生成、导出）默认不跑。
import { launchNomiApp } from "./_launchApp.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shotsDir = path.join(repoRoot, "tests/ux/shots");
fs.mkdirSync(shotsDir, { recursive: true });

// 复用 start-electron.mjs 的 onboarding agent key 注入逻辑。
function onboardingEnv() {
  const out = {};
  let key = process.env.NOMI_ONBOARDING_AGENT_KEY || "";
  const keyPath = path.join(repoRoot, ".secrets", "agent.key");
  if (!key && fs.existsSync(keyPath)) {
    try { key = fs.readFileSync(keyPath, "utf8").trim(); } catch { /* ignore */ }
  }
  if (!key) return out;
  out.NOMI_ONBOARDING_AGENT_KEY = key;
  out.NOMI_ONBOARDING_AGENT_BASE_URL = process.env.NOMI_ONBOARDING_AGENT_BASE_URL || "https://dm-fox.rjj.cc/codex/v1";
  out.NOMI_ONBOARDING_AGENT_MODEL = process.env.NOMI_ONBOARDING_AGENT_MODEL || "gpt-5.5";
  out.NOMI_ONBOARDING_AGENT_PROVIDER = process.env.NOMI_ONBOARDING_AGENT_PROVIDER || "openai-compatible";
  return out;
}

let stepNo = 0;
async function snap(win, name) {
  stepNo += 1;
  const tag = `${String(stepNo).padStart(2, "0")}-${name}`;
  await win.screenshot({ path: path.join(shotsDir, `${tag}.png`) });
  const info = await win.evaluate(() => ({
    title: document.title,
    url: location.href,
    headings: Array.from(document.querySelectorAll("h1,h2,h3")).map((e) => e.textContent.trim()).filter(Boolean).slice(0, 12),
    clickables: Array.from(document.querySelectorAll('button, [role="button"], a, [role="tab"], input, textarea'))
      .map((e) => {
        const t = (e.innerText || e.value || e.placeholder || e.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
        return t ? `${e.tagName.toLowerCase()}${e.getAttribute("role") ? `[${e.getAttribute("role")}]` : ""}: ${t.slice(0, 50)}` : "";
      })
      .filter(Boolean)
      .slice(0, 40),
  }));
  console.log(`\n===== STEP ${tag} =====`);
  console.log("title:", info.title, "| url:", info.url);
  console.log("headings:", JSON.stringify(info.headings));
  console.log("clickables:");
  for (const c of info.clickables) console.log("  -", c);
  return info;
}

const { app, win } = await launchNomiApp({ name: "walkthrough", env: onboardingEnv() });

try {

  // ===== 走查路径（逐步加深；每次按上一轮截图所见扩展）=====
  await snap(win, "library");

  // 真实用户：点进一个示例项目看工作台（用示例项目，不碰真实数据）
  try {
    await win.locator('[role="button"]', { hasText: "示例：30 秒产品介绍" }).first().click();
    await win.waitForTimeout(2500);
    await snap(win, "studio-generate");
  } catch (e) {
    console.log("OPEN_PROJECT_ERROR:", e?.message || e);
  }

  // 零成本导航腿：依次看 创作 / 预览 / 素材库 / 模型接入
  async function clickTab(name, tag, { escAfter = false } = {}) {
    try {
      await win.getByRole("button", { name, exact: false }).first().click();
      await win.waitForTimeout(1500);
      await snap(win, tag);
      if (escAfter) { await win.keyboard.press("Escape"); await win.waitForTimeout(500); }
    } catch (e) {
      console.log(`TAB_ERROR(${tag}):`, e?.message || e);
    }
  }
  await clickTab("创作", "creation");
  await clickTab("预览", "preview");
  await clickTab("模型接入", "model-onboarding", { escAfter: true });

  // ===== 导出腿（真实 ffmpeg，写文件到项目 exports/，不花 API 额度）=====
  try {
    await win.getByRole("button", { name: "预览", exact: false }).first().click();
    await win.waitForTimeout(1200);
    await win.getByRole("button", { name: "导出 MP4", exact: false }).first().click();
    console.log("EXPORT_CLICKED, 等待 ffmpeg…");
    let toast = "";
    for (let i = 0; i < 45; i++) {
      await win.waitForTimeout(2000);
      toast = await win.evaluate(() =>
        Array.from(document.querySelectorAll("body *"))
          .map((e) => (e.children.length === 0 ? (e.textContent || "").replace(/\s+/g, " ").trim() : ""))
          .filter((t) => /导出|exports|MP4|失败|error|转码|渲染/i.test(t))
          .slice(0, 6)
          .join(" || "),
      );
      if (/已导出|exports 文件夹|失败|error/i.test(toast)) break;
    }
    console.log("EXPORT_STATUS:", toast || "(无明显状态文本)");
    await snap(win, "export-done");
  } catch (e) {
    console.log("EXPORT_ERROR:", e?.message || e);
  }
} catch (e) {
  console.log("WALKTHROUGH_ERROR:", e?.message || e);
} finally {
  await app.close();
}
