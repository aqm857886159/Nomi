// 出站策略修复的**真实付费**验收：证明「提交 → 轮询 → 取回产物 → 落盘」这条核心链路
// 在本机真实网络下走得通（R13 真机走查 / P3 全绿≠完成）。
//
// 为什么现有的 apimart-seedance25-h3.e2e.mjs 不够：它不传 projectId，于是 runtime 走
// `unlocalizedTaskAsset`——**根本不下载**，只把厂商直链原样返回。而 2026-09-06 验收里坏掉的
// 恰恰是下载那一步（localizeTaskAsset → importRemoteAsset → hardenedFetch 被自家 SSRF 门岗拒绝）。
// 所以这里必须传 projectId，并断言产物真的变成了 `nomi-local://` 且**文件真的躺在磁盘上**。
//
// 零密钥经手：与既有付费 e2e 同款——把用户已保存的 model-catalog.json 拷进隔离 userDataDir，
// safeStorage 同机可解，本脚本一个字节的明文密钥都不碰、不打印。
//
// 花费：默认只跑一张图（约 ¥0.1）。加 WITH_VIDEO=1 才跑一条 MiniMax-H3 768P/4s（约 ¥2.4）。
// 用法：pnpm run build && APIMART_E2E=1 node tests/ux/outbound-policy-paid-retrieval.e2e.mjs
import { launchNomiApp } from "./_launchApp.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.APIMART_E2E) {
  console.log("SKIP outbound-policy-paid-retrieval.e2e: 会花真实额度。显式 APIMART_E2E=1 才跑。");
  process.exit(0);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-outbound-paid-"));
const userDataDir = path.join(root, "settings");
const projectsDir = path.join(root, "projects");
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(projectsDir, { recursive: true });
const savedCatalog = path.join(os.homedir(), "Library/Application Support/nomi/model-catalog.json");
if (fs.existsSync(savedCatalog)) fs.copyFileSync(savedCatalog, path.join(userDataDir, "model-catalog.json"));

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(`E2E FAIL: ${message}`);
  passed += 1;
  console.log(`  ✓ ${message}`);
}

const { app, win } = await launchNomiApp({
  name: "outbound-policy-paid-retrieval",
  userDataDir,
  settingsDir: userDataDir,
  projectsDir,
  settleMs: 1500,
});

async function pollUntilTerminal(taskId, taskKind, modelKey, prompt, projectId, maxPolls) {
  let result = { id: taskId, status: "queued" };
  const terminal = new Set(["succeeded", "failed"]);
  for (let i = 0; i < maxPolls && !terminal.has(result.status); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 6000));
    try {
      const response = await win.evaluate(
        async (payload) => window.nomiDesktop.tasks.result(payload),
        { taskId, vendor: "apimart", taskKind, prompt, modelKey, projectId },
      );
      result = response?.result ?? result;
      console.log(`    ${modelKey} poll ${i + 1}: ${result.status}`);
    } catch (error) {
      // 轮询失败**绝不**冒泡成重新提交（钱已经付了）；如实记录后继续查。
      console.log(`    ${modelKey} poll ${i + 1}: transient (${String(error?.message || error).slice(0, 120)})`);
    }
  }
  return result;
}

async function generateAndRetrieve({ kind, modelKey, prompt, extras, projectId, maxPolls }) {
  const grant = await win.evaluate(() => window.nomiDesktop.tasks.grantSpend({ nodeIds: [] }));
  assert(Boolean(grant?.grantId), `${modelKey} 取得付费令牌`);
  let result = await win.evaluate(
    async (payload) => window.nomiDesktop.tasks.run(payload),
    { vendor: "apimart", request: { kind, prompt, extras: { ...extras, modelKey, projectId, grantId: grant.grantId } } },
  );
  assert(Boolean(result?.id), `${modelKey} 提交被受理（${result?.status}）`);
  console.log(`    taskId=${result.id}`);
  if (result.status !== "succeeded") {
    result = await pollUntilTerminal(result.id, kind, modelKey, prompt, projectId, maxPolls);
  }
  assert(result.status === "succeeded", `${modelKey} 上游成功（${result.error || result.status}）`);
  return result;
}

