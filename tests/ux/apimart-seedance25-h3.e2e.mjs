// APIMart Seedance 2.5 / MiniMax-H3 真实异步链路验收（R13）。
// 覆盖：Seedance 2.5 文生视频、MiniMax-H3 768P 文生视频、H3 Context-IR 提示词增强，
// 以及用同一 H3 768P task_id 调 MiniMax-H3-Regeneration 再生成。
// 会消耗真实额度，默认跳过；显式 APIMART_E2E=1（使用 app 已保存的 key）或
// APIMART_API_KEY=... 才执行。用法：pnpm run build && APIMART_E2E=1 node tests/ux/apimart-seedance25-h3.e2e.mjs
import { launchNomiApp } from "./_launchApp.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.APIMART_E2E && !process.env.APIMART_API_KEY) {
  console.log("SKIP apimart-seedance25-h3.e2e: 会花额度。显式 APIMART_E2E=1 或 APIMART_API_KEY 才跑。");
  process.exit(0);
}

const ENV_KEY = process.env.APIMART_API_KEY;
const ONLY = new Set((process.env.ONLY || "").split(",").map((value) => value.trim()).filter(Boolean));
const REGEN_TASK_ID = (process.env.APIMART_REGEN_TASK_ID || "").trim();
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-apimart-seedance25-h3-"));
const savedCatalog = path.join(os.homedir(), "Library/Application Support/nomi/model-catalog.json");
if (!ENV_KEY && fs.existsSync(savedCatalog)) {
  fs.copyFileSync(savedCatalog, path.join(userDataDir, "model-catalog.json"));
}

