// 生成探针（规则13）：开示例项目 → 生成画布 → 选中单个节点 → 找单节点生成控件 →
// 点单个生成（避开"全部生成"批量）→ 观察 loading/结果。会真实调 AI、花额度（用户已授权"都跑"）。
import { launchNomiApp } from "./_launchApp.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shotsDir = path.join(repoRoot, "tests/ux/shots");
fs.mkdirSync(shotsDir, { recursive: true });

function onboardingEnv() {
  const out = {};
  let key = process.env.NOMI_ONBOARDING_AGENT_KEY || "";
  const keyPath = path.join(repoRoot, ".secrets", "agent.key");
  if (!key && fs.existsSync(keyPath)) { try { key = fs.readFileSync(keyPath, "utf8").trim(); } catch {} }
  if (!key) return out;
  out.NOMI_ONBOARDING_AGENT_KEY = key;
  out.NOMI_ONBOARDING_AGENT_BASE_URL = process.env.NOMI_ONBOARDING_AGENT_BASE_URL || "https://dm-fox.rjj.cc/codex/v1";
  out.NOMI_ONBOARDING_AGENT_MODEL = process.env.NOMI_ONBOARDING_AGENT_MODEL || "gpt-5.5";
  out.NOMI_ONBOARDING_AGENT_PROVIDER = process.env.NOMI_ONBOARDING_AGENT_PROVIDER || "openai-compatible";
  return out;
}

const { app, win } = await launchNomiApp({ name: "probe-generate", env: onboardingEnv() });
try {
  await win.locator('[role="button"]', { hasText: "示例：30 秒产品介绍" }).first().click();
  await win.waitForTimeout(2500);
  // 确保在生成 tab
  try { await win.getByRole("button", { name: "生成", exact: true }).first().click(); await win.waitForTimeout(1200); } catch {}

  // 选中第一个生成节点（点画布上的节点卡）
  const nodeSel = '[data-node-id], [class*="generation-canvas-v2__node"], [class*="GenerationNode"], [class*="node-card"]';
  const nodeCount = await win.locator(nodeSel).count();
  console.log("候选节点元素数:", nodeCount);
  if (nodeCount > 0) {
    await win.locator(nodeSel).first().click({ position: { x: 30, y: 20 } }).catch((e) => console.log("node click:", e?.message));
    await win.waitForTimeout(1200);
  }

  // dump 所有含"生成"的按钮（区分单节点 vs 批量）
  const genButtons = await win.evaluate(() =>
    Array.from(document.querySelectorAll('button, [role="button"]'))
      .map((e) => (e.innerText || e.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim())
      .filter((t) => /生成|重新生成|regenerate/i.test(t))
  );
  console.log("含'生成'的控件:", JSON.stringify(genButtons));
  await win.screenshot({ path: path.join(shotsDir, "07-generate-node-selected.png") });
  console.log("SNAP: 07-generate-node-selected.png");
} catch (e) {
  console.log("PROBE_ERROR:", e?.message || e);
} finally {
  await app.close();
}
