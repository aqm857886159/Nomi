/**
 * 本地转写的**质量口径**：逐条真素材算字错率 / 漂移率，并与上一次的收据比出差值。
 *
 * ── 为什么有这个脚本 ────────────────────────────────────────────────────────
 * 档位清单里的 `measuredCer: 0.065` 与方案文档那张四档对照表，是产品口径的依据：
 * 砍掉哪三档靠它，UI 上「诚实标注与云端的差距」也靠它。但在 2026-09-18 之前，
 * **仓库里没有参照真值、也没有算法**——那个 6.5% 用的是哪种口径已经没人说得清，
 * 于是任何影响解码的改动（换档位、换引擎版本、改参数、换平台构建）都测不出质量回归。
 * 实际后果已经发生：给引擎开 VAD 时中文两条的文字确有变化（「一堂客」→「一堂课」变好、
 * 也有变差的），而当时无法判断是升是降，只能在方案文档里记成「未验证」。
 *
 * ── 两个数，不要混 ──────────────────────────────────────────────────────────
 * 参照文本按 `provenance` 分两类，它决定那一行的数字**叫什么**：
 *   · `published-text` / `human-verified` → 真值。与它的差异是 **CER（字错率）**，
 *     可以当质量口径用：数字变大就是变差。
 *   · `frozen-baseline`                   → 只是**冻结稿**（某次输出的快照）。与它的差异是
 *     **漂移率**，只能证明「解码输出变了、变了多少、变在哪」，**不能**证明变好还是变坏。
 * 把两者混成一个数，正是上一版 6.5% 无人能复现的根子。所以本脚本分栏报，
 * 总体 CER **只对真值那一档求和**；冻结稿那几行永远单独列、永远标着「漂移」。
 *
 * ── 口径（写死在这里，改口径必须改这段注释）────────────────────────────────
 * 1. 规范化：NFKC → 去掉全部空白 → 去掉 Unicode 标点/符号类（P* / S*）→ 英文小写。
 *    · 为什么去空白：中文本来就没有词边界；英文去掉之后 "web coding" 与 "webcoding"
 *      不再算错——那是断词差异，不是听错。
 *    · 为什么 NFKC：全角/半角、数字上下标统一，否则同一个字因为宽度不同被判成错。
 * 2. 距离：规范化后按**字符**算 Levenshtein 编辑距离（增/删/改各记 1）。
 *    CER = 编辑距离 / 参照文本字符数。
 *    · 为什么两种语言都按字符、不对英文用 WER：本语料里有一条就是中英混说，
 *      一个字符级指标才能让五行数字横着比。WER 需要分词，而中文分词本身就是一层
 *      会引入争议的判断，那等于在量具里再塞一个变量。
 * 3. **不做**的两件规范化，都是有意的：
 *    · 不把 "35" 和 "thirty-five" 视为相同。数字写成什么样是用户在稿子里**看得见**的差别，
 *      抹掉它，CER 就不再反映「这份稿子拿到手要改多少」。代价是英文那条的 CER 里
 *      含一部分纯格式差异——这是已知偏置，不是 bug，报表里会单列出来提醒。
 *    · 不把繁体折成简体。小档位对普通话输出繁体是 2026-09-17 砍掉 small-q5_1 的理由之一，
 *      折叠它等于把一条真缺陷藏进量具里。
 * 4. 打分范围：参照文件可以声明 `scoredRangeSec`，只对音频的某一段打分
 *    （LibriVox 那条前 53 秒是固定开场白，不在出版原文里，见 manifest 的 whyRange）。
 *
 * ── 跑法 ────────────────────────────────────────────────────────────────────
 *   export NOMI_REAL_MEDIA_DIR="$HOME/Desktop/视频"
 *   npx tsx scripts/local-speech-cer.ts                      # 全部素材，与上次收据比
 *   npx tsx scripts/local-speech-cer.ts speech-zh-only-hevc  # 只跑一条
 *   npx tsx scripts/local-speech-cer.ts --freeze             # 把当前输出写成冻结稿（人工动作）
 *
 * `--freeze` 只允许改 `frozen-baseline` 那几条，**永远不碰真值**：真值被自动覆盖一次，
 * 这把尺子就永远量不出问题了。收据落 docs/engineering/local-speech-cer-receipt.json，
 * 进仓库——解码是确定性的（同素材两次跑输出逐字相同，2026-09-18 实测），
 * 所以换个人换台同架构机器跑得出同一个数，收据才有对比价值。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { transcribeLocally } from "../electron/localSpeech/localSpeechTranscribe";
import { LOCAL_SPEECH_DEFAULT_TIER, localSpeechTier } from "../electron/shared/localSpeech/localSpeechAssets";
import { rememberProxyStateForTests } from "../electron/systemProxy";

const require_ = createRequire(import.meta.url);
const { requireRealMediaAssets } = require_("../tests/ux/fixtures/realMedia.mjs") as {
  requireRealMediaAssets: (ids: string[]) => { dir: string; assets: Map<string, { id: string; file: string | null }> };
};

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CORPUS_DIR = path.join(REPO_ROOT, "tests/ux/fixtures/localSpeechReferences");
const RECEIPT_FILE = path.join(REPO_ROOT, "docs/engineering/local-speech-cer-receipt.json");

type Provenance = "published-text" | "human-verified" | "frozen-baseline";
type ReferenceEntry = {
  assetId: string;
  provenance: Provenance;
  referenceFile: string;
  scoredRangeSec?: [number, number];
};

process.env.NOMI_SETTINGS_DIR ||= path.join(os.homedir(), ".nomi-local-speech-live");
rememberProxyStateForTests({ kind: "none" });

const args = process.argv.slice(2);
const freeze = args.includes("--freeze");
const wantedIds = args.filter((arg) => !arg.startsWith("--"));

/** 真值那一档：与它的差异叫 CER，能当质量口径用。 */
const isTruth = (provenance: Provenance): boolean => provenance !== "frozen-baseline";

