import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { runBoundedProcess } from "../export/mediaProbe";
import type { AntigravityArtifact, AntigravityToolStep } from "./antigravityProtocol";

export const ANTIGRAVITY_IMAGE_LIMIT = 20 * 1024 * 1024;
const MAX_PIXELS = 16_777_216;

export function imageDecoderInputArgs(mimeType: string, byteLength: number): string[] {
  const inputDemuxer = mimeType === "image/webp" ? "webp_pipe" : "image2pipe";
  return ["-f", inputDemuxer, "-frame_size", String(byteLength)];
}

/** No directory enumeration, symlinks, devices, FIFOs, or unbounded reads. */
export async function readAntigravityFile(root: string, relative: string, limit: number): Promise<Buffer> {
  try {
    const parts = relative.split(/[\\/]+/);
    if (path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)
      || parts.some((part) => !part || part === "." || part === "..")) throw new Error();
    let current = root;
    const directories: Array<{ path: string; dev: number; ino: number }> = [];
    for (const part of ["", ...parts.slice(0, -1)]) {
      if (part) current = path.join(current, part);
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error();
      directories.push({ path: current, dev: info.dev, ino: info.ino });
    }
    const file = await open(path.join(root, relative), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size <= 0 || info.size > limit) throw new Error();
      // Recheck after open before reading; a renamed parent must not redirect a scoped read.
      for (const directory of directories) {
        const now = await lstat(directory.path);
        if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== directory.dev || now.ino !== directory.ino) throw new Error();
      }
      const named = await lstat(path.join(root, relative));
      // libuv reports different `dev` values for an open handle and lstat on
      // Windows, while the file index (`ino`) remains stable. Keep the
      // identity race check strict on POSIX and use the stable Windows index.
      const identityChanged = process.platform === "win32"
        ? named.ino !== info.ino
        : named.dev !== info.dev || named.ino !== info.ino;
      if (named.isSymbolicLink() || identityChanged) throw new Error();
      const bytes = Buffer.alloc(Math.min(info.size + 1, limit + 1));
      let offset = 0;
      while (offset < bytes.length) {
        const read = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      if (offset !== info.size) throw new Error();
      return bytes.subarray(0, offset);
    } finally { await file.close(); }
  } catch { throw new Error("ANTIGRAVITY_ARTIFACT_UNSAFE"); }
}

/** Decode the copied bytes, never reopen an untrusted path in a decoder. */
export async function validateAntigravityImage(bytes: Uint8Array, declaredMime?: string, signal?: AbortSignal): Promise<{
  mimeType: string; extension: string; width: number; height: number;
}> {
  if (signal?.aborted) throw Object.assign(new Error("ANTIGRAVITY_CANCELLED"), { name: "AbortError" });
  const data = Buffer.from(bytes);
  let mimeType = ""; let extension = "";
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && data.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))) {
    mimeType = "image/png"; extension = "png";
  } else if (data[0] === 255 && data[1] === 216 && data[data.length - 2] === 255 && data[data.length - 1] === 217) {
    mimeType = "image/jpeg"; extension = "jpg";
  } else if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP"
    && data.readUInt32LE(4) + 8 === data.length) { mimeType = "image/webp"; extension = "webp"; }
  if (!mimeType || data.length > ANTIGRAVITY_IMAGE_LIMIT || (declaredMime && declaredMime !== mimeType)) {
    throw new Error("ANTIGRAVITY_IMAGE_INVALID");
  }
  // Existing bundled decoder; strict error mode validates pixels, not merely headers. It shares the
  // certification process runner so timeout/cancel kills the complete process tree and waits for reap.
  // FFmpeg 4.1 otherwise splits piped WebP into 4096-byte packets. Bind the trusted MIME and exact
  // bounded byte count so every bundled version sends one complete image container to the decoder.
  const decodedResult = await runBoundedProcess(
    resolveFfmpegPath(),
    ["-hide_banner", "-v", "error", "-xerror", "-err_detect", "explode",
      "-max_pixels", String(MAX_PIXELS), ...imageDecoderInputArgs(mimeType, data.length),
      "-i", "pipe:0", "-frames:v", "1", "-f", "framehash", "pipe:1"],
    { signal, timeoutMs: 10_000, maxStdoutBytes: 16_384, maxStderrBytes: 4_096, input: data },
  );
  if (decodedResult.code !== 0 || decodedResult.stderr.trim()) throw new Error("ANTIGRAVITY_IMAGE_INVALID");
  const decoded = decodedResult.stdout;
  const dimensions = /^#dimensions 0: (\d+)x(\d+)$/m.exec(decoded);
  const frames = decoded.split("\n").filter((line) => /^0,/.test(line));
  const width = Number(dimensions?.[1]); const height = Number(dimensions?.[2]);
  if (!width || !height || width * height > MAX_PIXELS || frames.length !== 1) throw new Error("ANTIGRAVITY_IMAGE_INVALID");
  return { mimeType, extension, width, height };
}

