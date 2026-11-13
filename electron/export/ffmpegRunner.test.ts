import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportCancelledError, exportDimensionsForPreset, renderFiltergraphToMp4, resolveFfmpegPath, transcodeWebmFileToMp4, transcodeWebmToMp4 } from "./ffmpegRunner";
import type { ExportProfile } from "./exportTypes";
import type { FfmpegFiltergraphPlan } from "./ffmpegFiltergraph";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-export-test-"));
  tempRoots.push(dir);
  return dir;
}

describe("resolveFfmpegPath", () => {
  it("prefers the bundled ffmpeg binary so users do not need to install ffmpeg", () => {
    const root = makeTempDir();
    const bundled = path.join(root, "node_modules", "@ffmpeg-installer", process.platform === "win32" ? "win32-x64" : process.platform === "darwin" && process.arch === "arm64" ? "darwin-arm64" : process.platform === "darwin" ? "darwin-x64" : "linux-x64", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    fs.mkdirSync(path.dirname(bundled), { recursive: true });
    fs.writeFileSync(bundled, "binary");

    expect(resolveFfmpegPath(undefined, { bundledPath: bundled, resourcesPath: root, pathEnv: "" })).toBe(bundled);
  });

  it("uses the unpacked ffmpeg binary when the app is packaged in an asar archive", () => {
    const root = makeTempDir();
    const asarPath = path.join(root, "app.asar", "node_modules", "@ffmpeg-installer", "darwin-arm64", "ffmpeg");
    const unpackedPath = asarPath.replace("app.asar", "app.asar.unpacked");
    fs.mkdirSync(path.dirname(unpackedPath), { recursive: true });
    fs.writeFileSync(unpackedPath, "binary");

    expect(resolveFfmpegPath(undefined, { bundledPath: asarPath, resourcesPath: root, pathEnv: "" })).toBe(unpackedPath);
  });

  it("falls back to the packaged resources ffmpeg binary before PATH", () => {
    const root = makeTempDir();
    const resourceBinary = path.join(root, "ffmpeg", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    fs.mkdirSync(path.dirname(resourceBinary), { recursive: true });
    fs.writeFileSync(resourceBinary, "binary");

    expect(resolveFfmpegPath(undefined, { bundledPath: "", resourcesPath: root, pathEnv: "" })).toBe(resourceBinary);
  });
});

describe("exportDimensionsForPreset", () => {
  it("keeps landscape 1080p exports at the standard 1920x1080 size", () => {
    expect(exportDimensionsForPreset("1080p", "16:9")).toEqual({ width: 1920, height: 1080 });
  });

  it("exports vertical and square aspect ratios as native social-video canvases", () => {
    expect(exportDimensionsForPreset("1080p", "9:16")).toEqual({ width: 1080, height: 1920 });
    expect(exportDimensionsForPreset("1080p", "1:1")).toEqual({ width: 1080, height: 1080 });
    expect(exportDimensionsForPreset("720p", "4:5")).toEqual({ width: 720, height: 900 });
  });
});

describe("transcodeWebmToMp4", () => {
  it("transcodes an existing WebM file path without accepting a byte payload and preserves input", async () => {
    const projectDir = makeTempDir();
    const inputPath = path.join(projectDir, "cache", "exports", "job-1", "input.webm");
    fs.mkdirSync(path.dirname(inputPath), { recursive: true });
    fs.writeFileSync(inputPath, "existing-webm");
    const calls: Array<{ command: string; args: string[] }> = [];

    const result = await transcodeWebmFileToMp4({
      projectDir,
      inputPath,
      outputName: "Path Export",
      ffmpegPath: "/usr/local/bin/ffmpeg",
      runProcess: async (command, args) => {
        calls.push({ command, args });
        fs.writeFileSync(args[args.length - 1], "mp4-bytes");
        return { code: 0, stderr: "" };
      },
    });

    expect(result.relativePath).toMatch(/^exports\/Path-Export-\d+\.mp4$/);
    expect(calls).toHaveLength(1);
    expect(calls[0].args.slice(0, 4)).toEqual(["-y", "-i", inputPath, "-an"]);
    expect(fs.readFileSync(inputPath, "utf8")).toBe("existing-webm");
    expect(fs.readFileSync(result.absolutePath, "utf8")).toBe("mp4-bytes");
  });

  it("rejects missing and empty existing WebM file paths", async () => {
    const projectDir = makeTempDir();
    const emptyInputPath = path.join(projectDir, "input.webm");
    fs.writeFileSync(emptyInputPath, "");

    await expect(transcodeWebmFileToMp4({
      projectDir,
      inputPath: path.join(projectDir, "missing.webm"),
      ffmpegPath: "/usr/local/bin/ffmpeg",
      runProcess: vi.fn(),
    })).rejects.toThrow(/输入视频.*不存在|not found|missing/i);
    await expect(transcodeWebmFileToMp4({
      projectDir,
      inputPath: emptyInputPath,
      ffmpegPath: "/usr/local/bin/ffmpeg",
      runProcess: vi.fn(),
    })).rejects.toThrow(/输入视频为空/i);
  });

  it("writes input webm to a temp file and asks ffmpeg to create a playable 1080p mp4", async () => {
    const projectDir = makeTempDir();
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = await transcodeWebmToMp4({
      projectDir,
      inputBytes: Buffer.from("webm-bytes"),
      outputName: "My Export!",
      ffmpegPath: "/usr/local/bin/ffmpeg",
      runProcess: async (command, args) => {
        calls.push({ command, args });
        const outputPath = args[args.length - 1];
        fs.writeFileSync(outputPath, "mp4-bytes");
        return { code: 0, stderr: "" };
      },
    });

    expect(result.relativePath).toMatch(/^exports\/My-Export-\d+\.mp4$/);
    expect(result.relativePath).not.toContain(".partial");
    expect(result.absolutePath).toBe(path.join(projectDir, result.relativePath));
    expect(fs.readFileSync(result.absolutePath, "utf8")).toBe("mp4-bytes");
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("/usr/local/bin/ffmpeg");
    const ffmpegOutputPath = calls[0].args[calls[0].args.length - 1];
    expect(ffmpegOutputPath).toMatch(/\.partial\.mp4$/);
    expect(ffmpegOutputPath).not.toBe(result.absolutePath);
    expect(fs.existsSync(ffmpegOutputPath)).toBe(false);
    expect(calls[0].args).toContain("-c:v");
    expect(calls[0].args).toContain("libx264");
    expect(calls[0].args).toContain("-r");
    expect(calls[0].args).toContain("30");
    const vfIndex = calls[0].args.indexOf("-vf");
    expect(calls[0].args[vfIndex + 1]).toContain("scale=1920:1080:force_original_aspect_ratio=decrease");
    expect(fs.existsSync(path.join(projectDir, "cache", "exports"))).toBe(false);
  });

  it("builds ffmpeg args from legacy options through a profile and writes to the partial output", async () => {
    const projectDir = makeTempDir();
    const calls: Array<{ command: string; args: string[] }> = [];

    await transcodeWebmToMp4({
      projectDir,
      inputBytes: Buffer.from("webm-bytes"),
      outputName: "Profile Export",
      ffmpegPath: "/usr/local/bin/ffmpeg",
      resolution: "720p",
      aspectRatio: "4:5",
      fps: 24,
      quality: "high",
      runProcess: async (command: string, args: string[]) => {
        calls.push({ command, args });
        fs.writeFileSync(args[args.length - 1], "mp4-bytes");
        return { code: 0, stderr: "" };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain("scale=720:900:force_original_aspect_ratio=decrease,pad=720:900:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p");
    expect(calls[0].args.slice(calls[0].args.indexOf("-r"), calls[0].args.indexOf("-r") + 2)).toEqual(["-r", "24"]);
    expect(calls[0].args.slice(calls[0].args.indexOf("-crf"), calls[0].args.indexOf("-crf") + 2)).toEqual(["-crf", "18"]);
    expect(calls[0].args[calls[0].args.length - 1]).toMatch(/\.partial\.mp4$/);
  });

  it("surfaces ffmpeg stderr when conversion fails", async () => {
    const projectDir = makeTempDir();
    await expect(transcodeWebmToMp4({
      projectDir,
      inputBytes: Buffer.from("webm-bytes"),
      ffmpegPath: "/usr/local/bin/ffmpeg",
      runProcess: async () => ({ code: 1, stderr: "Unknown encoder libx264" }),
    })).rejects.toThrow("Unknown encoder libx264");
  });

  it("removes the partial mp4 when conversion fails", async () => {
    const projectDir = makeTempDir();
    let attemptedOutputPath = "";
    await expect(transcodeWebmToMp4({
      projectDir,
      inputBytes: Buffer.from("webm-bytes"),
      outputName: "Broken Export",
      ffmpegPath: "/usr/local/bin/ffmpeg",
      runProcess: async (_command, args) => {
        attemptedOutputPath = args[args.length - 1];
        fs.writeFileSync(attemptedOutputPath, "partial-mp4-bytes");
        return { code: 1, stderr: "encoder failed" };
      },
    })).rejects.toThrow("encoder failed");

    expect(attemptedOutputPath).toMatch(/\.partial\.mp4$/);
    expect(fs.existsSync(attemptedOutputPath)).toBe(false);
  });

  it("enables ffmpeg progress reporting when progress options are supplied", async () => {
    const projectDir = makeTempDir();
    const onProgress = vi.fn();
    const calls: Array<{ args: string[] }> = [];

    await transcodeWebmToMp4({
      projectDir,
      inputBytes: Buffer.from("webm-bytes"),
      ffmpegPath: "/usr/local/bin/ffmpeg",
      durationMs: 1000,
      onProgress,
      runProcess: async (_command, args) => {
        calls.push({ args });
        fs.writeFileSync(args[args.length - 1], "mp4-bytes");
        return { code: 0, stderr: "" };
      },
    });

    expect(calls[0].args).toContain("-progress");
    expect(calls[0].args.slice(calls[0].args.indexOf("-progress"), calls[0].args.indexOf("-progress") + 2)).toEqual(["-progress", "pipe:2"]);
    expect(calls[0].args).toContain("-nostats");
  });

  it("parses progress output from stderr and drives a clamped callback", async () => {
    const projectDir = makeTempDir();
    const onProgress = vi.fn();

    await transcodeWebmToMp4({
      projectDir,
      inputBytes: Buffer.from("webm-bytes"),
      ffmpegPath: "/usr/local/bin/ffmpeg",
      durationMs: 1000,
      onProgress,
      runProcess: async (_command, args, runOptions) => {
        runOptions?.onStderr?.("frame=1\nout_time_ms=250000\nprogress=continue\n");
        runOptions?.onStderr?.("out_time_ms=1250000\nprogress=end\n");
        fs.writeFileSync(args[args.length - 1], "mp4-bytes");
        return { code: 0, stderr: "" };
      },
    });

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ ratio: 0.25, outTimeMs: 250, stage: "continue" }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ ratio: 1, outTimeMs: 1250, stage: "end" }));
  });

  it("buffers split progress chunks and emits only complete records with an out_time", async () => {
    const projectDir = makeTempDir();
    const onProgress = vi.fn();

    await transcodeWebmToMp4({
      projectDir,
      inputBytes: Buffer.from("webm-bytes"),
      ffmpegPath: "/usr/local/bin/ffmpeg",
      durationMs: 1000,
      onProgress,
      runProcess: async (_command, args, runOptions) => {
        runOptions?.onStderr?.("progr");
        runOptions?.onStderr?.("ess=continue\n");
        runOptions?.onStderr?.("frame=2\nout_time_ms=500");
        runOptions?.onStderr?.("000\nprogress=continue\n");
        fs.writeFileSync(args[args.length - 1], "mp4-bytes");
        return { code: 0, stderr: "" };
      },
    });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ ratio: 0.5, outTimeMs: 500, stage: "continue" }));
  });

  it("deletes partial output and preserves the stderr log when conversion fails", async () => {
    const projectDir = makeTempDir();
    const stderrLogPath = path.join(projectDir, "logs", "ffmpeg.log");
    let attemptedOutputPath = "";

    await expect(transcodeWebmToMp4({
      projectDir,
      inputBytes: Buffer.from("webm-bytes"),
      ffmpegPath: "/usr/local/bin/ffmpeg",
      stderrLogPath,
      runProcess: async (_command, args, runOptions) => {
        attemptedOutputPath = args[args.length - 1];
        fs.writeFileSync(attemptedOutputPath, "partial-mp4-bytes");
        runOptions?.onStderr?.("progress log line\n");
        return { code: 1, stderr: "encoder failed" };
      },
    })).rejects.toThrow("encoder failed");

    expect(fs.existsSync(attemptedOutputPath)).toBe(false);
    expect(fs.readFileSync(stderrLogPath, "utf8")).toContain("progress log line");
    expect(fs.readFileSync(stderrLogPath, "utf8")).toContain("encoder failed");
  });

  it("caps stderr in the thrown summary while preserving the full log on disk", async () => {
    const projectDir = makeTempDir();
    const stderrLogPath = path.join(projectDir, "ffmpeg-full.log");
    const longStderr = `${"x".repeat(90_000)}TAIL-MARKER`;

    await expect(transcodeWebmToMp4({
      projectDir,
      inputBytes: Buffer.from("webm-bytes"),
      ffmpegPath: "/usr/local/bin/ffmpeg",
      stderrLogPath,
      runProcess: async (_command, _args, runOptions) => {
        runOptions?.onStderr?.(longStderr);
        return { code: 1, stderr: "" };
      },
    })).rejects.toSatisfy((error: unknown) => error instanceof Error && error.message.length < 20_000 && error.message.includes("TAIL-MARKER"));

    expect(fs.readFileSync(stderrLogPath, "utf8")).toBe(longStderr);
  });

  it("rejects aborts with a cancellation error and removes partial output", async () => {
    const projectDir = makeTempDir();
    const controller = new AbortController();
    let attemptedOutputPath = "";

    await expect(transcodeWebmToMp4({
      projectDir,
      inputBytes: Buffer.from("webm-bytes"),
      ffmpegPath: "/usr/local/bin/ffmpeg",
      signal: controller.signal,
      runProcess: async (_command, args, runOptions) => {
        attemptedOutputPath = args[args.length - 1];
        fs.writeFileSync(attemptedOutputPath, "partial-mp4-bytes");
        controller.abort();
        runOptions?.signal?.throwIfAborted?.();
        throw new ExportCancelledError();
      },
    })).rejects.toMatchObject({ name: "ExportCancelledError" });

    expect(fs.existsSync(attemptedOutputPath)).toBe(false);
  });

  it("reports a reinstallable encoder component instead of asking users to install ffmpeg", async () => {
    const projectDir = makeTempDir();
    await expect(transcodeWebmToMp4({
      projectDir,
      inputBytes: Buffer.from("webm-bytes"),
      ffmpegPath: "",
      runProcess: vi.fn(),
    })).rejects.toThrow("MP4 编码组件缺失，请重新安装 Nomi");
  });
});