function assert(condition, message) {
  if (!condition) throw new Error(`E2E FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

const { app, win } = await launchNomiApp({
  name: "apimart-seedance25-h3",
  userDataDir,
  settingsDir: userDataDir,
  projectsDir: userDataDir,
  settleMs: 1500,
});

async function pollTask(win, initial, taskKind, modelKey, prompt) {
  let result = initial;
  const terminal = new Set(["succeeded", "failed"]);
  for (let i = 0; i < 80 && !terminal.has(result.status); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    try {
      const response = await win.evaluate(async (payload) => window.nomiDesktop.tasks.result(payload), {
        taskId: initial.id,
        vendor: "apimart",
        taskKind,
        prompt,
        modelKey,
      });
      result = response?.result ?? result;
      console.log(`    ${modelKey} poll ${i + 1}: ${result.status}`);
    } catch (error) {
      console.log(`    ${modelKey} poll ${i + 1}: transient error, retrying (${error?.message || error})`);
    }
  }
  assert(result.status === "succeeded", `${modelKey} 任务成功（${result.error || result.status}）`);
  return result;
}

async function runTask(win, { kind, modelKey, prompt, extras }) {
  const grant = await win.evaluate(() => window.nomiDesktop.tasks.grantSpend({ nodeIds: [] }));
  assert(Boolean(grant?.grantId), `${modelKey} 取得付费确认令牌`);
  const initial = await win.evaluate(async (payload) => window.nomiDesktop.tasks.run(payload), {
    vendor: "apimart",
    request: { kind, prompt, extras: { ...extras, modelKey, grantId: grant.grantId } },
  });
  assert(Boolean(initial?.id), `${modelKey} createTask 接受（${initial?.status}）`);
  console.log(`    taskId=${initial.id}`);
  return pollTask(win, initial, kind, modelKey, prompt);
}

try {
  if (ENV_KEY) {
    const stored = await win.evaluate((key) => window.nomiDesktop.modelCatalog.upsertVendorApiKey("apimart", { apiKey: key, enabled: true }), ENV_KEY);
    assert(Boolean(stored?.hasApiKey), "APIMart API key 已写入（env 覆盖）");
  } else {
    const vendors = await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors());
    const apimart = (vendors || []).find((vendor) => vendor.key === "apimart");
    if (!apimart?.hasApiKey) {
      console.log("SKIP apimart-seedance25-h3.e2e: app 未配置 APIMart API key。");
      process.exitCode = 0;
      throw new Error("__skip__");
    }
    assert(true, "使用 app 已保存的 APIMart API key");
  }

  const catalog = await win.evaluate(async () => ({
    // D2 读路径是 ipcRenderer.invoke，返回 Promise；先 await 才能使用数组方法。
    models: await window.nomiDesktop.modelCatalog.listModels({ kind: "video" }),
    textModels: await window.nomiDesktop.modelCatalog.listModels({ kind: "text" }),
  }));
  const videoKeys = catalog.models.map((model) => model.modelKey);
  const textKeys = catalog.textModels.map((model) => model.modelKey);
  assert(videoKeys.includes("doubao-seedance-2.5"), "目录包含 APIMart Seedance 2.5");
  assert(videoKeys.includes("MiniMax-H3"), "目录包含 APIMart MiniMax-H3");
  assert(videoKeys.includes("MiniMax-H3-Regeneration"), "目录包含 APIMart MiniMax-H3-Regeneration");
  assert(textKeys.includes("MiniMax-H3-Context-IR"), "目录包含 APIMart MiniMax-H3 Context-IR");

  if (ONLY.has("resume-regeneration")) {
    assert(Boolean(REGEN_TASK_ID), "已提供 APIMART_REGEN_TASK_ID");
    const regeneration = await pollTask(
      win,
      { id: REGEN_TASK_ID, status: "queued" },
      "text_to_video",
      "MiniMax-H3-Regeneration",
      "",
    );
    assert(regeneration.assets.some((asset) => asset.type === "video" && asset.url), "MiniMax-H3-Regeneration 返回 2K 视频 asset");
    process.exitCode = 0;
  }

  if (!ONLY.size || ONLY.has("seedance")) {
    const seedance = await runTask(win, {
      kind: "text_to_video",
      modelKey: "doubao-seedance-2.5",
      prompt: "a quiet sunrise over the sea, a slow cinematic camera push-in",
      extras: { size: "16:9", resolution: "480p", duration: 4, generate_audio: false, watermark: false, output_format: "mp4", return_last_frame: false },
    });
    assert(seedance.assets.some((asset) => asset.type === "video" && asset.url), "Seedance 2.5 返回视频 asset");
  }

  let h3;
  if (!ONLY.size || ONLY.has("h3") || ONLY.has("regeneration")) {
    h3 = await runTask(win, {
      kind: "text_to_video",
      modelKey: "MiniMax-H3",
      prompt: "a paper boat drifting through a rainy city street, cinematic tracking shot",
      extras: { resolution: "768P", aspect_ratio: "16:9", duration: 4, watermark: false },
    });
    assert(h3.assets.some((asset) => asset.type === "video" && asset.url), "MiniMax-H3 返回 768P 视频 asset");
  }

  if (!ONLY.size || ONLY.has("context")) {
    const contextIr = await runTask(win, {
      kind: "prompt_refine",
      modelKey: "MiniMax-H3-Context-IR",
      prompt: "把一个雨夜城市街道的镜头提示词增强为可直接生成的视频提示词",
      extras: { duration: 4, aspect_ratio: "16:9" },
    });
    const contextRaw = contextIr.raw;
    const contextText = contextRaw?.data?.result?.prompt || contextRaw?.result?.prompt || "";
    assert(typeof contextText === "string" && contextText.trim().length > 0, "Context-IR 返回增强后的 prompt 文本");
  }

  if ((!ONLY.size || ONLY.has("regeneration")) && h3) {
    const regeneration = await runTask(win, {
      kind: "text_to_video",
      modelKey: "MiniMax-H3-Regeneration",
      prompt: "",
      extras: { source_task_id: h3.id },
    });
    assert(regeneration.assets.some((asset) => asset.type === "video" && asset.url), "MiniMax-H3-Regeneration 返回 2K 视频 asset");
  }

  console.log("\nAPIMART-SEDANCE25-H3 E2E PASS");
} catch (error) {
  if (error?.message !== "__skip__") {
    console.error(`\n${error?.message || error}`);
    process.exitCode = 1;
  }
} finally {
  await app.close().catch(() => undefined);
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