export async function recoverAntigravityArtifact(input: {
  home: string; conversationId: string; imageName: string; imagePaths: string[];
  toolSteps: AntigravityToolStep[]; signal?: AbortSignal;
}): Promise<AntigravityArtifact> {
  const { conversationId, imageName, imagePaths, toolSteps } = input;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)
    || !/^nomi_image_[0-9a-f]{32}$/.test(imageName) || toolSteps.length !== 1 || toolSteps[0].name !== "generate_image") {
    throw new Error("ANTIGRAVITY_ARTIFACT_UNSAFE");
  }
  const prefix = path.join(".gemini", "antigravity-cli", "brain", conversationId);
  const transcript = await readAntigravityFile(input.home, path.join(prefix, ".system_generated", "logs", "transcript_full.jsonl"), 2 * 1024 * 1024);
  try {
    const entries = transcript.toString("utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    const calls = entries.flatMap((entry) => {
      if (!("tool_calls" in entry)) return [];
      if (Array.isArray(entry.tool_calls) && entry.tool_calls.length === 0) return [];
      if (!Array.isArray(entry.tool_calls) || entry.type !== "PLANNER_RESPONSE" || entry.status !== "DONE"
        || entry.step_index !== toolSteps[0].index - 1) throw new Error();
      return entry.tool_calls as Array<{ name: string; args: Record<string, unknown> }>;
    });
    if (calls.length !== 1 || calls[0].name !== "generate_image" || calls[0].args?.ImageName !== imageName
      || JSON.stringify(calls[0].args.ImagePaths ?? []) !== JSON.stringify(imagePaths)) throw new Error();
    const step = entries.filter((entry) => entry.step_index === toolSteps[0].index);
    if (step.length !== 1 || step[0].type !== "GENERIC" || step[0].status !== "DONE") throw new Error();
  } catch { throw new Error("ANTIGRAVITY_ARTIFACT_UNVERIFIED"); }
  const output = await readAntigravityFile(input.home,
    path.join(prefix, ".system_generated", "steps", String(toolSteps[0].index), "output.txt"), 64 * 1024);
  const matches = [...output.toString("utf8").matchAll(/^Generated image is saved at (.+)\.$/gm)];
  if (matches.length !== 1) throw new Error("ANTIGRAVITY_ARTIFACT_UNVERIFIED");
  const filename = path.basename(matches[0][1]);
  if (!new RegExp("^" + imageName + "_[0-9]{10,16}\\.(png|jpg|webp)$").test(filename)
    || matches[0][1] !== path.join(input.home, prefix, filename)) throw new Error("ANTIGRAVITY_ARTIFACT_UNSAFE");
  const bytes = await readAntigravityFile(input.home, path.join(prefix, filename), ANTIGRAVITY_IMAGE_LIMIT);
  const image = await validateAntigravityImage(bytes, undefined, input.signal);
  if (!filename.endsWith("." + image.extension)) throw new Error("ANTIGRAVITY_IMAGE_INVALID");
  return { bytes, mimeType: image.mimeType, width: image.width, height: image.height, filename };
}
