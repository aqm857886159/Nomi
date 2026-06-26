// nomi-local 素材的文件侧读取 + 上传通道(从 runtime.ts 抽出 —— 规则 12 巨壳净减)。
// R1 用:把本地素材(nomi-local://)读成字节,或 POST 到 vendor 上传端点。
import fs from "node:fs";
import { resolveProjectRelativePath } from "../projects/repository";
import { contentTypeFromPath } from "./assetPaths";
import type { LocalAsset } from "../catalog/assetLocalization";

/** nomi-local URL → 项目内文件绝对路径(校验 projectId 一致 + 是真实文件);否则 null。 */
export function absolutePathFromLocalAssetUrl(url: unknown, projectId: string): string | null {
  if (typeof url !== "string") return null;
  const prefix = "nomi-local://asset/";
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex < 0) return null;
  let urlProjectId: string;
  let relativePath: string;
  try {
    urlProjectId = decodeURIComponent(rest.slice(0, slashIndex));
    relativePath = rest.slice(slashIndex + 1).split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
  if (urlProjectId !== projectId || !relativePath) return null;
  try {
    const absolutePath = resolveProjectRelativePath(projectId, relativePath);
    return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile() ? absolutePath : null;
  } catch {
    return null;
  }
}

/**
 * 按 URL **自带的 projectId** 解析绝对路径(不强求等于当前项目)——与 readNomiLocalAsset 同口径。
 * C4 修:跨项目把素材库的图/视频拖进当前项目时,节点 URL 仍编源项目 id;生成侧(readNomiLocalAsset)本就
 * 自解析故能跑,但导出/抽帧侧用「当前 projectId 强匹配」→ urlProjectId !== projectId 返回 null → 跨项目素材
 * 在导出里读不到(整体回退 WebM)。统一成「信 URL 自带 id」消除这条不一致(无新暴露:生成侧早已这么读)。
 */
export function absolutePathFromLocalAssetUrlAnyProject(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const prefix = "nomi-local://asset/";
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex < 0) return null;
  let urlProjectId: string;
  try {
    urlProjectId = decodeURIComponent(rest.slice(0, slashIndex));
  } catch {
    return null;
  }
  return absolutePathFromLocalAssetUrl(url, urlProjectId);
}

/** R1：把 nomi-local URL(自带 projectId)读成字节 + contentType + 文件名,供 assetLocalization 上传/内联。
 *  同时读 sidecar `.meta` 文件里的 originalUrl（生成素材落盘时写入），
 *  供 assetLocalization 优先直接使用公网 URL 而无需转 base64 或调供应商上传 API。 */
export function readNomiLocalAsset(url: string): LocalAsset | null {
  const prefix = "nomi-local://asset/";
  if (typeof url !== "string" || !url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex < 0) return null;
  let projectId: string;
  let relativePath: string;
  try {
    projectId = decodeURIComponent(rest.slice(0, slashIndex));
    relativePath = rest.slice(slashIndex + 1).split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
  const absolutePath = absolutePathFromLocalAssetUrl(url, projectId);
  if (!absolutePath) return null;
  try {
    let originalUrl: string | undefined;
    try {
      const sidecar = JSON.parse(fs.readFileSync(`${absolutePath}.meta`, "utf8")) as Record<string, unknown>;
      if (typeof sidecar.originalUrl === "string" && /^https?:\/\//i.test(sidecar.originalUrl)) {
        originalUrl = sidecar.originalUrl;
      }
    } catch { /* sidecar 不存在或格式异常，忽略 */ }
    return {
      bytes: fs.readFileSync(absolutePath),
      contentType: contentTypeFromPath(absolutePath),
      fileName: relativePath.split("/").pop() || "asset",
      originalUrl,
    };
  } catch {
    return null;
  }
}

/** R1 上传通道(JSON body):固定可信端点(vendor 声明里),用普通 fetch(与 requestJson 一致)。 */
export async function postJsonForAssetUpload(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!response.ok) {
    const record = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    const detail = [record.msg, record.message, record.error].find((value) => typeof value === "string" && value) || "";
    throw new Error(`素材上传失败(HTTP ${response.status})：${detail || "(无详情)"}`);
  }
  return json;
}

/** R1 上传通道(multipart/form-data):file 字段二进制 + 可选文本字段(如 KIE stream 的 uploadPath/fileName)。
 *  fileField 默认 "file";litterbox 等匿名托管用 "fileToUpload"。 */
export async function postMultipartForAssetUpload(
  url: string,
  headers: Record<string, string>,
  file: Buffer,
  fileName: string,
  contentType: string,
  extraFields?: Record<string, string>,
  fileField = "file",
): Promise<unknown> {
  const form = new FormData();
  const arrayBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  form.append(fileField, new Blob([arrayBuffer], { type: contentType }), fileName);
  for (const [key, value] of Object.entries(extraFields ?? {})) form.append(key, value);
  // 不手动设 Content-Type，fetch 会自动加 boundary。
  const { "Content-Type": _drop, ...restHeaders } = headers;
  const response = await fetch(url, { method: "POST", headers: restHeaders, body: form });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!response.ok) {
    const record = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    const detail = [record.msg, record.message, record.error].find((value) => typeof value === "string" && value) || "";
    throw new Error(`素材上传失败(HTTP ${response.status})：${detail || "(无详情)"}`);
  }
  return json;
}
