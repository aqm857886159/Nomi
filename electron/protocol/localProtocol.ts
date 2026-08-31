import { net, protocol } from "electron";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { contentTypeFromPath } from "../assets/assetPaths";
import { resolveProjectRelativePath } from "../projects/repository";
import { getArtifactPreviewSecret, verifyArtifactPreviewHandle } from "../productionRun/artifactProjection";

function withLocalAssetHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  // canvas.toDataURL() 需要 CORS 头，否则 crossOrigin='anonymous' 加载的图片会污染画布
  // 导致九宫格/裁切等操作静默失败（SecurityError 被吞掉）。
  next.set("Access-Control-Allow-Origin", "*");
  next.set("Cross-Origin-Resource-Policy", "cross-origin");
  next.set("Accept-Ranges", "bytes");
  return next;
}

/** nomi-local://asset/... → { projectId, 磁盘绝对路径 }。协议处理与懒自愈（ensurePlayableAsset）共用。 */
export function parseLocalAssetUrl(rawUrl: string): { projectId: string; filePath: string } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "nomi-local:" || !["asset", "production-preview"].includes(url.hostname)) return null;
  // 解码与 localAssetUrl 的「逐段 encodeURIComponent」对称：先按 "/" 切段、再逐段 decode。
  // （此前先整体 decode 再 split，文件名若含被编码的 %2F 会让段边界错位 → 路径错位 404。）
  const segments = url.pathname
    .replace(/^\/+/, "")
    .split("/")
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    });
  const productionPreview = url.hostname === "production-preview";
  const [projectId, runId, artifactId, ...previewRelativeParts] = productionPreview ? segments : [segments[0], "", "", ...segments.slice(1)];
  const relativeParts = productionPreview ? previewRelativeParts : segments.slice(1);
  if (!projectId) return null;
  try {
    const queryKeys = [...url.searchParams.keys()];
    if (productionPreview) {
      if (!runId || !artifactId || queryKeys.length !== 1 || queryKeys[0] !== "preview") return null;
      const token = url.searchParams.get("preview") || "";
      verifyArtifactPreviewHandle({
        token,
        secret: getArtifactPreviewSecret(),
        expected: { projectId, runId, artifactId, relativePath: relativeParts.join("/") },
      });
    } else if (queryKeys.length > 0) {
      return null;
    }
    const filePath = resolveProjectRelativePath(projectId, relativeParts.join("/"));
    return filePath ? { projectId, filePath } : null;
  } catch {
    // 项目不存在/路径越界（resolveProjectRelativePath 抛）→ 解析失败，调用方按 404/不适用处理。
    return null;
  }
}

function assetPathFromUrl(rawUrl: string): string | null {
  return parseLocalAssetUrl(rawUrl)?.filePath ?? null;
}

type ByteRange = { start: number; end: number };

function parseRangeHeader(rangeHeader: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match || size <= 0) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  if (!rawStart) {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number.parseInt(rawStart, 10);
  const end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function streamRange(filePath: string, range: ByteRange, size: number, method: string): Response {
  const contentLength = range.end - range.start + 1;
  const headers = withLocalAssetHeaders({
    "Content-Type": contentTypeFromPath(filePath),
    "Content-Length": String(contentLength),
    "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
  });
  const body = method === "HEAD" ? null : fs.createReadStream(filePath, { start: range.start, end: range.end });
  return new Response(body as BodyInit | null, { status: 206, headers });
}

function rangeNotSatisfiable(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: withLocalAssetHeaders({ "Content-Range": `bytes */${size}` }),
  });
}

export async function handleNomiLocalRequest(request: Request): Promise<Response> {
  try {
    const filePath = assetPathFromUrl(request.url);
    if (!filePath) {
      return new Response("Unsupported nomi-local host", { status: 404 });
    }
    const rangeHeader = request.headers.get("range") || "";
    if (rangeHeader) {
      const stat = fs.statSync(filePath);
      const range = parseRangeHeader(rangeHeader, stat.size);
      if (!range) return rangeNotSatisfiable(stat.size);
      return streamRange(filePath, range, stat.size, request.method);
    }
    const fileResponse = await net.fetch(pathToFileURL(filePath).toString());
    const corsHeaders = withLocalAssetHeaders(fileResponse.headers);
    return new Response(request.method === "HEAD" ? null : fileResponse.body, { status: fileResponse.status, headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "local asset not found";
    return new Response(message, { status: 404 });
  }
}

export function registerLocalProtocol(): void {
  protocol.handle("nomi-local", handleNomiLocalRequest);
}