/** 断言这条产物**真的落了盘**——不是拿着一个会过期的厂商直链就算完。 */
function assertLandedOnDisk(result, modelKey) {
  const asset = (result.assets || [])[0];
  assert(Boolean(asset?.url), `${modelKey} 返回了 asset`);
  assert(
    String(asset.url).startsWith("nomi-local://"),
    `${modelKey} 产物已本地化成 nomi-local://（拿到的是 ${String(asset.url).slice(0, 60)}）`,
  );
  const relative = decodeURIComponent(new URL(asset.url).pathname.replace(/^\/+/, "")).split("/").slice(1).join("/");
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(projectsDir);
  const landed = files.find((file) => file.endsWith(path.basename(relative)));
  assert(Boolean(landed), `${modelKey} 产物文件真的写到了磁盘（${path.basename(relative)}）`);
  const bytes = fs.statSync(landed).size;
  assert(bytes > 1024, `${modelKey} 落盘文件非空（${(bytes / 1024).toFixed(0)} KB）`);
  return bytes;
}

try {
  const vendors = await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors());
  const apimart = (vendors || []).find((vendor) => vendor.key === "apimart");
  if (!apimart?.hasApiKey) {
    console.log("SKIP outbound-policy-paid-retrieval.e2e: app 未配置 APIMart API key。");
    process.exitCode = 0;
    throw new Error("__skip__");
  }
  assert(true, "使用 app 已保存的 APIMart key（本脚本不经手明文）");

  const project = await win.evaluate(() => window.nomiDesktop.projects.create({ name: "outbound-policy-paid-retrieval" }));
  const projectId = project?.id || project?.project?.id;
  assert(Boolean(projectId), "建了隔离项目（不碰用户真实资料库）");

  const imageModels = await win.evaluate(() => window.nomiDesktop.modelCatalog.listModels({ kind: "image" }));
  const image = (imageModels || []).find((model) => model.vendorKey === "apimart" && model.enabled);
  assert(Boolean(image), `目录里有可用的 APIMart 图像模型（${image?.modelKey || "无"}）`);

  const imageResult = await generateAndRetrieve({
    kind: "text_to_image",
    modelKey: image.modelKey,
    prompt: "a single paper boat on wet asphalt at night, cinematic, moody",
    extras: {},
    projectId,
    maxPolls: 40,
  });
  const imageBytes = assertLandedOnDisk(imageResult, image.modelKey);

  let videoBytes = 0;
  if (process.env.WITH_VIDEO === "1") {
    const videoResult = await generateAndRetrieve({
      kind: "text_to_video",
      modelKey: "MiniMax-H3",
      prompt: "a paper boat drifting down a rainy city street, slow cinematic tracking shot",
      extras: { resolution: "768P", aspect_ratio: "16:9", duration: 4, watermark: false },
      projectId,
      maxPolls: 80,
    });
    videoBytes = assertLandedOnDisk(videoResult, "MiniMax-H3");
  }

  console.log(`\n落盘合计：图 ${(imageBytes / 1024).toFixed(0)} KB${videoBytes ? ` · 视频 ${(videoBytes / 1024 / 1024).toFixed(1)} MB` : " · 视频未跑（WITH_VIDEO=1 才跑）"}`);
  console.log(`OUTBOUND-POLICY PAID RETRIEVAL E2E PASS（${passed} 项）`);
} catch (error) {
  if (error?.message !== "__skip__") {
    console.error(`\n${error?.message || error}`);
    process.exitCode = 1;
  }
} finally {
  await app.close().catch(() => undefined);
  fs.rmSync(root, { recursive: true, force: true });
}
