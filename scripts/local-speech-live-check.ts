/**
 * 本地转写的**真机验收**（R13「四件真实」第④件：真实素材；R22：没有真实资源就记 unverified，
 * 不许拿 mock 绿灯替代 live 证据）。
 *
 * 它跑的是**生产代码本身**——`transcribeLocally`，也就是 `audioTaskRunner` 走的那条——
 * 从「引擎还没下」一路到「出字」：下载 → sha256 校验 → 解包 → 逐成员复验 → 起 sidecar →
 * ffmpeg 切段 → 逐段 `/inference` → 折回全局时间轴 → 合并。中间任何一步挂了都会原样抛出来。
 * 单测只能证明纯函数对；这条链里真正会坏的东西（二进制能不能跑、端口抢不抢得到、
 * 长音频接缝对不对、模型会不会幻听）**只有喂真实连续语流才看得见**。
 *
 * 跑法：
 *   export NOMI_REAL_MEDIA_DIR="$HOME/Desktop/视频"
 *   npx tsx scripts/local-speech-live-check.ts                # 全部登记素材
 *   npx tsx scripts/local-speech-live-check.ts speech-zh-only-hevc --seconds 180
 *   npx tsx scripts/local-speech-live-check.ts --offline      # 断网档：只允许用已缓存的引擎与权重
 *
 * 缺素材就非零退出并打印缺什么，**不 skip、不退回合成素材**（skip = 「登记即放绿」，R17）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { transcribeLocally, type LocalSpeechProgress } from "../electron/localSpeech/localSpeechTranscribe";
import { isLocalSpeechEngineInstalled, pendingLocalSpeechBytes } from "../electron/localSpeech/localSpeechInstall";
import { LOCAL_SPEECH_DEFAULT_TIER, localSpeechEngineForPlatform, localSpeechTier } from "../electron/shared/localSpeech/localSpeechAssets";
import { rememberProxyStateForTests } from "../electron/systemProxy";

const require_ = createRequire(import.meta.url);
const { requireRealMediaAssets, readRealMediaRegistry } = require_("../tests/ux/fixtures/realMedia.mjs") as {
  requireRealMediaAssets: (ids: string[]) => { dir: string; assets: Map<string, { id: string; file: string | null; relativePath?: string }> };
  readRealMediaRegistry: () => { coverage: { class: string; test: string | null; assets: string[] }[] };
};
/** 登记表 coverage[].test 里写的就是这个仓库相对路径。 */
const SELF_REGISTRY_PATH = "scripts/local-speech-live-check.ts";

process.env.NOMI_SETTINGS_DIR ||= path.join(os.homedir(), ".nomi-local-speech-live");
// 出站要一条「已提交的应用网络路由」，那条路由平时由 Electron 启动时探测系统代理得到。
// 这个脚本不起 Electron，所以用 systemProxy 自己的测试钩子提交一条「直连」路由——
// 走的是与 applySystemProxy 同一个写入口（单一真相源），不是绕开出站策略另开一条路。
rememberProxyStateForTests({ kind: "none" });

const args = process.argv.slice(2);
const offline = args.includes("--offline");
const secondsIndex = args.indexOf("--seconds");
const limitSeconds = secondsIndex >= 0 ? Number(args[secondsIndex + 1]) : 0;
const explicitIds = args.filter((arg) => !arg.startsWith("--") && arg !== String(limitSeconds));

/**
 * 三个阶段一个都不许漏：生产端 `LocalSpeechProgress` 每加一个成员，这里的 `never` 兜底就会编译红，
 * 而不是像 2026-09-17 那样——`starting` 加进了生产端，这边的二元三目把它当成 transcribing 去读
 * `doneSeconds.toFixed`，脚本一条素材都跑不完。
 */
function describeProgress(progress: LocalSpeechProgress): string {
  switch (progress.phase) {
    case "starting":
      return `开跑：${progress.gpuAccelerated ? "GPU 加速" : "纯 CPU"}，预计 ${progress.estimatedMinutes} 分钟`;
    case "downloading":
      return `下载引擎与权重 ${(progress.doneBytes / 1e6).toFixed(0)}/${(progress.totalBytes / 1e6).toFixed(0)} MB`;
    case "transcribing":
      return `转写第 ${progress.chunkIndex + 1}/${progress.chunkCount} 段（${progress.doneSeconds.toFixed(0)}/${progress.totalSeconds.toFixed(0)} 秒）`;
    default: {
      const unexpected: never = progress;
      throw new Error(`未知的本地转写进度阶段：${JSON.stringify(unexpected)}`);
    }
  }
}

