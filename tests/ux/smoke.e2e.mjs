// Playwright _electron 冒烟 e2e（规则 13/14）—— 可断言、可重复、零额度。
// 启动构建产物 → 断言主链路的关键 UI 真实渲染（项目库 → 开项目 → 画布工具栏/导出入口）。
// 任一断言失败即抛错、非零退出（CI-ready）。不触发真实 AI 生成/导出（不花额度）。
//
// 用法：pnpm run build && pnpm run test:e2e
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "nomi-smoke-e2e-"));
const userDataDir = path.join(tempRoot, "user-data");
const projectsDir = path.join(tempRoot, "projects");
mkdirSync(projectsDir, { recursive: true });

let passed = 0;
function assert(cond, label) {
  if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

const app = await electron.launch({
  executablePath: require("electron"),
  args: [".", `--user-data-dir=${userDataDir}`],
  cwd: repoRoot,
  env: {
    ...process.env,
    NOMI_E2E: "1",
    NOMI_E2E_SMOKE: "1",
    NOMI_E2E_ALLOW_MULTI_INSTANCE: "1",
    NOMI_ELECTRON_USER_DATA_DIR: userDataDir,
    NOMI_SETTINGS_DIR: userDataDir,
    NOMI_PROJECTS_DIR: projectsDir,
  },
});

try {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(1500);

  // 1) 主进程启动 + 渲染层加载（runtime.ts 拆分后的回归底线）
  assert((await win.title()).toLowerCase().includes("nomi"), "窗口标题含 Nomi");

  // 1b) 内置模型 seed 在启动时生效（ensureBuiltinModelSeeds）——Seedance 开箱在目录里、带 archetypeId。
  const seed = await win.evaluate(() => {
    const mc = window.nomiDesktop?.modelCatalog;
    if (!mc) return { ok: false };
    const seedance = mc.listModels({ kind: "video", enabled: true }).find((m) => m.modelKey === "bytedance/seedance-2");
    return {
      ok: true,
      hasKie: mc.listVendors().some((v) => v.key === "kie"),
      archetypeId: seedance?.meta?.archetypeId ?? null,
      hasMapping: mc.listMappings().some((mp) => mp.vendorKey === "kie" && mp.taskKind === "image_to_video"),
    };
  });
  assert(seed.ok && seed.hasKie, "启动后目录里有内置 kie vendor（seed 生效）");
  assert(seed.archetypeId === "seedance-2", "Seedance 模型在位且 meta.archetypeId=seedance-2");
  assert(seed.hasMapping, "(kie, image_to_video) mapping 在位");

  // 2) 项目库渲染（渲染 → IPC listProjects → projects/repository 真实数据）
  // 空库与有项目走同一套布局：主入口动作卡片「新建空白项目」恒在（hero 介绍首屏已删）。
  await win.getByText("项目库", { exact: false }).first().waitFor({ timeout: 8000 });
  const primaryCard = win.locator('[data-variant="primary"]', { hasText: "新建空白项目" });
  assert((await primaryCard.count()) > 0, "项目库主入口动作卡片「新建空白项目」可见");

  // 3) 开项目 → 工作台画布（开项目 → readProject/资产 → 画布挂载）
  // 优先打开已有项目卡（不污染库）；空库时走「新建空白项目」。
  const projectCard = win.locator("[data-project-card]").first();
  if ((await projectCard.count()) > 0) {
    await projectCard.click();
  } else {
    await win.getByText("新建空白项目", { exact: false }).first().click();
  }
  await win.waitForTimeout(2500);
  for (const name of ["创作", "生成", "预览", "导出"]) {
    assert(await win.getByRole("button", { name, exact: false }).first().isVisible(), `工作台工具栏「${name}」可见`);
  }
  assert(/projectId=/.test(win.url()), "工作台 URL 含 projectId");

  // 4) 生成画布 composer：超长提示词必须在编辑区内部滚动、底栏生成钮永远可点
  //（回归 2026-07-15：滚动容器无高度上限 → 长 prompt 溢出盖住底栏，提交钮点不到）。
  await win.getByRole("button", { name: "生成", exact: false }).first().click();
  await win.waitForTimeout(800);
  await win.locator('button[aria-label="添加图片节点"]').first().click();
  const composer = win.locator(".generation-canvas-v2-node__composer-card").first();
  await composer.waitFor({ timeout: 5000 });
  const longPrompt = Array.from({ length: 14 }, (_, i) => `第${i + 1}段：超长提示词溢出回归压测，逐行填满编辑区直到超过卡片高度上限，验证底栏不被盖住。`).join("\n");
  const promptInput = composer.locator(".generation-canvas-v2-node__prompt-input").first();
  await promptInput.click();
  await promptInput.fill(longPrompt);
  await win.waitForTimeout(500);
  // 画布平移：把 composer 拉进「AppBar 之下、窗口底之上」的可视带（节点落点随机，卡可能伸出窗口
  // → elementFromPoint 打在视口外恒 null，误报被挡）。wheel 落在远离卡片的空白区。
  for (let i = 0; i < 6; i++) {
    const box = await composer.boundingBox();
    if (!box) break;
    const vp = await win.evaluate(() => ({
      w: window.innerWidth,
      h: window.innerHeight,
      appbarBottom: document.querySelector(".nomi-appbar")?.getBoundingClientRect().bottom ?? 0,
    }));
    let dy = 0;
    if (box.y < vp.appbarBottom + 8) dy = box.y - (vp.appbarBottom + 8);
    else if (box.y + box.height > vp.h - 16) dy = Math.min(box.y + box.height - (vp.h - 16), box.y - (vp.appbarBottom + 8));
    if (Math.abs(dy) < 4) break;
    await win.mouse.move(vp.w - 80, Math.max(vp.appbarBottom + 40, 200));
    await win.mouse.wheel(0, dy);
    await win.waitForTimeout(250);
  }
  const composerCheck = await composer.evaluate((card) => {
    const editorEl = card.querySelector(".generation-canvas-v2-node__prompt-input");
    let scroller = editorEl;
    while (scroller && scroller !== card && !/(auto|scroll)/.test(window.getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const scrolls = Boolean(scroller && scroller !== card && scroller.scrollHeight > scroller.clientHeight);
    const btn = card.querySelector('button[aria-label="生成素材"], button[aria-label="重新生成"]');
    const r = btn?.getBoundingClientRect();
    const hitEl = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return { scrolls, btnClickable: Boolean(btn && hitEl && (btn === hitEl || btn.contains(hitEl))) };
  });
  assert(composerCheck.scrolls, "超长提示词在编辑区内部滚动（不撑爆卡片）");
  assert(composerCheck.btnClickable, "超长提示词下生成钮 hit-test 可点（底栏未被溢出文字盖住）");

  console.log(`\nSMOKE PASS: ${passed} assertions`);
} catch (error) {
  console.error(`\n${error?.message || error}`);
  await app.close();
  process.exit(1);
} finally {
  await app.close().catch(() => undefined);
}
