// 真·用户旅程穿透走查（规则 13）—— 我以真实用户视角把核心创作流程点一遍，每步截图（全窗 + 节点特写），
// 零额度（不真生成、不导出）。产出 tests/ux/shots/journey-*.png 供多模态体感判断。
import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shotsDir = path.join(repoRoot, "tests/ux/shots");
fs.mkdirSync(shotsDir, { recursive: true });

let step = 0;
async function snap(win, name, { composer = false } = {}) {
  step += 1;
  const tag = `${String(step).padStart(2, "0")}-${name}`;
  await win.screenshot({ path: path.join(shotsDir, `journey-${tag}.png`) });
  if (composer) {
    const node = win.locator(".generation-canvas-v2-node__composer").last();
    try { await node.screenshot({ path: path.join(shotsDir, `journey-${tag}-node.png`) }); } catch { /* not present */ }
  }
  console.log(`  · ${tag}`);
}

const app = await electron.launch({ executablePath: require("electron"), args: ["."], cwd: repoRoot, env: { ...process.env } });
const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(1500);

try {
  // 1) 第一印象：项目库
  await snap(win, "library");

  // 2) 进一个示例项目
  await win.locator('[role="button"]', { hasText: "示例：30 秒产品介绍" }).first().click();
  await win.waitForTimeout(2500);
  await snap(win, "studio-open");

  // 3) 进生成画布
  await win.getByRole("button", { name: "生成", exact: false }).first().click().catch(() => {});
  await win.waitForTimeout(1200);
  await snap(win, "canvas");

  // 4) 加一个视频节点 → 第一眼看到节点 composer
  await win.getByRole("button", { name: "添加视频节点", exact: false }).first().click();
  await win.waitForTimeout(1500);
  await snap(win, "video-node-added", { composer: true });

  const modelSelect = win.locator('.generation-canvas-v2-node__composer select[aria-label="模型"]').last();
  await modelSelect.waitFor({ state: "visible", timeout: 8000 });

  // 5) 选 Seedance → 模式条 + 参数
  await modelSelect.selectOption({ label: "Seedance 2.0" }).catch(() => modelSelect.selectOption("bytedance/seedance-2"));
  await win.waitForTimeout(1000);
  await snap(win, "seedance-first", { composer: true });

  // 5b) 打开设置弹层 → 看带标签的标量参数
  await win.locator('.generation-canvas-v2-node__composer button[aria-label="生成设置"]').first().click().catch(() => {});
  await win.waitForTimeout(600);
  await snap(win, "settings-open", { composer: true });
  await win.locator('.generation-canvas-v2-node__composer button[aria-label="生成设置"]').first().click().catch(() => {}); // 收起
  await win.waitForTimeout(400);

  // 6) 切首尾帧
  await win.locator('.generation-canvas-v2-node__composer [role="group"][aria-label="生成方式"] button', { hasText: "首尾帧" }).first().click();
  await win.waitForTimeout(800);
  await snap(win, "seedance-firstlast", { composer: true });

  // 7) 切全能参考 → 数组槽
  await win.locator('.generation-canvas-v2-node__composer [role="group"][aria-label="生成方式"] button', { hasText: "全能参考" }).first().click();
  await win.waitForTimeout(800);
  await snap(win, "seedance-omni", { composer: true });

  // 8) 放一张角色图（上传） → 看 chip + 徽标 + promptCue
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const tmp = path.join(shotsDir, "_j.png");
  fs.writeFileSync(tmp, Buffer.from(png, "base64"));
  await win.locator('.generation-canvas-v2-node__composer button[aria-label="添加角色参考"]').first().click();
  await win.waitForTimeout(400);
  await win.locator('.generation-canvas-v2-node__composer input[type="file"][aria-label="上传角色参考"]').first().setInputFiles(tmp);
  await win.waitForTimeout(2500);
  await snap(win, "seedance-omni-char", { composer: true });

  // 9) 切到 HappyHorse → 4 模式
  await modelSelect.selectOption({ label: "HappyHorse 1.0" }).catch(() => modelSelect.selectOption("happyhorse"));
  await win.waitForTimeout(1000);
  await snap(win, "happyhorse-t2v", { composer: true });
  await win.locator('.generation-canvas-v2-node__composer [role="group"][aria-label="生成方式"] button', { hasText: "视频编辑" }).first().click();
  await win.waitForTimeout(800);
  await snap(win, "happyhorse-edit", { composer: true });

  // 10) 别的标签页看一眼（创作 / 预览）
  await win.getByRole("button", { name: "创作", exact: false }).first().click().catch(() => {});
  await win.waitForTimeout(1200);
  await snap(win, "creation-tab");
  await win.getByRole("button", { name: "预览", exact: false }).first().click().catch(() => {});
  await win.waitForTimeout(1200);
  await snap(win, "preview-tab");

  fs.rmSync(tmp, { force: true });
  console.log("\nJOURNEY 截图完成。");
} catch (e) {
  console.log("JOURNEY_ERROR:", e?.message || e);
  await snap(win, "error");
} finally {
  await app.close().catch(() => {});
}