async function main(): Promise<void> {
  const registry = readRealMediaRegistry();
  // 默认集从登记表反查：**凡是把本脚本登记为 test 的覆盖类**（transcription / transcription-english /
  // 以后再加的语种）全都算，不写死类名——否则登记表说「这条由它验」、脚本却静默不跑，登记即放绿（R17）。
  const ownCoverage = registry.coverage.filter((entry) => entry.test === SELF_REGISTRY_PATH);
  if (ownCoverage.length === 0) {
    console.error(`登记表里没有任何一条覆盖把 ${SELF_REGISTRY_PATH} 登记为 test——先在 tests/ux/real-media-fixtures.json 登记素材再跑。`);
    process.exit(1);
  }
  const wantedIds = explicitIds.length > 0 ? explicitIds : [...new Set(ownCoverage.flatMap((entry) => entry.assets))];
  console.log(`覆盖类：${ownCoverage.map((entry) => `${entry.class}（${entry.assets.length}）`).join("、")}`);
  const { dir, assets } = requireRealMediaAssets(wantedIds);
  console.log(`真实素材目录：${dir}`);
  console.log(`缓存根（引擎与权重落这里）：${process.env.NOMI_SETTINGS_DIR}`);

  const tier = localSpeechTier(LOCAL_SPEECH_DEFAULT_TIER)!;
  const engine = localSpeechEngineForPlatform();
  if (!engine) {
    console.error(`这台机器（${process.platform}-${process.arch}）不在支持清单里——本地转写在这里就是不可用，不是跑挂了。`);
    process.exit(1);
  }
  const pending = pendingLocalSpeechBytes(tier, engine);
  if (offline && pending > 0) {
    console.error(
      `断网档要求引擎与权重都已缓存，但还差 ${(pending / 1e6).toFixed(0)} MB。` +
        `先联网跑一次普通档把它们下下来，再断网复跑这条。`,
    );
    process.exit(1);
  }
  console.log(`引擎已装：${isLocalSpeechEngineInstalled(engine)}；这次还要下 ${(pending / 1e6).toFixed(0)} MB`);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-localstt-live-"));
  const receipts: Record<string, unknown>[] = [];

  for (const id of wantedIds) {
    const asset = assets.get(id);
    if (!asset?.file) {
      console.error(`素材 ${id} 解析不到文件路径`);
      process.exit(1);
    }
    // 与生产完全同一套取音轨参数（extractAudioTrack 的 buildAudioTrackArgs）：单声道 16k 64kbps。
    const audioPath = path.join(workDir, `${id}.mp3`);
    const ffmpegArgs = ["-y", ...(limitSeconds > 0 ? ["-t", String(limitSeconds)] : []), "-i", asset.file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", audioPath];
    execFileSync("ffmpeg", ["-v", "error", ...ffmpegArgs]);

    console.log(`\n=== ${id} ===`);
    let lastLine = "";
    const started = Date.now();
    const result = await transcribeLocally({
      audioFilePath: audioPath,
      tier,
      onProgress: (progress) => {
        const line = describeProgress(progress);
        if (line !== lastLine) {
          lastLine = line;
          console.log(`  · ${line}`);
        }
      },
    });
    const elapsedMs = Date.now() - started;
    const audioSeconds = Number(
      execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audioPath], { encoding: "utf8" }).trim(),
    );
    console.log(`  检测语言：${result.detected_language}（置信 ${result.detected_language_probability.toFixed(3)}）`);
    console.log(`  段数：${result.segments.length}，字数：${result.text.replace(/\s/g, "").length}，耗时 ${(elapsedMs / 1000).toFixed(1)}s（${(audioSeconds / (elapsedMs / 1000)).toFixed(1)}× 实时）`);
    console.log(`  开头：${result.text.slice(0, 80).replace(/\n/g, " | ")}`);
    // 接缝复核：段与段之间时间必须单调不倒退，且没有整句重复——这正是分段最容易坏的地方。
    let backwards = 0;
    let duplicated = 0;
    for (let index = 1; index < result.segments.length; index += 1) {
      if (result.segments[index].start < result.segments[index - 1].start) backwards += 1;
      if (result.segments[index].text === result.segments[index - 1].text) duplicated += 1;
    }
    console.log(`  接缝：时间倒退 ${backwards} 处，相邻整句重复 ${duplicated} 处`);
    receipts.push({
      id,
      audioSeconds,
      elapsedMs,
      realtimeFactor: Number((audioSeconds / (elapsedMs / 1000)).toFixed(2)),
      detectedLanguage: result.detected_language,
      detectedLanguageProbability: result.detected_language_probability,
      segments: result.segments.length,
      characters: result.text.replace(/\s/g, "").length,
      backwards,
      duplicated,
      tier: result.local_tier,
      offline,
      text: result.text,
    });
  }

  fs.rmSync(workDir, { recursive: true, force: true });
  const receiptPath = path.join(process.env.NOMI_SETTINGS_DIR!, `live-check-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ offline, platform: `${process.platform}-${process.arch}`, receipts }, null, 2)}\n`);
  console.log(`\n收据：${receiptPath}`);

}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
