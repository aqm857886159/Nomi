// 完整端到端（规则 13 + 接入即验证）：用 Playwright 驱动**真实构建产物**，走 app 自己的运行时把一次
// apimart Seedance「首尾帧」(image_with_roles) 真实生成跑通——
//   UI/preload → IPC → runtime(taskTemplateParams) → 内置 apimart mapping → 真实 apimart createTask
//   → 轮询 → resultJson 解析 → 视频 asset。
//
// **会花真实额度**。key 处理：默认用 app 里**已配置的 apimart key**（dev userData 的 catalog 自解密，
// 无需明文）；若设了 APIMART_API_KEY 则覆盖写入。apimart 未配 key → SKIP（不失败）。
// 用法：pnpm run build && node tests/ux/seedance-apimart.e2e.mjs
//   可选 APIMART_API_KEY=xxx（覆盖）/ SEEDANCE_FF=<首帧URL> / SEEDANCE_LF=<尾帧URL>。720p + 无音频省额度。
import { _electron as electron } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// 额度安全闸（opt-in）：默认跳过，防跑 e2e 套件时误烧额度。显式 APIMART_E2E=1（用 app 已配的 key）
// 或设 APIMART_API_KEY=xxx 才真跑。对齐 seedance.e2e 的「不显式就不花钱」。
if (!process.env.APIMART_E2E && !process.env.APIMART_API_KEY) {
  console.log("SKIP seedance-apimart.e2e: 会花额度。显式 APIMART_E2E=1 node tests/ux/seedance-apimart.e2e.mjs 才跑（用 app 已配 apimart key）。");
  process.exit(0);
}
const FIRST = process.env.SEEDANCE_FF || "https://picsum.photos/seed/nomi-ff/1280/720";
const LAST = process.env.SEEDANCE_LF || "https://picsum.photos/seed/nomi-lf/1280/720";
const ENV_KEY = process.env.APIMART_API_KEY;

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
  env: { ...process.env },
});

