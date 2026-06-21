// 帧序列 → mp4：把 N 张 PNG dataURL 写进临时目录 → ffmpeg image2 拼成 H.264 mp4 →
// 落成项目素材（kind 'generated'）→ 返回 { url, assetId }。
//
// AI 运镜工具的「轨迹→视频文件」桥（docs/plan/2026-06-22-ai-camera-move-tool.md S2）：
// 渲染层在隐藏 Canvas 沿相机轨迹采 N 帧 → 这里拼片。ffmpeg/执行位复用 export 那套
// （resolveFfmpegPath + ensureExecutable），与 extractVideoFrame 同源。args 抽在
// framesToVideoArgs.ts（纯函数 + 单测）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { ensureExecutable } from "../export/ensureExecutable";
import { writeAsset } from "../runtime";
import { buildFramesToVideoArgs } from "./framesToVideoArgs";

export type FramesToVideoPayload = {
  projectId: string;
  ownerNodeId?: string | null;
  /** 输出文件名（不含路径）；缺省自动生成。 */
  fileName?: string;
  fps: number;
  /** 每帧一个 PNG dataURL（data:image/png;base64,...），按播放顺序。 */
  frames: string[];
};

export type FramesToVideoResult = { url: string; assetId?: string };

export class FramesToVideoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FramesToVideoError";
  }
}

function fileSafePart(value: string): string {
  return value.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "camera-move";
}

/** 把 data:image/png;base64,... 解出字节；非 PNG dataURL 抛错（捕获产物必须是 PNG）。 */
function decodePngDataUrl(dataUrl: string, index: number): Buffer {
  const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) throw new FramesToVideoError(`第 ${index + 1} 帧不是 PNG dataURL`);
  return Buffer.from(match[1], "base64");
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    ensureExecutable(ffmpegPath);
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new FramesToVideoError(`ffmpeg 拼片失败（code ${code}）：${stderr.trim().slice(-300) || "(无 stderr)"}`));
    });
  });
}

/**
 * N 帧 PNG → mp4 项目素材。失败一律抛 FramesToVideoError（不返回半成品冒充）。
 */
export async function framesToVideoAsset(payload: FramesToVideoPayload): Promise<FramesToVideoResult> {
  const { projectId, frames, fps } = payload;
  if (!projectId || typeof projectId !== "string") throw new FramesToVideoError("缺少 projectId");
  if (!Array.isArray(frames) || frames.length < 2) throw new FramesToVideoError("至少需要 2 帧才能拼成运镜小片");
  if (!Number.isFinite(fps) || fps <= 0) throw new FramesToVideoError("无效的 fps");

  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) throw new FramesToVideoError("找不到 ffmpeg 可执行文件");

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-cammove-"));
  const framePattern = path.join(workDir, "frame-%05d.png");
  const outPath = path.join(workDir, "camera-move.mp4");
  try {
    frames.forEach((dataUrl, index) => {
      const bytes = decodePngDataUrl(dataUrl, index);
      // image2 序列从 1 开始编号，零填充 5 位（与 framePattern 的 %05d 对齐）。
      fs.writeFileSync(path.join(workDir, `frame-${String(index + 1).padStart(5, "0")}.png`), bytes);
    });

    const args = buildFramesToVideoArgs({ framePattern, outputPath: outPath, fps });
    await runFfmpeg(ffmpegPath, args);
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
      throw new FramesToVideoError("ffmpeg 未产出有效 mp4");
    }

    const bytes = fs.readFileSync(outPath);
    const baseName = fileSafePart(payload.fileName || "camera-move");
    const fileName = baseName.endsWith(".mp4") ? baseName : `${baseName}-${crypto.randomUUID().slice(0, 8)}.mp4`;
    const record = writeAsset(projectId, bytes, fileName, "video/mp4", {
      kind: "generated",
      source: "camera-move",
      ownerNodeId: payload.ownerNodeId || null,
    }) as { id?: string; data?: { url?: string } };
    const url = record?.data?.url;
    if (!url) throw new FramesToVideoError("拼好的 mp4 写盘失败");
    return { url, assetId: record.id };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* non-fatal */ }
  }
}