describe("renderFiltergraphToMp4", () => {
  const audioProfile: ExportProfile = {
    preset: "publish",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    audioMode: "mixdown",
    width: 1920,
    height: 1080,
    fps: 30,
    pixelFormat: "yuv420p",
    quality: "standard",
    audioBitrateKbps: 192,
  };

  const audioPlan: FfmpegFiltergraphPlan = {
    inputs: [{ assetId: "v1", path: "/media/clip.mp4", kind: "video", inputArgs: [] }],
    filterComplex: "[0:v]scale=1920:1080[vout];[0:a]asetpts=PTS-STARTPTS,adelay=0|0[aout]",
    videoOutputLabel: "[vout]",
    audioOutputLabel: "[aout]",
    warnings: [],
  };

  it("直读源文件渲染：拼 filter_complex + 映射音视频 + 输出可播放 MP4", async () => {
    const projectDir = makeTempDir();
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = await renderFiltergraphToMp4({
      projectDir,
      outputName: "Sound Export",
      ffmpegPath: "/usr/local/bin/ffmpeg",
      profile: audioProfile,
      filtergraph: audioPlan,
      runProcess: async (command, args) => {
        calls.push({ command, args });
        fs.writeFileSync(args[args.length - 1], "mp4-bytes");
        return { code: 0, stderr: "" };
      },
    });

    expect(result.relativePath).toMatch(/^exports\/Sound-Export-\d+\.mp4$/);
    expect(fs.readFileSync(result.absolutePath, "utf8")).toBe("mp4-bytes");
    expect(calls).toHaveLength(1);
    const args = calls[0].args;
    // 读源文件而非 webm：-i <源路径>
    expect(args).toContain("-i");
    expect(args).toContain("/media/clip.mp4");
    expect(args).toContain("-filter_complex");
    // 视频 + 音频都被映射
    expect(args).toContain("[vout]");
    expect(args).toContain("[aout]");
    // AAC 音频编码
    expect(args).toContain("-c:a");
    expect(args).toContain("aac");
    expect(args).toContain("libx264");
  });

  it("无音频输出标签时不写音频映射（纯视觉 letterbox）", async () => {
    const projectDir = makeTempDir();
    let captured: string[] = [];
    await renderFiltergraphToMp4({
      projectDir,
      outputName: "Silent Export",
      ffmpegPath: "/usr/local/bin/ffmpeg",
      profile: { ...audioProfile, audioCodec: "none", audioMode: "mute" },
      filtergraph: { ...audioPlan, audioOutputLabel: undefined, filterComplex: "[0:v]scale=1920:1080[vout]" },
      runProcess: async (_command, args) => {
        captured = args;
        fs.writeFileSync(args[args.length - 1], "mp4-bytes");
        return { code: 0, stderr: "" };
      },
    });
    expect(captured).toContain("[vout]");
    expect(captured).toContain("-an");
    expect(captured).not.toContain("[aout]");
  });

  it("ffmpeg 失败时抛错并清理 partial 文件", async () => {
    const projectDir = makeTempDir();
    let attempted = "";
    await expect(
      renderFiltergraphToMp4({
        projectDir,
        outputName: "Broken FG",
        ffmpegPath: "/usr/local/bin/ffmpeg",
        profile: audioProfile,
        filtergraph: audioPlan,
        runProcess: async (_command, args) => {
          attempted = args[args.length - 1];
          fs.writeFileSync(attempted, "partial");
          return { code: 1, stderr: "Unknown encoder" };
        },
      }),
    ).rejects.toThrow(/导出失败/);
    expect(fs.existsSync(attempted)).toBe(false);
  });
})
describe("导出最终改名撞上占用（播放器 / 资源管理器预览开着旧成品）", () => {
  const heldRename = (holdMs: number) => {
    const rename = fs.promises.rename.bind(fs.promises);
    let first: number | null = null;
    let attempts = 0;
    const spy = vi.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
      if (String(from).endsWith(".partial.mp4")) {
        attempts += 1;
        first ??= Date.now();
        if (Date.now() - first < holdMs) throw Object.assign(new Error("injected EPERM"), { code: "EPERM" });
      }
      return rename(from, to);
    });
    return { spy, get attempts() { return attempts; } };
  };
  const exportHeld = (projectDir: string) => transcodeWebmToMp4({
    projectDir,
    inputBytes: Buffer.from("webm-bytes"),
    outputName: "held",
    ffmpegPath: "/usr/local/bin/ffmpeg",
    runProcess: async (_command, args) => {
      fs.writeFileSync(args[args.length - 1], "mp4-bytes");
      return { code: 0, stderr: "" };
    },
  });

  it("占用 300ms：导出照常完成，成品文件在，中间文件不留", async () => {
    const projectDir = makeTempDir();
    const held = heldRename(300);
    try {
      const result = await exportHeld(projectDir);
      expect(fs.readFileSync(result.absolutePath, "utf8")).toBe("mp4-bytes");
      expect(fs.readdirSync(path.dirname(result.absolutePath)).filter((name) => name.includes(".partial"))).toEqual([]);
      expect(held.attempts).toBeGreaterThan(1);
    } finally {
      held.spy.mockRestore();
    }
  });

  it("一直被占着：用长退避表（8 次等待、共 9 次尝试）再报失败，不原地睡", async () => {
    const projectDir = makeTempDir();
    const held = heldRename(Infinity);
    try {
      await expect(exportHeld(projectDir)).rejects.toMatchObject({ code: "EPERM" });
    } finally {
      held.spy.mockRestore();
    }
    expect(held.attempts).toBe(9);
  });
});
