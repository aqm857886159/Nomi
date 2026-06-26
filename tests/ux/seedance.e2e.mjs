// 完整端到端（规则 13）：用 Playwright 驱动**真实构建产物**，走 app 自己的运行时把一次
// Seedance「首帧」生成跑通——UI/preload → IPC → runtime(taskTemplateParams) → 内置 mapping
// → 真实 kie createTask → recordInfo 轮询 → resultJson 解析 → 视频 asset。
//
// **会花真实额度**，故用 KIE_API_KEY 环境变量门控：没设就跳过（CI 不跑、文件里无密钥）。
// 用法：pnpm run build && KIE_API_KEY=xxxx node tests/ux/seedance.e2e.mjs
//   可选 SEEDANCE_FIRST_FRAME=<图片URL> 指定首帧（默认用一张公开测试图）。720p + generate_audio:false 省额度。
import { _electron as electron } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const KEY = process.env.KIE_API_KEY;
if (!KEY) {
  console.log("SKIP seedance.e2e: 未设 KIE_API_KEY（这条会花额度，按需手动跑）。");
  process.exit(0);
}
const FIRST_FRAME = process.env.SEEDANCE_FIRST_FRAME || "https://picsum.photos/seed/nomi-e2e/1280/720";

let passed = 0;
function assert(cond, label) {
  if (!cond) throw new Error(`E2E FAIL: ${label}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

const app = await electron.launch({
  executablePath: require("electron"),
  args: ["."],
  cwd: repoRoot,
  env: { ...process.env, NOMI_E2E_SMOKE: "1" },
});

try {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(1500);

  // 1) 启动即 seed 生效（内置 Seedance 在目录里）
  const seeded = await win.evaluate(() => {
    const mc = window.nomiDesktop?.modelCatalog;
    const m = mc?.listModels({ kind: "video", enabled: true })?.find((x) => x.modelKey === "bytedance/seedance-2");
    return Boolean(m) && m?.meta?.archetypeId === "seedance-2";
  });
  assert(seeded, "启动后 Seedance 在目录、带 archetypeId");

  // 2) 把 kie API key 填进内置 vendor（safeStorage 加密存）
  const keySet = await win.evaluate((key) => window.nomiDesktop.modelCatalog.upsertVendorApiKey("kie", { apiKey: key, enabled: true }), KEY);
  assert(keySet?.hasApiKey, "kie API key 已设置");

  // 2.5) 付费守卫令牌（2026-06-21 spend gate）：真生成前铸一颗（模拟真人点确认卡），随 extras.grantId 下传。
  //      用**生产同款** grantSpend IPC（不在 enforcement 层加 e2e 旁路 → 不削弱「真人确认才铸」安全性）。
  //      默认 3 次预算覆盖本 e2e 两次 createTask（首帧主生成 + Mini id 探针），都落 GENERIC_NODE_KEY。
  const { grantId } = await win.evaluate(() => window.nomiDesktop.tasks.grantSpend({ nodeIds: [] }));
  assert(grantId, "铸付费令牌成功（grantSpend IPC，模拟真人确认）");

  // 3) 经 app runtime 发起一次 Seedance 首帧生成（真实 createTask + 内置 mapping）
  const initial = await win.evaluate(async (args) => {
    return await window.nomiDesktop.tasks.run({
      vendor: "kie",
      request: {
        kind: "image_to_video",
        prompt: args.prompt,
        extras: {
          modelKey: "bytedance/seedance-2", // findExecutableModel 据基础 catalog 行解析 vendor/model
          grantId: args.grantId, // 付费守卫令牌
          // 变体合并后 body 取 {{request.params.model}} + {{request.params.first_frame_url}}（不再 extras.firstFrameUrl）；
          // 真实流程由 buildArchetypeInputParams 产出 archetypeInput={ model, first_frame_url }，e2e 须自带（同 apimart）。
          archetypeInput: { model: "bytedance/seedance-2", first_frame_url: args.frame },
          resolution: "720p",
          aspect_ratio: "16:9",
          duration: "5",
          generate_audio: false,
        },
      },
    });
  }, { prompt: "a gentle slow cinematic zoom-in on the scene", frame: FIRST_FRAME, grantId });
  assert(initial?.id, "app runtime 返回 taskId（createTask 经内置 mapping 成功）");
  console.log(`    taskId=${initial.id} status=${initial.status}`);

  // 4) 经 app runtime 轮询（真实 recordInfo + 状态归一 + resultJson 解析）
  let final = initial;
  const terminal = new Set(["succeeded", "failed"]);
  for (let i = 0; i < 40 && !terminal.has(final.status); i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const resp = await win.evaluate(async (args) => {
      return await window.nomiDesktop.tasks.result({
        taskId: args.id,
        vendor: "kie",
        taskKind: "image_to_video",
        prompt: args.prompt,
        modelKey: "bytedance/seedance-2",
      });
    }, { id: initial.id, prompt: "a gentle slow cinematic zoom-in on the scene" });
    final = resp?.result ?? final;
    console.log(`    poll ${i + 1}: ${final.status}`);
  }

  assert(final.status === "succeeded", `生成成功（status=${final.status}）`);
  const video = (final.assets || []).find((a) => a.type === "video" && a.url);
  assert(video, "返回视频 asset（resultJson.resultUrls 解析正确）");
  console.log(`    video=${video.url}`);

  // 5) Mini 变体 model id live 核实：kie 文档页枚举疑似从 fast 页克隆（强制 enum 写 -fast，描述写 -mini）。
  //    只发 createTask（不轮询出片）确认 `bytedance/seedance-2-mini` 被接受、未 400 unknown-model——省额度。
  //    若返回 taskId → mini id 真实可用（落地正确）；若失败 → 说明该 id 不被接受，需回退（不落 mini 变体）。
  const mini = await win.evaluate(async (args) => {
    try {
      const r = await window.nomiDesktop.tasks.run({
        vendor: "kie",
        request: {
          kind: "image_to_video",
          prompt: args.prompt,
          // modelKey=基础行（findExecutableModel）；body 的 params.model 取变体 mini id（archetypeInput.model）——
          // 这正是真实流程：节点 modelKey 钉基础行、variantId=mini → out.model=bytedance/seedance-2-mini。
          extras: { modelKey: "bytedance/seedance-2", grantId: args.grantId, archetypeInput: { model: "bytedance/seedance-2-mini", first_frame_url: args.frame }, resolution: "480p", aspect_ratio: "16:9", duration: "4", generate_audio: false },
        },
      });
      return { id: r?.id || null, status: r?.status || null, error: null };
    } catch (e) { return { id: null, status: null, error: String(e?.message || e) }; }
  }, { prompt: "a gentle slow cinematic zoom-in on the scene", frame: FIRST_FRAME, grantId });
  assert(mini.id, `Mini 变体 createTask 被 kie 接受（model=bytedance/seedance-2-mini, taskId=${mini.id || "—"}${mini.error ? ", err=" + mini.error : ""}）`);
  console.log(`    mini taskId=${mini.id} status=${mini.status}`);

  console.log(`\nSEEDANCE E2E PASS: ${passed} assertions`);
} catch (error) {
  console.error(`\n${error?.message || error}`);
  await app.close();
  process.exit(1);
} finally {
  await app.close().catch(() => undefined);
}
