// 即梦 CLI 输入文件吞入：把 Nomi 槽给的资产 URL（nomi-local://http/data）物化成**本地文件路径**，
// 供 dreamina 的带图/视频/音频命令（image2image/image2video/frames2video/multiframe2video/multimodal2video/
// image_upscale）的 `--image=./x.png` 类参数使用。与 HTTP vendor「URL 吞入」相反（CLI 收本地路径）。
//
// nomi-local 零拷贝（取项目内现成绝对路径）；http/data 下到 temp（spawn 后由 processOperation 清理）。
// shaping（路径→single/csv/repeat 暴露形态）抽成纯函数可裸测。

import { writeFileSync } from "node:fs";
import path from "node:path";
import { absolutePathFromLocalAssetUrl } from "../assets/localAssetFile";
import { extensionFromMime, extensionFromUrl } from "../assets/assetPaths";
import { hardenedFetch } from "../hardenedFetch";

export type FileParamSpec = { param: string; expose: string; mode: "single" | "csv" | "repeat" | "array"; flag?: string };

/** 把 request.params 里某键的值归一成 URL 列表（string / string[] / 缺省）。 */
export function toUrlList(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(toUrlList);
  return [];
}

/**
 * 纯函数：给定一个 fileParam 声明和它物化后的本地路径列表，算出要写回 params[expose] 的值。
 *  - single：首个路径（没有则空串）
 *  - csv   ：逗号连接
 *  - repeat：`flag=path` 字符串数组（args 模板里 exact `{{...}}` 会 spread 成多个参数）
 */
export function shapeFileParam(spec: FileParamSpec, paths: string[]): string | string[] {
  if (spec.mode === "single") return paths[0] || "";
  if (spec.mode === "csv") return paths.join(",");
  if (spec.mode === "array") return paths; // 原样数组（多帧的特殊 build 直接读路径列表）
  // repeat
  const flag = spec.flag || "";
  return paths.map((p) => `${flag}=${p}`);
}

/** 物化单个资产 URL → 本地绝对路径。nomi-local 零拷贝；http/data 下到 tmpDir（返回路径供清理）。无法物化返回 ""。 */
export async function materializeAssetToPath(url: string, projectId: string, tmpDir: string): Promise<{ filePath: string; temp: boolean }> {
  const u = String(url || "").trim();
  if (!u) return { filePath: "", temp: false };

  // nomi-local：项目内现成文件，直接取绝对路径（零拷贝）。
  if (u.startsWith("nomi-local://")) {
    const abs = absolutePathFromLocalAssetUrl(u, projectId);
    return { filePath: abs || "", temp: false };
  }

  // file://：剥成本地路径。
  if (u.startsWith("file://")) {
    try {
      let p = decodeURIComponent(new URL(u).pathname);
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
      return { filePath: p, temp: false };
    } catch {
      return { filePath: "", temp: false };
    }
  }

  // data:URI：解码写 temp。
  if (u.startsWith("data:")) {
    const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(u);
    if (!match) return { filePath: "", temp: false };
    const mime = match[1] || "application/octet-stream";
    const bytes = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]));
    const dest = path.join(tmpDir, `in-${unique()}.${extensionFromMime(mime, "bin")}`);
    writeFileSync(dest, bytes);
    return { filePath: dest, temp: true };
  }

  // http(s)：下到 temp（hardenedFetch 拦私网 + 限大小）。
  if (/^https?:\/\//i.test(u)) {
    const fetched = await hardenedFetch(u, {
      timeoutMs: 60_000,
      maxBytes: 200 * 1024 * 1024,
      allowContentTypes: ["image/", "video/", "audio/", "application/octet-stream"],
    });
    const ext = extensionFromMime(fetched.contentType || "", extensionFromUrl(u) || "bin");
    const dest = path.join(tmpDir, `in-${unique()}.${ext}`);
    writeFileSync(dest, fetched.bytes);
    return { filePath: dest, temp: true };
  }

  // 已经是本地路径（如档案直接给路径）→ 原样用。
  return { filePath: u, temp: false };
}

let counter = 0;
function unique(): string {
  counter = (counter + 1) % 1_000_000;
  return `${counter.toString(36)}-${process.pid}`;
}

/**
 * 物化一个 op 的所有 fileParams：读 params[param] 的 URL → 本地路径 → 按 mode 写回 params[expose]。
 * 直接改传入的 params 对象（context.request.params）。返回需清理的 temp 文件路径列表。
 */
export async function materializeInputFiles(
  params: Record<string, unknown>,
  fileParams: FileParamSpec[],
  projectId: string,
  tmpDir: string,
): Promise<string[]> {
  const tempFiles: string[] = [];
  for (const spec of fileParams) {
    const urls = toUrlList(params[spec.param]);
    const paths: string[] = [];
    for (const url of urls) {
      const { filePath, temp } = await materializeAssetToPath(url, projectId, tmpDir);
      if (!filePath) continue;
      paths.push(filePath);
      if (temp) tempFiles.push(filePath);
    }
    params[spec.expose] = shapeFileParam(spec, paths);
  }
  return tempFiles;
}
