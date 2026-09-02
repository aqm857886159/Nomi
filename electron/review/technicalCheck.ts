// V-a 技术自检(harness S4-2b,总方案 §7.3 L0 层):生成产物落地后的免费客观检查。
// 视频:大面积黑帧(blackdetect)/全程静音(silencedetect,仅当有音轨)/零时长;
// 图片:能否解码 + 尺寸有效。
// 纪律:**只标记,绝不拦截、绝不静默丢弃、绝不自动重跑**——审美的裁判是用户(不抄
// OpenMontage 的"review 不过就不呈现")。异步旁路,任何失败吞掉,绝不挡结果呈现。
import { spawn } from "node:child_process";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { probeMediaMetadata } from "../export/mediaProbe";
import { desktopT } from "../i18n";

export type TechnicalCheckItem = {
  id: "black-frames" | "silent-audio" | "zero-duration" | "undecodable";
  suspect: boolean;
  detail: string;
};

export type TechnicalCheckVerdict = {
  suspect: boolean;
  checks: TechnicalCheckItem[];
};

function runFfmpegStderr(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), ["-hide_banner", "-nostats", ...args]);
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", () => resolve(stderr));
  });
}

function sumMatches(stderr: string, pattern: RegExp): number {
  let total = 0;
  for (const match of stderr.matchAll(pattern)) total += Number(match[1]) || 0;
  return total;
}

/** 黑帧占比 >60% 才标记(保守阈值:夜景/淡入淡出不该被冤枉)。 */
const BLACK_RATIO_THRESHOLD = 0.6;
/** 静音占比 >90% 才标记。 */
const SILENCE_RATIO_THRESHOLD = 0.9;

export async function runTechnicalCheck(absolutePath: string, type: "image" | "video"): Promise<TechnicalCheckVerdict> {
  const checks: TechnicalCheckItem[] = [];
  try {
    const meta = await probeMediaMetadata(absolutePath);
    if (type === "image") {
      const decodable = (meta.width ?? 0) > 0 && (meta.height ?? 0) > 0;
      checks.push({
        id: "undecodable",
        suspect: !decodable,
        detail: decodable ? `${meta.width}×${meta.height}` : desktopT("review.imageUndecodable"),
      });
    } else {
      const duration = meta.durationSeconds ?? 0;
      checks.push({
        id: "zero-duration",
        suspect: duration <= 0.1,
        detail: duration > 0.1 ? desktopT("review.duration", { seconds: duration.toFixed(1) }) : desktopT("review.zeroDuration"),
      });
      if (duration > 0.1) {
        const blackStderr = await runFfmpegStderr(["-i", absolutePath, "-vf", "blackdetect=d=0.5:pix_th=0.10", "-an", "-f", "null", "-"]);
        const blackSeconds = sumMatches(blackStderr, /black_duration:([\d.]+)/g);
        const blackRatio = blackSeconds / duration;
        checks.push({
          id: "black-frames",
          suspect: blackRatio > BLACK_RATIO_THRESHOLD,
          detail: blackRatio > BLACK_RATIO_THRESHOLD
            ? desktopT("review.blackRatio", { percent: Math.round(blackRatio * 100) })
            : desktopT("review.blackFrames", { percent: Math.round(blackRatio * 100) }),
        });
        if (meta.hasAudio) {
          const silenceStderr = await runFfmpegStderr(["-i", absolutePath, "-af", "silencedetect=n=-50dB:d=2", "-vn", "-f", "null", "-"]);
          const silenceSeconds = sumMatches(silenceStderr, /silence_duration: ?([\d.]+)/g);
          const silenceRatio = silenceSeconds / duration;
          checks.push({
            id: "silent-audio",
            suspect: silenceRatio > SILENCE_RATIO_THRESHOLD,
          detail: silenceRatio > SILENCE_RATIO_THRESHOLD
            ? desktopT("review.silentAudio")
            : desktopT("review.silenceRatio", { percent: Math.round(silenceRatio * 100) }),
          });
        }
      }
    }
  } catch (error) {
    // 探测本身失败 = 文件可疑(下载残缺/格式损坏)
    checks.push({
      id: "undecodable",
      suspect: true,
      detail: desktopT("review.probeFailed", { detail: error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120) }),
    });
  }
  return { suspect: checks.some((check) => check.suspect), checks };
}