/** 口径第 1 条。改这里必须同时改文件头那段说明。 */
export function normalizeForScoring(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .replace(/[\p{P}\p{S}]/gu, "")
    .toLowerCase();
}

/** 口径第 2 条：字符级 Levenshtein（滚动数组，够跑几千字）。 */
export function editDistance(reference: string, hypothesis: string): number {
  if (reference === hypothesis) return 0;
  if (reference.length === 0) return hypothesis.length;
  if (hypothesis.length === 0) return reference.length;
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  let current = new Array<number>(hypothesis.length + 1);
  for (let i = 1; i <= reference.length; i += 1) {
    current[0] = i;
    const refChar = reference[i - 1];
    for (let j = 1; j <= hypothesis.length; j += 1) {
      const cost = refChar === hypothesis[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[hypothesis.length];
}

export function scoreAgainstReference(reference: string, hypothesis: string): { cer: number; distance: number; referenceChars: number } {
  const ref = normalizeForScoring(reference);
  const hyp = normalizeForScoring(hypothesis);
  const distance = editDistance(ref, hyp);
  return { cer: ref.length === 0 ? 0 : distance / ref.length, distance, referenceChars: ref.length };
}

/** 报表里单列的已知偏置（口径第 3 条第一款）：纯数字写法差异贡献了多少字。 */
export function digitFormattingChars(reference: string, hypothesis: string): number {
  const digitsIn = (text: string) => (normalizeForScoring(text).match(/\d/gu) ?? []).length;
  return Math.abs(digitsIn(hypothesis) - digitsIn(reference));
}

function readCorpus(): ReferenceEntry[] {
  const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, "manifest.json"), "utf8")) as { references: ReferenceEntry[] };
  return manifest.references;
}

