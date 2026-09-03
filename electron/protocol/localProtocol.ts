import { protocol } from "electron";
import fs from "node:fs";
import { createOwnedFileStream } from "./fileResponseStream";
import { contentTypeFromPath } from "../assets/assetPaths";
import { resolveContentType } from "../assets/mediaTypes";
import { resolveProjectRelativePath } from "../projects/repository";
import { getArtifactPreviewSecret, verifyArtifactPreviewHandle } from "../productionRun/artifactProjection";
import { appendEvents } from "../events/eventLogRepository";

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

function contentTypeForFile(filePath: string): string {
  const extensionType = contentTypeFromPath(filePath);
  if (extensionType !== "application/octet-stream") return extensionType;
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(filePath, "r");
    const header = Buffer.alloc(4096);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    return resolveContentType(filePath, header.subarray(0, bytesRead));
  } catch {
    return extensionType;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
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
    "Content-Type": contentTypeForFile(filePath),
    "Content-Length": String(contentLength),
    "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
  });
  const body = method === "HEAD" ? null : createOwnedFileStream(filePath, { start: range.start, end: range.end });
  return new Response(body, { status: 206, headers });
}

function rangeNotSatisfiable(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: withLocalAssetHeaders({ "Content-Range": `bytes */${size}` }),
  });
}

export async function handleNomiLocalRequest(request: Request): Promise<Response> {
  const target = parseLocalAssetUrl(request.url);
  const respond = (response: Response): Response => {
    if (target?.projectId) {
      appendEvents(target.projectId, [{
        id: `local-response-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        source: 'runtime',
        type: 'preview.local.response',
        payload: {
          method: request.method,
          status: response.status,
          range: Boolean(request.headers.get('range')),
          contentType: response.headers.get('content-type') || '',
        },
      }]);
    }
    return response;
  };
  try {
    const filePath = target?.filePath ?? null;
    if (!filePath) {
      return new Response("Unsupported nomi-local host", { status: 404 });
    }
    const rangeHeader = request.headers.get("range") || "";
    if (rangeHeader) {
      const stat = fs.statSync(filePath);
      const range = parseRangeHeader(rangeHeader, stat.size);
      if (!range) return respond(rangeNotSatisfiable(stat.size));
      return respond(streamRange(filePath, range, stat.size, request.method));
    }
    const stat = fs.statSync(filePath);
    const headers = withLocalAssetHeaders({
      "Content-Type": contentTypeForFile(filePath),
      "Content-Length": String(stat.size),
    });
    // 这里踩过三条路，**全都抛同一个 ERR_INVALID_STATE**（不可捕获，直接弹主进程崩溃框）。
    // 判据不是「用哪个 API」，而是「**流的关闭权在不在我们手里**」：
    //   ① 包 net.fetch 的响应流 → Electron 关一次、原始 Response 再关一次；
    //   ② `new Response(nodeStream)` → 关闭权交给 undici 的 ReadableStreamFrom，
    //      它在 queueMicrotask 里裸调 close()、cancel() 又不置标记（2026-08-24 用户报的就是这条）；
    //   ③ `Readable.toWeb(nodeStream)` → 换成 Node 自己的适配器，同族竞态 nodejs/node#64529
    //      至今 OPEN、修复 PR 未合（本仓 v0.20.1 的 fileBody() 曾走这条，已在本轮删除）。
    // 三条都得避开：用我们自己拥有、自带关闭闸的流。见 ./fileResponseStream.ts。
    const body = request.method === "HEAD" ? null : createOwnedFileStream(filePath);
    return respond(new Response(body, { status: 200, headers }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "local asset not found";
    return respond(new Response(message, { status: 404 }));
  }
}

export function registerLocalProtocol(): void {
  protocol.handle("nomi-local", handleNomiLocalRequest);
}
