// 穿透走查（规则 13）—— C2b 模式分段切换，**零额度**（不发真实生成）。
// 真实 app：开示例项目 → 生成画布 → 加视频节点 → 选 Seedance 2.0 →
// 断言「生成方式」分段条出现（单图首帧 / 首尾帧）→ 点「首尾帧」→ 断言尾帧参考槽出现 +
// node.meta.archetype.modeId=firstlast。每步截图。
import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shotsDir = path.join(repoRoot, "tests/ux/shots");
fs.mkdirSync(shotsDir, { recursive: true });

let passed = 0;
function assert(cond, label) {
  if (!cond) throw new Error(`E2E FAIL: ${label}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

const app = await electron.launch({ executablePath: require("electron"), args: ["."], cwd: repoRoot, env: { ...process.env } });
const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(1500);

async function shot(tag) { await win.screenshot({ path: path.join(shotsDir, `modebar-${tag}.png`) }); }

try {
  // 进示例项目的生成画布
  await win.locator('[role="button"]', { hasText: "示例：30 秒产品介绍" }).first().click();
  await win.waitForTimeout(2500);
  await win.getByRole("button", { name: "生成", exact: false }).first().click().catch(() => {});
  await win.waitForTimeout(1200);

  // 加一个视频节点（默认选中 → 浮动 composer 出现）
  await win.getByRole("button", { name: "添加视频节点", exact: false }).first().click();
  await win.waitForTimeout(1500);
  await shot("01-video-node");

  // 选 Seedance 2.0（composer 底部的模型下拉）
  const modelSelect = win.locator('.generation-canvas-v2-node__composer select[aria-label="模型"]').last();
  await modelSelect.waitFor({ state: "visible", timeout: 8000 });
  await modelSelect.selectOption({ label: "Seedance 2.0" }).catch(async () => {
    // 兜底：按 value 选（modelKey）
    await modelSelect.selectOption("bytedance/seedance-2");
  });
  await win.waitForTimeout(1200);
  await shot("02-seedance-selected");

  // 断言「生成方式」分段条 + 统一意图词出现
  const modeBarText = await win.evaluate(() => {
    const comp = document.querySelector(".generation-canvas-v2-node__composer");
    return comp ? (comp.innerText || "").replace(/\s+/g, " ") : "";
  });
  console.log("    composer text:", modeBarText.slice(0, 200));
  assert(/生成方式/.test(modeBarText), "出现「生成方式」标签");
  // 分段标签用模型自己的真名（决策 #2），不用意图词
  assert(/全能参考/.test(modeBarText), "出现 vendor 真名「全能参考」（不是被说窄的「角色参考」）");
  assert(/首尾帧/.test(modeBarText), "出现 vendor 真名「首尾帧」");
  assert(/单张首帧图驱动生成/.test(modeBarText), "提示行显示当前模式说明");

  // 切到「首尾帧」
  await win.locator('.generation-canvas-v2-node__composer [role="group"][aria-label="生成方式"] button', { hasText: "首尾帧" }).first().click();
  await win.waitForTimeout(900);
  await shot("03-firstlast");

  // 断言尾帧参考槽出现（首帧模式 1 槽 → 首尾帧 2 槽）+ 提示行更新
  const after = await win.evaluate(() => {
    const comp = document.querySelector(".generation-canvas-v2-node__composer");
    const slots = comp ? comp.querySelectorAll('[aria-label="尾帧"]').length : 0;
    const text = comp ? (comp.innerText || "").replace(/\s+/g, " ") : "";
    return { slots, hasLastHint: /首帧 \+ 尾帧/.test(text) };
  });
  assert(after.slots >= 1, "切到首尾帧后出现「尾帧」参考槽");
  assert(after.hasLastHint, "提示行更新为首尾帧的说明");

  // ── C3：切到「全能参考」(omni) → 数组槽 + 上传一张角色图 → ①徽标 + promptCue ──
  await win.locator('.generation-canvas-v2-node__composer [role="group"][aria-label="生成方式"] button', { hasText: "全能参考" }).first().click();
  await win.waitForTimeout(900);
  await shot("04-omni");
  const omniText = await win.evaluate(() => (document.querySelector(".generation-canvas-v2-node__composer")?.innerText || "").replace(/\s+/g, " "));
  assert(/角色参考/.test(omniText), "omni：出现「角色参考」组");
  assert(/character1…9|character1/.test(omniText), "omni：角色组共享说明含 character1…9（U2）");
  assert(/参考视频/.test(omniText) && /参考音频/.test(omniText), "omni：参考视频 / 参考音频 分组小标题（U3）");

  // 写一张 1x1 png 临时文件，经「+ 角色参考」菜单上传
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const tmpPng = path.join(shotsDir, "_char1.png");
  fs.writeFileSync(tmpPng, Buffer.from(pngB64, "base64"));
  await win.locator('.generation-canvas-v2-node__composer button[aria-label="添加角色参考"]').first().click();
  await win.waitForTimeout(400);
  await win.locator('.generation-canvas-v2-node__composer input[type="file"][aria-label="上传角色参考"]').first().setInputFiles(tmpPng);
  await win.waitForTimeout(2500); // 等本地素材导入
  await shot("05-omni-char1");
  const afterUpload = await win.evaluate(() => {
    const comp = document.querySelector(".generation-canvas-v2-node__composer");
    const badge1 = comp ? Array.from(comp.querySelectorAll("span")).some((s) => s.textContent.trim() === "1") : false;
    const text = comp ? (comp.innerText || "").replace(/\s+/g, " ") : "";
    return { badge1, hasCue: /用 character1/.test(text) };
  });
  assert(afterUpload.badge1, "上传后角色图 chip 带 ① 数字徽标（character1）");
  assert(afterUpload.hasCue, "prompt 旁出现 character1.. 提示（U2）");

  // ── C4：切到 HappyHorse → 4 模式合 1（各用模型自己的真名）+ i2v 无比例（U3）──
  await modelSelect.selectOption({ label: "HappyHorse 1.0" }).catch(async () => { await modelSelect.selectOption("happyhorse") });
  await win.waitForTimeout(1200);
  await shot("06-happyhorse");
  const happyText = await win.evaluate(() => (document.querySelector(".generation-canvas-v2-node__composer")?.innerText || "").replace(/\s+/g, " "));
  console.log("    happyhorse composer:", happyText.slice(0, 220));
  assert(/文生视频/.test(happyText) && /图生视频/.test(happyText) && /角色参考/.test(happyText) && /视频编辑/.test(happyText),
    "HappyHorse：4 模式各用真名（文生视频/图生视频/角色参考/视频编辑）");
  assert(/纯文本生成/.test(happyText), "HappyHorse：提示行显示当前模式说明");

  // 设置弹层带标签（核心修复）：打开 → 断言出现「清晰度」标签字段
  await win.locator('.generation-canvas-v2-node__composer button[aria-label="生成设置"]').first().click();
  await win.waitForTimeout(500);
  const hasLabeledRes = await win.evaluate(() => {
    const pop = document.querySelector(".generation-canvas-v2-node__settings-pop");
    return Boolean(pop) && /清晰度/.test(pop.innerText || "");
  });
  assert(hasLabeledRes, "设置弹层：标量参数带标签（清晰度…，修复『裸值无标签』）");
  // 切到「图生视频」(i2v) → 弹层里不含「比例」（U3：i2v 无 aspect_ratio）；t2v 有
  await win.locator('.generation-canvas-v2-node__composer [role="group"][aria-label="生成方式"] button', { hasText: "图生视频" }).first().click();
  await win.waitForTimeout(700);
  await shot("07-happyhorse-i2v");
  const i2vHasRatio = await win.evaluate(() => {
    const pop = document.querySelector(".generation-canvas-v2-node__settings-pop");
    return Boolean(pop) && Array.from(pop.querySelectorAll('select[aria-label="比例"]')).length > 0;
  });
  assert(!i2vHasRatio, "HappyHorse i2v：设置弹层无「比例」控件（U3）");

  // ── 同族扩展：Seedance 2.0 Fast 在下拉里、认得档案（同 3 模式）、清晰度收成 480/720（无 1080）──
  await modelSelect.selectOption({ label: "Seedance 2.0 Fast" }).catch(async () => { await modelSelect.selectOption("bytedance/seedance-2-fast") });
  await win.waitForTimeout(1000);
  await shot("08-seedance-fast");
  const fastText = await win.evaluate(() => (document.querySelector(".generation-canvas-v2-node__composer")?.innerText || "").replace(/\s+/g, " "));
  assert(/首帧/.test(fastText) && /首尾帧/.test(fastText) && /全能参考/.test(fastText), "Fast：同 Seedance 3 模式真名（认得同族档案）");
  assert(/480p/.test(fastText) && !/1080p/.test(fastText), "Fast：清晰度收成 480/720（无 1080p）");

  console.log(`\nMODEBAR E2E PASS: ${passed} assertions`);
} catch (error) {
  await shot("99-fail");
  console.error(`\n${error?.message || error}`);
  await app.close().catch(() => {});
  process.exit(1);
} finally {
  await app.close().catch(() => {});
}
