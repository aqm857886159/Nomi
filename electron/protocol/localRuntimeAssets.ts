/**
 * `nomi-local://runtime/...` 与 `nomi-local://model/...` 的解析（唯一 owner）。
 *
 * ── 为什么必须走这条协议、不能用 file:// ────────────────────────────────────────
 * 打包态渲染层是 `file:///…/dist/index.html`。Chromium 对 `file:` 的 `fetch()` 一律按
 * 跨源拒绝，而 onnxruntime-web **就是用 fetch 取自己的 .wasm 和权重的**。
 * 所以随包资产也必须经由一个 `supportFetchAPI + corsEnabled` 的协议出去——`nomi-local`
 * 已经是这个应用唯一的本地伺服边界（main.ts 的 registerSchemesAsPrivileged），
 * 这里给它加两个 host，而不是再起一个 http 服务器或第二个协议。
 *
 * ── 两个 host 的边界 ─────────────────────────────────────────────────────────────
 * · `runtime/<bundleId>/<fileName>`：**随包**的第三方运行时资产（现在只有 ort 的 wasm）。
 *   目录由 `require.resolve` 定位，dev 读 node_modules、打包态读 asar 内同一份，两态同源。
 * · `model/<fileName>`：**下载到 userData** 的权重。`fileName` 必须逐字命中清单
 *   （`videoDepthModelByFileName`），所以这里根本没有「路径」可拼——不是靠 `..` 过滤，
 *   是靠白名单让越界的输入压根没有对应文件。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { videoDepthModelByFileName } from "../shared/canvas/videoDepthModels";
import { videoDepthModelPath } from "../video/depthVideoModelCache";

const requireFromHere = createRequire(__filename);

/** 随包运行时资产包：id → 解析到磁盘目录的方式 + 允许伺服的文件名后缀。 */
const RUNTIME_BUNDLES: Record<string, { resolveDir: () => string; allowedExtensions: readonly string[] }> = {
  /** onnxruntime-web 的 wasm/胶水（WebGPU 走 jsep 那一份）。 */
  ort: {
    // `require.resolve('onnxruntime-web')` 命中 exports 的 require 条件 → dist/ort.min.js。
    resolveDir: () => path.dirname(requireFromHere.resolve("onnxruntime-web")),
    allowedExtensions: [".wasm", ".mjs", ".js"],
  },
};

export type LocalRuntimeTarget = { filePath: string; contentType: string };

function contentTypeFor(fileName: string): string {
  if (fileName.endsWith(".wasm")) return "application/wasm";
  if (fileName.endsWith(".mjs") || fileName.endsWith(".js")) return "text/javascript";
  return "application/octet-stream";
}

/** 一个文件名是不是「一段」——没有分隔符、没有 `..`、没有隐藏前缀。 */
function isPlainFileName(segment: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment) && !segment.includes("..");
}

/** `nomi-local://runtime/<bundleId>/<fileName>` → 磁盘文件。命不中任何一条即 null。 */
export function resolveLocalRuntimeAsset(segments: readonly string[]): LocalRuntimeTarget | null {
  if (segments.length !== 2) return null;
  const [bundleId, fileName] = segments;
  const bundle = RUNTIME_BUNDLES[bundleId];
  if (!bundle || !isPlainFileName(fileName)) return null;
  if (!bundle.allowedExtensions.some((ext) => fileName.endsWith(ext))) return null;
  let dir: string;
  try {
    dir = bundle.resolveDir();
  } catch {
    return null;
  }
  const filePath = path.join(dir, fileName);
  // 双保险：白名单已经排除了分隔符，这里再确认解析结果没跑出包目录。
  if (!path.resolve(filePath).startsWith(path.resolve(dir) + path.sep)) return null;
  try {
    if (!fs.statSync(filePath).isFile()) return null;
  } catch {
    return null;
  }
  return { filePath, contentType: contentTypeFor(fileName) };
}

/** `nomi-local://model/<fileName>` → userData 里那份已校验过的权重。 */
export function resolveLocalModelAsset(segments: readonly string[]): LocalRuntimeTarget | null {
  if (segments.length !== 1) return null;
  const asset = videoDepthModelByFileName(segments[0]);
  if (!asset) return null;
  const filePath = videoDepthModelPath(asset);
  try {
    if (!fs.statSync(filePath).isFile()) return null;
  } catch {
    return null;
  }
  return { filePath, contentType: "application/octet-stream" };
}

/** 渲染层拿到的可 fetch 地址。目录形式（结尾带 /）供 ort / MediaPipe 当 base 用。 */
export function localRuntimeBundleUrl(bundleId: keyof typeof RUNTIME_BUNDLES): string {
  return `nomi-local://runtime/${bundleId}/`;
}

export function localModelUrl(fileName: string): string {
  return `nomi-local://model/${encodeURIComponent(fileName)}`;
}
