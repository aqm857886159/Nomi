// C-2 助手合并走查（R13）：开示例项目 → 截生成区助手 → 切创作区截图。
// 用法：pnpm run build && node tests/ux/assistant-merge.walk.mjs [label]
// 截图落 tests/ux/shots/merge-<label>-<step>.png。零额度（不触发真实 AI）。
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
async function shot(step) {
  const p = path.join(SHOTS, `merge-${label}-${step}.png`);
  await win.screenshot({ path: p });
  log("shot:", p);
}

const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(1500);

try {
  // open example project
  await win.locator('[role="button"]', { hasText: "示例：30 秒产品介绍" }).first().click();
  await win.waitForTimeout(2500);
  log("opened example project, url:", win.url());

  // default mode is generation → screenshot assistant area
  await shot("01-generation");

  // switch to creation
  await win.getByRole("button", { name: "创作", exact: false }).first().click();
  await win.waitForTimeout(1200);
  await shot("02-creation");

  // switch to preview
  await win.getByRole("button", { name: "预览", exact: false }).first().click();
  await win.waitForTimeout(1000);
  await shot("03-preview");

  // back to generation
  await win.getByRole("button", { name: "生成", exact: false }).first().click();
  await win.waitForTimeout(1000);
  await shot("04-generation-again");

  log("WALK DONE");
} catch (error) {
  console.error("WALK ERROR:", error?.message || error);
  await shot("error");
} finally {
  await app.close().catch(() => undefined);
}
