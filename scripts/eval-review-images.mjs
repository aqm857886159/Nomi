// Lane D 生成质量评测(VBench 维度)。扫真实项目里已生成的图/视频,VLM 按解耦维度 1-5 打分,
// 出质量分卡。报告型脚本:不写事件(单写者纪律),产出 JSONL+分卡供人复核。
// 只花 VLM 额度(生成早已发生),与主评测循环物理隔离,不碰 zeroVendorCalls。
//
// 配置复用 evals/judge.config.json,可加 "visionModel" 字段(缺省用 model)。
// 视频抽帧需系统 ffmpeg(导出链路已依赖);无 ffmpeg 则跳过视频并提示。
// 用法: pnpm eval:review-images <项目目录> [--limit 10]   (亦即 Lane D 的 eval:generate-quality)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadJudgeConfig } from "../evals/lib/judge.mjs";
import { scoreAssetWithVlm, IMAGE_DIMENSIONS, VIDEO_DIMENSIONS } from "../evals/lib/vbenchRubric.mjs";

const args = process.argv.slice(2);
const projectDir = args.find((a) => !a.startsWith("--"));
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Math.max(1, Number(args[limitIdx + 1]) || 10) : 10; // 抽样硬上限(控预算)
if (!projectDir || !fs.existsSync(projectDir)) {
  console.error("用法: pnpm eval:review-images <项目目录> [--limit 10]");
  process.exit(2);
}
const cfg = loadJudgeConfig();
if (!cfg) {
  console.error("缺 evals/judge.config.json({ baseUrl, apiKey, model, visionModel? })——VLM 打分需要额度,配好再来");
  process.exit(2);
}
const model = cfg.visionModel || cfg.model;
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;

function walkAssets(dir, re) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (re.test(e.name)) out.push(p);
    }
  };
  const assetsDir = path.join(dir, "assets", "generated");
  if (fs.existsSync(assetsDir)) walk(assetsDir);
  return out.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

/** 资产 → 生成它的节点提示词(文图对齐要用):按文件名在 project.json 节点里反查。 */
function buildPromptMap(dir) {
  const map = new Map();
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(dir, ".nomi", "project.json"), "utf8"));
    for (const node of rec?.payload?.generationCanvas?.nodes || []) {
      const blob = JSON.stringify(node);
      const m = blob.match(/[\w-]+\.(?:png|jpe?g|webp|mp4|webm|mov)/gi) || [];
      for (const name of m) if (!map.has(name)) map.set(name, node.prompt || "");
    }
  } catch { /* 无 project.json 则无提示词,文图对齐降级 */ }
  return map;
}

/** ffmpeg 抽样最多 4 帧(每 2s 一帧),返回 base64 data URL 数组;失败返回 []。 */
function sampleVideoFrames(file) {
  if (!hasFfmpeg) return [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-frames-"));
  try {
    const r = spawnSync("ffmpeg", ["-i", file, "-vf", "fps=1/2", "-frames:v", "4", "-y", path.join(tmp, "f_%02d.png")], { encoding: "utf8" });
    if (r.status !== 0) return [];
    return fs.readdirSync(tmp).filter((f) => f.endsWith(".png")).sort()
      .map((f) => `data:image/png;base64,${fs.readFileSync(path.join(tmp, f)).toString("base64")}`);
  } catch {
    return [];
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const promptMap = buildPromptMap(projectDir);
const imgs = walkAssets(projectDir, /\.(png|jpe?g|webp)$/i).map((f) => ({ file: f, kind: "image" }));
const vids = walkAssets(projectDir, /\.(mp4|webm|mov)$/i).map((f) => ({ file: f, kind: "video" }));
const assets = [...imgs, ...vids].sort((a, b) => fs.statSync(b.file).mtimeMs - fs.statSync(a.file).mtimeMs).slice(0, limit);
if (!assets.length) {
  console.log("该项目没有生成产物(assets/generated 为空)。");
  process.exit(0);
}
console.log(`Lane D 生成质量评测:${assets.length} 个产物(上限 ${limit}),VLM ${model}${hasFfmpeg ? "" : "（无 ffmpeg,视频将跳过）"}`);

const results = [];
for (const asset of assets) {
  const base = path.basename(asset.file);
  const prompt = promptMap.get(base) || "";
  try {
    let images;
    if (asset.kind === "video") {
      images = sampleVideoFrames(asset.file);
      if (!images.length) { console.log(`  ⤼ 跳过视频 ${base}（无 ffmpeg 或抽帧失败）`); continue; }
    } else {
      const mime = asset.file.match(/\.png$/i) ? "image/png" : "image/jpeg";
      images = [`data:${mime};base64,${fs.readFileSync(asset.file).toString("base64")}`];
    }
    const verdict = await scoreAssetWithVlm(cfg, { kind: asset.kind, prompt, images, model });
    results.push({ file: path.relative(projectDir, asset.file), kind: asset.kind, ...verdict });
    console.log(`  ✓ ${base}（${asset.kind}）质量 ${(verdict.qualityScore * 100).toFixed(0)}/100 — ${Object.entries(verdict.scores).map(([k, v]) => `${k}:${v}`).join(" ")}`);
  } catch (error) {
    results.push({ file: path.relative(projectDir, asset.file), kind: asset.kind, error: error instanceof Error ? error.message : String(error) });
    console.log(`  ✗ ${base} — ${results.at(-1).error}`);
  }
}

const outPath = path.join(projectDir, ".nomi", "vlm-review.jsonl");
fs.appendFileSync(outPath, results.map((r) => JSON.stringify({ ...r, at: new Date().toISOString(), model })).join("\n") + "\n");

// —— 聚合质量分卡(按 kind 分别按维度取均)——
function scorecard(kind, dims) {
  const rows = results.filter((r) => r.kind === kind && r.normalized);
  if (!rows.length) return;
  console.log(`\n${kind === "video" ? "视频" : "图片"}质量分卡（${rows.length} 个）：`);
  for (const d of dims) {
    const mean = rows.reduce((s, r) => s + (r.normalized[d.key] ?? 0), 0) / rows.length;
    console.log(`  ${d.name}: ${(mean * 100).toFixed(0)}/100`);
  }
  const overall = rows.reduce((s, r) => s + r.qualityScore, 0) / rows.length;
  console.log(`  —— 综合 ${(overall * 100).toFixed(0)}/100`);
}
scorecard("image", IMAGE_DIMENSIONS);
scorecard("video", VIDEO_DIMENSIONS);
console.log(`\n明细: ${outPath}`);
