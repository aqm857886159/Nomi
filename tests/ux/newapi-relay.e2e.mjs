// 真实端到端（verify-first，Issue #8）：对着**忠实 mock new-api**（tests/transport-spike/newapi-mock.mjs）
// 验证 Nomi 自己写的全部传输代码——把一个 new-api 中转的图片/视频模型接进来、并真实「生成」跑通：
//   ① manualCommit 带 per-model kind → 建 image(同步 /v1/images/generations) + video(异步 + 轮询) mapping
//   ② tasks.run 图片 → 同步取 data[0].url 出资产
//   ③ tasks.run 视频 → 提交拿 task_id → 轮询 GET /v1/video/generations/{id} → succeeded 取 data[0].url 出资产
// 不需要真实付费中转。真实 vendor 字段差异由防御式 extractAssetUrl + reporter 探测确认。
//
// 用法：pnpm run build && node tests/ux/newapi-relay.e2e.mjs
import { _electron as electron } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MOCK_PORT = 8799;
const MOCK_BASE = `http://localhost:${MOCK_PORT}`;

function startMock() {
  const p = spawn(process.execPath, [path.join(repoRoot, "tests/transport-spike/newapi-mock.mjs")], {
    env: { ...process.env, NEWAPI_MOCK_PORT: String(MOCK_PORT) }, stdio: "inherit",
  });
  return p;
}

const mock = startMock();
await new Promise((r) => setTimeout(r, 800));

// 隔离 user-data-dir：不污染开发者真实 catalog（fresh 实例，本测自己 commit mock 中转）。
import os from "node:os";
import fs from "node:fs";
const isolatedUserData = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-e2e-newapi-"));
const app = await electron.launch({ executablePath: require("electron"), args: [".", "--disable-gpu", `--user-data-dir=${isolatedUserData}`], cwd: repoRoot, env: { ...process.env } });
const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); }

try {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(1200);

  // ① 接入：manualCommit 一个 new-api 中转（指向 mock），混合图片+视频。
  console.log("\n▶ ① 接入 new-api 中转（mock）");
  const commit = await win.evaluate(async (base) => {
    return await window.nomiDesktop.onboarding.manualCommit({
      vendorName: "Mock NewAPI", baseUrl: base, apiKey: "sk-mock", providerKind: "openai-compatible",
      models: [{ id: "dall-e-3", kind: "image" }, { id: "kling-v1", kind: "video" }],
    });
  }, MOCK_BASE);
  check("manualCommit ok", !!commit?.ok, commit?.error || `vendor=${commit?.vendorKey} 模型=${commit?.committed?.length}`);
  const vendorKey = commit?.vendorKey;

  // 模型落对类型？
  const models = await win.evaluate((vk) => (window.nomiDesktop.modelCatalog.listModels({ vendorKey: vk }) || []).map((m) => ({ k: m.modelKey, kind: m.kind })), vendorKey);
  check("图片模型 kind=image", models.some((m) => m.k === "dall-e-3" && m.kind === "image"));
  check("视频模型 kind=video", models.some((m) => m.k === "kling-v1" && m.kind === "video"));

  // ② 图片生成（同步）。
  console.log("\n▶ ② 图片生成（同步 /v1/images/generations）");
  const img = await win.evaluate(async (vk) => {
    return await window.nomiDesktop.tasks.run({ vendor: vk, request: { kind: "text_to_image", prompt: "a red maple leaf", extras: { modelKey: "dall-e-3", size: "1024x1024" } } });
  }, vendorKey);
  const imgUrl = (img?.assets || []).find((a) => a.url)?.url;
  check("图片出资产", img?.status === "succeeded" && !!imgUrl, `status=${img?.status} url=${(imgUrl || "").slice(0, 48)}`);

  // ③ 视频生成（异步：提交 → 轮询）。
  console.log("\n▶ ③ 视频生成（异步 /v1/video/generations + 轮询）");
  const create = await win.evaluate(async (vk) => {
    return await window.nomiDesktop.tasks.run({ vendor: vk, request: { kind: "text_to_video", prompt: "a paper boat", extras: { modelKey: "kling-v1", duration: 5, size: "16:9" } } });
  }, vendorKey);
  check("视频提交拿 taskId", !!create?.id, `id=${create?.id} status=${create?.status}`);
  let vfinal = create;
  for (let i = 0; i < 12 && !["succeeded", "failed"].includes(vfinal?.status); i++) {
    await win.waitForTimeout(2000);
    const r = await win.evaluate(async (a) => window.nomiDesktop.tasks.result({ taskId: a.id, vendor: a.vk, taskKind: "text_to_video", prompt: "a paper boat", modelKey: "kling-v1" }), { id: create.id, vk: vendorKey });
    vfinal = r?.result ?? vfinal;
    console.log(`   poll ${i + 1}: ${vfinal?.status}`);
  }
  const vidUrl = (vfinal?.assets || []).find((a) => a.url)?.url;
  check("视频出资产", vfinal?.status === "succeeded" && !!vidUrl, `status=${vfinal?.status} url=${(vidUrl || "").slice(0, 48)}`);
} catch (err) {
  check("e2e 异常", false, String(err?.message || err));
} finally {
  await app.close().catch(() => undefined);
  mock.kill();
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n═══ new-api 中转 E2E：${pass}/${results.length} 通过 ═══`);
process.exit(pass === results.length ? 0 : 1);
