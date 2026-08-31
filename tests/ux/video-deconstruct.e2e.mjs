// 批 1 验收门：视频拆解管线**真实素材端到端**。
//
// 为什么必须真跑：单测只能钉住纯函数（时间戳归属、采样点、schema 拼接），
// 证不了「切镜→抽帧→多帧读图→取音轨→转写→归属」串起来是通的，更证不了拆出来的东西**像人话**。
//
// 判定：① 拆出 ≥2 镜且镜号连续 ② 每镜时间区间首尾相接、覆盖全片 ③ 画面描述/景别非空
//      ④ 有音轨时对白列有内容 ⑤ 失败镜诚实回报在 failedShotIndexes
// 最后把整张表打出来**人眼看**——"跑通了"不等于"拆得对"（P3）。
//
// **会花真实额度**（每镜 3 帧 ≈ 3.2k image token + 输出）。闸：DECONSTRUCT_E2E=1 才跑。
// 用法：pnpm run build && DECONSTRUCT_E2E=1 node tests/ux/video-deconstruct.e2e.mjs [视频路径]
import { launchNomiApp, repoRoot } from "./_launchApp.mjs";
import fs from "node:fs";
import path from "node:path";

if (!process.env.DECONSTRUCT_E2E) {
  console.log("SKIP video-deconstruct.e2e: 会花额度。DECONSTRUCT_E2E=1 node tests/ux/video-deconstruct.e2e.mjs 才跑。");
  process.exit(0);
}

const VIDEO = process.argv[2] || "/Users/aoqimin/Desktop/教nomi学新功能/Custom recording 2026-08-03 01-29-20.mp4";
if (!fs.existsSync(VIDEO)) {
  console.log(`SKIP: 找不到测试视频 ${VIDEO}`);
  process.exit(0);
}

const base = "/tmp/nomi-deconstruct-e2e";
const settingsDir = path.join(base, "settings");
const projectsDir = path.join(base, "projects");
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(settingsDir, { recursive: true });
fs.mkdirSync(projectsDir, { recursive: true });
const realCatalog = "/Users/aoqimin/Library/Application Support/nomi/model-catalog.json";
if (fs.existsSync(realCatalog)) fs.copyFileSync(realCatalog, path.join(settingsDir, "model-catalog.json"));

const fail = [];
const check = (name, ok, detail) => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail.push(name);
};

const { app, win } = await launchNomiApp({ name: "video-deconstruct", userDataDir: settingsDir, settingsDir, projectsDir });
try {
  if (process.env.APIMART_API_KEY) {
    await win.evaluate(
      (key) => window.nomiDesktop.modelCatalog.upsertVendorApiKey("apimart", { apiKey: key, enabled: true }),
      process.env.APIMART_API_KEY,
    );
  }
  await win.evaluate(() => {
    for (const k of ["nomi:splash:v1", "nomi:journey-tour:v1", "nomi:canvas-gesture-hint:v1"]) window.localStorage.setItem(k, "seen");
  });
  await win.reload();
  await win.waitForTimeout(2000);
  for (let i = 0; i < 6; i++) {
    const s = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成/ }).first();
    if (await s.count()) await s.click({ timeout: 1200 }).catch(() => {});
    await win.keyboard.press("Escape").catch(() => {});
    await win.waitForTimeout(250);
  }

  // 建项目 + 把视频导入成项目素材（拿到 nomi-local:// URL，和用户拖进来走同一条路）。
  const bytes = fs.readFileSync(VIDEO);
  const setup = await win.evaluate(async (b64) => {
    const created = await window.nomiDesktop.projects.create({ name: "拆解走查" });
    const projectId = created?.data?.id || created?.id;
    if (!projectId) return { error: "建项目失败" };
    window.nomiDesktop.projects?.setActive?.(projectId);
    const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    // 和用户拖素材进来走同一条路（assetUploadApi.importWorkbenchLocalAssetFile 的形状）。
    const saved = await window.nomiDesktop.assets.importFile({
      projectId, bytes: binary.buffer, contentType: "video/mp4", fileName: "reference.mp4", kind: "upload",
    });
    return { projectId, url: saved?.data?.url || saved?.url || "" };
  }, bytes.toString("base64"));
  if (setup.error || !setup.url) {
    console.log("SKIP: 素材导入失败 —", JSON.stringify(setup).slice(0, 200));
    await app.close();
    process.exit(0);
  }
  console.log(`  → 素材已入库：${setup.url.slice(0, 60)}`);

  const t0 = Date.now();
  const out = await win.evaluate(
    async ({ url, projectId }) => {
      try {
        return { ok: true, data: await window.nomiDesktop.video.deconstruct({ videoUrl: url, projectId }) };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },
    { url: setup.url, projectId: setup.projectId },
  );
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (!out.ok) {
    console.log(`\n❌ 拆解抛错：${out.error}`);
    await app.close();
    process.exit(1);
  }
  const { shots, durationSeconds, hasAudio, failedShotIndexes } = out.data;
  console.log(`\n拆解完成：${shots.length} 镜 · 全片 ${durationSeconds.toFixed(1)}s · 音轨 ${hasAudio ? "有" : "无"} · 耗时 ${secs}s`);

  check("拆出 ≥2 个镜头", shots.length >= 2, `${shots.length} 镜`);
  check("镜号从 1 连续递增", shots.every((s, i) => s.index === i + 1), shots.map((s) => s.index).join(","));
  const contiguous = shots.every((s, i) => i === 0 || Math.abs(s.startSeconds - shots[i - 1].endSeconds) < 0.01);
  check("镜头区间首尾相接（不重叠不留缝）", contiguous);
  check("覆盖到片尾", Math.abs(shots[shots.length - 1].endSeconds - durationSeconds) < 0.5);
  const described = shots.filter((s) => s.visual && s.shotSize).length;
  check("每镜都读出了画面描述+景别", described === shots.length, `${described}/${shots.length}`);
  const withFrame = shots.filter((s) => s.sourceFrameUrl).length;
  check("每镜都有原片帧（只读对照）", withFrame === shots.length, `${withFrame}/${shots.length}`);
  if (hasAudio) {
    const spoken = shots.filter((s) => s.dialogue).length;
    check("有音轨 → 对白列有内容", spoken > 0, `${spoken}/${shots.length} 镜有词`);
  }
  check("失败镜诚实回报", Array.isArray(failedShotIndexes), `failed=[${failedShotIndexes.join(",")}]`);

  console.log("\n———— 拆出来的表（人眼看这一段，别只看勾）————");
  for (const s of shots) {
    console.log(`\n[镜 ${s.index}] ${s.startSeconds.toFixed(1)}–${s.endSeconds.toFixed(1)}s · ${s.shotSize || "?"} · ${s.mood || "?"}${s.carriedOver ? " · 承接上镜" : ""}${s.visionFailed ? " · ⚠️画面分析失败" : ""}`);
    console.log(`  画面：${s.visual || "(空)"}`);
    if (s.onScreenText) console.log(`  屏幕字：${s.onScreenText}`);
    if (s.dialogue) console.log(`  对白：${s.dialogue}`);
    console.log(`  画面提示词：${(s.imagePrompt || "(空)").slice(0, 90)}`);
    console.log(`  运镜提示词：${(s.motionPrompt || "(空)").slice(0, 70)}`);
  }
  console.log(fail.length ? `\n❌ 未达标 ${fail.length} 项：${fail.join("、")}` : "\n✅ 全部达标");
} finally {
  await app.close();
}
process.exit(fail.length ? 1 : 0);
