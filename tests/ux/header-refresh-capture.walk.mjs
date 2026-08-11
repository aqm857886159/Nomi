// R13 走查截图：验本次「顶栏/窗口刷新」的跨平台可见改动（mac 上跑）。
// 截：① 项目库（mac 原生窗口 + 右上操作在原位）② 工作台（侧栏激活 Tab 只显 icon + 画布导航栏右下 + AI 面板）。
import { launchNomiApp } from "./_launchApp.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = process.env.NOMI_SHOT_DIR || path.join(repoRoot, ".tmp", "header-refresh-shots");

const { app, win } = await launchNomiApp({ name: "header-refresh-capture", env: { NOMI_E2E_SMOKE: "1" }, settleMs: 1800 });

async function shot(w, name) {
  const p = path.join(outDir, `${name}.png`);
  await w.screenshot({ path: p });
  console.log(`  📸 ${p}`);
}

try {
  // ① 项目库
  await win.getByText("项目库", { exact: false }).first().waitFor({ timeout: 8000 });
  await shot(win, "01-library");

  // ② 开项目 → 工作台
  const projectCard = win.locator("[data-project-card]").first();
  if ((await projectCard.count()) > 0) await projectCard.click();
  else await win.getByText("新建空白项目", { exact: false }).first().click();
  await win.waitForTimeout(2800);
  await shot(win, "02-workbench");

  // 切到「生成」画布看导航栏 + AI 面板
  const genTab = win.getByRole("button", { name: "生成", exact: false }).first();
  if (await genTab.isVisible().catch(() => false)) {
    await genTab.click();
    await win.waitForTimeout(2000);
    await shot(win, "03-generation-canvas");
  }

  // 侧栏 Tab 状态：依次点 找素材/分类/文件，各截一张看激活态只显 icon
  for (const [label, key] of [["找素材", "find"], ["分类", "categories"], ["文件", "files"]]) {
    const tab = win.locator(`button[title="${label}"]`).first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click();
      await win.waitForTimeout(900);
      await shot(win, `04-sidebar-${key}-active`);
    }
  }

  console.log("\nCAPTURE DONE");
} catch (error) {
  console.error(`\nCAPTURE FAIL: ${error?.message || error}`);
  await app.close().catch(() => undefined);
  process.exit(1);
} finally {
  await app.close().catch(() => undefined);
}