async function main(): Promise<void> {
  const corpus = readCorpus();
  const selected = wantedIds.length > 0 ? corpus.filter((entry) => wantedIds.includes(entry.assetId)) : corpus;
  if (selected.length === 0) {
    console.error(`参照语料里没有这些素材：${wantedIds.join(", ")}`);
    process.exit(1);
  }
  const { dir, assets } = requireRealMediaAssets(selected.map((entry) => entry.assetId));
  const tier = localSpeechTier(LOCAL_SPEECH_DEFAULT_TIER)!;
  console.log(`真实素材目录：${dir}`);
  console.log(`档位：${tier.id}（${tier.model.id}）  平台：${process.platform}-${process.arch}`);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-localstt-cer-"));
  const rows: Record<string, unknown>[] = [];

  for (const entry of selected) {
    const asset = assets.get(entry.assetId);
    if (!asset?.file) {
      console.error(`素材 ${entry.assetId} 解析不到文件路径`);
      process.exit(1);
    }
    // 与生产完全同一套取音轨参数（extractAudioTrack 的 buildAudioTrackArgs）：单声道 16k 64kbps。
    const audioPath = path.join(workDir, `${entry.assetId}.mp3`);
    const range = entry.scoredRangeSec;
    const trim = range ? ["-ss", String(range[0]), "-t", String(range[1] - range[0])] : [];
    execFileSync("ffmpeg", ["-v", "error", "-y", ...trim, "-i", asset.file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", audioPath]);

    const started = Date.now();
    const result = await transcribeLocally({ audioFilePath: audioPath, tier });
    const elapsedMs = Date.now() - started;

    const referencePath = path.join(CORPUS_DIR, entry.referenceFile);
    if (freeze && !isTruth(entry.provenance)) {
      fs.writeFileSync(referencePath, `${result.text.trim()}\n`);
      console.log(`  · 冻结 ${entry.assetId}（${result.text.replace(/\s/gu, "").length} 字）`);
    }
    if (!fs.existsSync(referencePath)) {
      console.error(`缺参照文本 ${entry.referenceFile}——真值要人写，冻结稿先跑一次 --freeze。`);
      process.exit(1);
    }
    const reference = fs.readFileSync(referencePath, "utf8");
    const { cer, distance, referenceChars } = scoreAgainstReference(reference, result.text);
    rows.push({
      assetId: entry.assetId,
      provenance: entry.provenance,
      metric: isTruth(entry.provenance) ? "cer" : "drift",
      value: Number(cer.toFixed(4)),
      distance,
      referenceChars,
      digitFormattingChars: digitFormattingChars(reference, result.text),
      detectedLanguage: result.detected_language,
      elapsedMs,
    });
  }
  fs.rmSync(workDir, { recursive: true, force: true });

  const previous = fs.existsSync(RECEIPT_FILE)
    ? (JSON.parse(fs.readFileSync(RECEIPT_FILE, "utf8")) as { platform?: string; rows: Record<string, unknown>[] })
    : null;
  const priorOf = (assetId: string) => previous?.rows?.find((row) => row.assetId === assetId);

  console.log("");
  console.log("素材                                  口径     数值     编辑距离/参照字数   与上次");
  for (const row of rows) {
    const prior = priorOf(String(row.assetId));
    const delta = prior && typeof prior.value === "number" ? Number(row.value) - prior.value : null;
    const deltaText = delta === null ? "（首次）" : `${delta > 0 ? "+" : ""}${delta.toFixed(4)}${delta === 0 ? "（未变）" : ""}`;
    console.log(
      `${String(row.assetId).padEnd(36)} ${String(row.metric).padEnd(7)} ${(Number(row.value) * 100).toFixed(2).padStart(6)}%  ` +
        `${String(row.distance).padStart(5)}/${String(row.referenceChars).padEnd(6)}  ${deltaText}`,
    );
  }

  const truthRows = rows.filter((row) => row.metric === "cer");
  if (truthRows.length > 0) {
    const distance = truthRows.reduce((sum, row) => sum + Number(row.distance), 0);
    const chars = truthRows.reduce((sum, row) => sum + Number(row.referenceChars), 0);
    console.log(`\n总体 CER（只含真值那 ${truthRows.length} 条，共 ${chars} 字）：${((distance / chars) * 100).toFixed(2)}%`);
    const digits = truthRows.reduce((sum, row) => sum + Number(row.digitFormattingChars), 0);
    if (digits > 0) console.log(`  其中约 ${digits} 字是纯数字写法差异（如 thirty-five ↔ 35），口径第 3 条有意不折叠`);
  }
  const driftRows = rows.filter((row) => row.metric === "drift");
  if (driftRows.length > 0) {
    console.log(`漂移率那 ${driftRows.length} 条不计入总体 CER：参照是冻结稿不是真值，只证明输出变没变，不证明变好变坏。`);
  }
  if (previous?.platform && previous.platform !== `${process.platform}-${process.arch}`) {
    console.log(`\n⚠️ 上一次收据来自 ${previous.platform}，与本机不同——跨平台构建（Metal / CPU）解码结果本就可能不同，差值不能直接当回归看。`);
  }

  // 只跑了一部分素材时**合并**进旧收据，不整份覆盖——否则「只复跑一条」会把其余几行的历史抹掉，
  // 下次再比就变成「首次」，对比功能等于没有。顺序按参照语料的顺序固定，避免无谓的 diff 抖动。
  const merged = new Map<string, Record<string, unknown>>();
  for (const row of previous?.rows ?? []) merged.set(String(row.assetId), row);
  for (const row of rows) merged.set(String(row.assetId), row);
  const ordered = corpus.map((entry) => merged.get(entry.assetId)).filter((row): row is Record<string, unknown> => row !== undefined);

  fs.mkdirSync(path.dirname(RECEIPT_FILE), { recursive: true });
  fs.writeFileSync(
    RECEIPT_FILE,
    `${JSON.stringify(
      { schema: 1, measuredAt: new Date().toISOString().slice(0, 10), platform: `${process.platform}-${process.arch}`, tier: tier.id, model: tier.model.id, rows: ordered },
      null,
      2,
    )}\n`,
  );
  console.log(`\n收据：${path.relative(REPO_ROOT, RECEIPT_FILE)}`);
}

// 只在被直接执行时跑。**不能在模块顶层无条件 main()**：量具自己的单测要 import 这几个纯函数，
// 顶层一跑就等于一 import 就起转写（2026-09-18 写测试时当场撞到，vitest 报「Errors 1 error」而用例还是绿的——
// 这种「绿着的错」正是最难发现的那种）。
const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  void main().catch((error) => {
    console.error(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error));
    process.exit(1);
  });
}
