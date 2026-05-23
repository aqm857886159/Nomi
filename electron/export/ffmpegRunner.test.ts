import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportDimensionsForPreset, resolveFfmpegPath, transcodeWebmFileToMp4, transcodeWebmToMp4 } from "./ffmpegRunner";

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