try {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(1500);

  // 1) apimart Seedance 在目录、带 apimart 档案（M-C seed 生效）。
  //    变体合并（2026-06-16）后：fast/face/fast-face 不再是独立 catalog 行，而是档案 variants
  //    （逐变体能力/清晰度由 archetypeMeta.test.ts / index.test.ts 单测钉死）→ 这里只核 catalog 真相：
  //    唯一基础行在 + 旧 3 独立变体行已退役 + 带正确 archetypeId。
  const models = await win.evaluate(() => {
    const mc = window.nomiDesktop?.modelCatalog;
    const list = mc?.listModels({ kind: "video" }) || [];
    const keys = list.map((m) => m.modelKey);
    const std = list.find((m) => m.modelKey === "doubao-seedance-2.0");
    const retired = ["doubao-seedance-2.0-fast", "doubao-seedance-2.0-face", "doubao-seedance-2.0-fast-face"];
    return {
      hasStd: keys.includes("doubao-seedance-2.0"),
      retiredGone: !keys.some((k) => retired.includes(k)),
      archetypeId: std?.meta?.archetypeId,
    };
  });
  assert(models.hasStd, "apimart Seedance 标准档在目录（doubao-seedance-2.0，变体合并后唯一 catalog 行）");
  assert(models.retiredGone, "旧 3 独立变体行已退役（fast/face/fast-face 现为档案 variants，非 catalog 行）");
  assert(models.archetypeId === "seedance-2-apimart", "标准版带 archetypeId=seedance-2-apimart");

  // 2) apimart key：env 覆盖，否则用已存的
  if (ENV_KEY) {
    const set = await win.evaluate((key) => window.nomiDesktop.modelCatalog.upsertVendorApiKey("apimart", { apiKey: key, enabled: true }), ENV_KEY);
    assert(set?.hasApiKey, "apimart key 已写入（env 覆盖）");
  } else {
    const vendors = await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors());
    const apimart = (vendors || []).find((v) => v.key === "apimart" || v.vendorKey === "apimart");
    const hasKey = Boolean(apimart && (apimart.hasApiKey || apimart.enabledApiKey));
    if (!hasKey) {
      console.log("SKIP seedance-apimart.e2e: apimart 未配 API key（在 app「模型接入」里配，或设 APIMART_API_KEY）。");
      await app.close();
      process.exit(0);
    }
    assert(true, "apimart 已配 key（用已存的，自解密）");
  }

  // 2.5) 付费守卫令牌（2026-06-21 spend gate）：真生成前铸一颗（模拟真人点确认卡），随 extras.grantId 下传。
  //      用**生产同款** grantSpend IPC（不在 enforcement 层加任何 e2e 旁路 → 不削弱「真人确认才铸」安全性）。
  //      nodeIds:[] → 通用占位 key；本 e2e 不传 nodeId → 主进程 enforcement 也落到 GENERIC_NODE_KEY，匹配。
  const { grantId } = await win.evaluate(() => window.nomiDesktop.tasks.grantSpend({ nodeIds: [] }));
  assert(grantId, "铸付费令牌成功（grantSpend IPC，模拟真人确认）");

  // 3) 经 app runtime 发起一次 apimart Seedance 首尾帧生成（真实 createTask + 内置 mapping）。
  //    image_with_roles 走 archetypeInput → referenceInputParams spread → request.params（与 image_urls 互斥）。
  const initial = await win.evaluate(async (a) => {
    return await window.nomiDesktop.tasks.run({
      vendor: "apimart",
      request: {
        kind: "image_to_video",
        prompt: a.prompt,
        extras: {
          modelKey: "doubao-seedance-2.0",
          grantId: a.grantId, // 付费守卫令牌
          size: "16:9",
          resolution: "720p",
          duration: 5, // number（真实渲染流程节点标量参数存的就是 number 5，见 taskParams.ts:39；string 会被 apimart 拒）
          generate_audio: false,
          archetypeInput: {
            // 变体合并（2026-06-16）后 catalog body 取 {{request.params.model}}（不再 extras.modelKey）；
            // 真实渲染流程由 buildArchetypeInputParams 把当前变体 modelKey 写进 archetypeInput.model →
            // taskTemplateParams 经 referenceInputParams 摊进 params.model。e2e 直调 runtime 须自带它。
            model: "doubao-seedance-2.0",
            image_with_roles: [
              { url: a.first, role: "first_frame" },
              { url: a.last, role: "last_frame" },
            ],
          },
        },
      },
    });
  }, { prompt: "smooth cinematic transition from the first scene to the last", first: FIRST, last: LAST, grantId });
  assert(initial?.id, "app runtime 返回 taskId（apimart createTask 接受 image_with_roles，未 400）");
  console.log(`    taskId=${initial.id} status=${initial.status}`);

  // 4) 轮询（真实状态 + resultJson 解析）
  let final = initial;
  const terminal = new Set(["succeeded", "failed"]);
  for (let i = 0; i < 50 && !terminal.has(final.status); i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const resp = await win.evaluate(async (a) => {
      return await window.nomiDesktop.tasks.result({
        taskId: a.id,
        vendor: "apimart",
        taskKind: "image_to_video",
        prompt: a.prompt,
        modelKey: "doubao-seedance-2.0",
      });
    }, { id: initial.id, prompt: "smooth cinematic transition from the first scene to the last" });
    final = resp?.result ?? final;
    console.log(`    poll ${i + 1}: ${final.status}`);
  }

  assert(final.status === "succeeded", `生成成功（status=${final.status}）—— image_with_roles 首尾帧结构被 apimart 接受并出片`);
  const video = (final.assets || []).find((a) => a.type === "video" && a.url);
  assert(video, "返回视频 asset");
  console.log(`    video=${video.url}`);

  // 5) M-A 视频接力抽帧：对刚生成的真实视频抽**尾帧**（验证 https 下载 → ffmpeg 输出端 seek →
  //    writeAsset → nomi-local 全链路；这正是「前一镜尾帧当后一镜首帧」的接力源帧）。
  let projectId = "";
  try {
    const proj = await win.evaluate(() => window.nomiDesktop.projects.create({ name: "e2e-frame-extract" }));
    projectId = proj?.id || proj?.summary?.id || "";
  } catch { /* 临时项目建失败 → 跳过抽帧验证 */ }
  if (projectId) {
    const frame = await win.evaluate(async (a) => {
      return await window.nomiDesktop.video.extractFrame({ videoUrl: a.url, which: "last", projectId: a.pid });
    }, { url: video.url, pid: projectId });
    assert(frame?.url && frame.url.startsWith("nomi-local://"), `M-A 抽帧：从真实视频抽出尾帧 → nomi-local 素材（${(frame?.url || "").slice(0, 56)}…）`);
    await win.evaluate((pid) => window.nomiDesktop.projects.delete(pid), projectId).catch(() => undefined);
  } else {
    console.log("  (跳过 M-A 抽帧验证：临时项目创建失败)");
  }

  console.log(`\nSEEDANCE-APIMART E2E PASS: ${passed} assertions`);
} catch (error) {
  console.error(`\n${error?.message || error}`);
  await app.close().catch(() => undefined);
  process.exit(1);
} finally {
  await app.close().catch(() => undefined);
}
