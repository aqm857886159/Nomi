// C-2 助手合并走查（R13）：验证 app 级统一 dock 跟随 workspaceMode + 折叠/展开。
// 用法：pnpm run build && node tests/ux/assistant-merge.walk.mjs [label]
import { _electron as electron } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const label = process.argv[2] || "live";
const SHOTS = path.join(repoRoot, "tests/ux/shots");

const app = await electron.launch({
  executablePath: require("electron"),
  args: ["."],
  cwd: repoRoot,
  env: { ...process.env, NOMI_E2E_SMOKE: "1" },
});
const log = (...a) => console.log(" ", ...a);
const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(1500);
async function shot(step) {
  const p = path.join(SHOTS, `merge-${label}-${step}.png`);
  await win.screenshot({ path: p });
  log("shot:", step);
}
async function clickMode(name) {
  await win.getByRole("button", { name, exact: false }).first().click();
  await win.waitForTimeout(900);
}

try {
  await win.locator('[role="button"]', { hasText: "示例：30 秒产品介绍" }).first().click();
  await win.waitForTimeout(2500);
  log("opened project:", win.url());

  // generation (default) — dock collapsed → launcher bottom-right
  await shot("01-gen-collapsed");
  const launcher = win.getByRole("button", { name: "打开助手", exact: false }).first();
  log("launcher visible:", await launcher.isVisible().catch(() => false));
  await launcher.click();
  await win.waitForTimeout(800);
  await shot("02-gen-expanded"); // should show 生成 assistant body

  // switch to creation while expanded → body swaps to 创作
  await clickMode("创作");
  await shot("03-creation-expanded"); // should show 创作 assistant body, full-width editor behind

  // preview → dock hidden
  await clickMode("预览");
  await shot("04-preview-nodock");

  // back to generation, then collapse via 收起 AI
  await clickMode("生成");
  await shot("05-gen-expanded-again");
  const collapse = win.getByRole("button", { name: "收起 AI", exact: false }).first();
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
    await win.waitForTimeout(600);
    await shot("06-gen-collapsed-again");
  }

  log("WALK DONE");
} catch (error) {
  console.error("WALK ERROR:", error?.message || error);
  await shot("error");
} finally {
  await app.close().catch(() => undefined);
}
