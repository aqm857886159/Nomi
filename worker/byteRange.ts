/**
 * Byte-range serving for static assets (RFC 9110 §14) within the Workers Free <1ms JS CPU budget.
 *
 * Cloudflare's static asset server answers every GET with the whole file (200/304/404 only).
 * Safari and every iOS browser refuse to play media from a server that ignores Range, so the
 * site worker owns ranges for media routed via `run_worker_first`:
 *
 * 1. When `caches.default` is available (Cloudflare Zone custom domains), C++ edge cache
 *    natively handles HTTP Range (`206 Partial Content`, `Content-Range`, `416`) with 0ms JS
 *    stream loops. Cache hits return directly; cache misses populate the full `200` response
 *    with exact `Content-Length` and cacheable `Cache-Control` via `ExecutionContext.waitUntil`.
 * 2. Asset byte lengths come strictly in O(1) from upstream `Content-Length` or the build-synced
 *    `MEDIA_ASSET_SIZES` manifest — never by reading the stream in JS to count bytes.
 */

import { MEDIA_ASSET_SIZES } from "./mediaAssetSizes";

export type ByteRange = { start: number; end: number };
export type AssetsFetcher = { fetch(request: Request): Promise<Response> };
/** The Workers runtime's FixedLengthStream: sets Content-Length on a streamed body. */
export type FixedLengthStreamFactory = (length: number) => TransformStream<Uint8Array, Uint8Array>;

export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

function defaultEdgeCache(): EdgeCache | undefined {
  const storage = (globalThis as { caches?: { default?: EdgeCache } }).caches;
  return storage?.default;
}

function isSingleByteRangeSyntax(header: string): boolean {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return false;
  const [, first, last] = match;
  if (first === "" && last === "") return false;
  if (first !== "" && last !== "" && Number(last) < Number(first)) return false;
  return true;
}

export function parseByteRange(header: string, size: number): ByteRange | "unsatisfiable" | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, first, last] = match;
  if (first === "" && last === "") return null;
  if (first === "") {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (last !== "" && Number(last) < start) return null;
  if (start >= size) return "unsatisfiable";
  return { start, end: last === "" ? size - 1 : Math.min(Number(last), size - 1) };
}

function resolveAssetSize(
  requestUrl: string,
  headers: Headers,
  knownSizes: Readonly<Record<string, number>>,
): number | null {
  const contentLength = headers.get("Content-Length");
  if (contentLength !== null && /^\d+$/.test(contentLength.trim())) {
    const parsed = Number(contentLength.trim());
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  const rawPathname = new URL(requestUrl).pathname;
  let pathname = rawPathname;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    // Keep rawPathname when percent-encoding is malformed.
  }
  const known = knownSizes[pathname];
  return typeof known === "number" && Number.isSafeInteger(known) && known >= 0 ? known : null;
}

function buildEdgeCacheHeaders(sourceHeaders: Headers, size: number): Headers {
  const cacheHeaders = new Headers(sourceHeaders);
  cacheHeaders.set("Accept-Ranges", "bytes");
  cacheHeaders.set("Content-Length", String(size));
  const cc = cacheHeaders.get("Cache-Control") ?? "";
  if (!/\b(?:no-store|private)\b/i.test(cc) && !/\b(?:s-maxage|max-age)=[1-9]\d*/i.test(cc)) {
    cacheHeaders.set("Cache-Control", "public, max-age=3600");
  }
  return cacheHeaders;
}

async function matchEdgeCache(edgeCache: EdgeCache, request: Request): Promise<Response | undefined> {
  if (request.method === "HEAD") {
    const headers = new Headers(request.headers);
    headers.delete("Range");
    const hit =
      (await edgeCache.match(new Request(request.url, { method: "HEAD", headers }))) ??
      (await edgeCache.match(new Request(request.url, { method: "GET", headers })));
    if (!hit) return undefined;
    if (hit.body !== null) await hit.body.cancel();
    return new Response(null, { status: hit.status, statusText: hit.statusText, headers: hit.headers });
  }
  if (request.method !== "GET") return undefined;
  const rangeHeader = request.headers.get("Range");
  if (rangeHeader !== null && !isSingleByteRangeSyntax(rangeHeader)) {
    const headers = new Headers(request.headers);
    headers.delete("Range");
    return edgeCache.match(new Request(request.url, { method: "GET", headers }));
  }
  return edgeCache.match(request);
}

function sliceBody(body: ReadableStream<Uint8Array>, { start, end }: ByteRange): ReadableStream<Uint8Array> {
  let offset = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const chunkStart = offset;
        offset += chunk.byteLength;
        if (offset <= start || chunkStart > end) return;
        controller.enqueue(chunk.subarray(Math.max(0, start - chunkStart), Math.min(chunk.byteLength, end + 1 - chunkStart)));
        if (offset > end) controller.terminate();
      },
    }),
  );
}

export async function serveAssetWithRanges(
  request: Request,
  assets: AssetsFetcher,
  fixedLength: FixedLengthStreamFactory,
  ctx?: ExecutionContextLike,
  knownAssetSizes: Readonly<Record<string, number>> = MEDIA_ASSET_SIZES,
  edgeCache: EdgeCache | undefined = defaultEdgeCache(),
): Promise<Response> {
  if (edgeCache !== undefined && (request.method === "GET" || request.method === "HEAD")) {
    const cached = await matchEdgeCache(edgeCache, request);
    if (cached) return cached;
  }

  const response = await assets.fetch(request);
  const etag = response.headers.get("ETag");
  // Ranges address the stored bytes: only a whole, unencoded, identifiable file qualifies.
  if (response.status !== 200 || etag === null || response.headers.has("Content-Encoding")) return response;

  const size = resolveAssetSize(request.url, response.headers, knownAssetSizes);
  const headers = new Headers(response.headers);
  headers.set("Accept-Ranges", "bytes");
  const body = response.body;

  // Range is defined for GET only (RFC 9110 §14.2); HEAD and the rest get the plain answer.
  if (request.method !== "GET" || body === null) {
    if (size !== null) headers.set("Content-Length", String(size));
    return new Response(body, { status: 200, headers });
  }

  const cacheControl = headers.get("Cache-Control") ?? "";
  const canCache = edgeCache !== undefined && size !== null && !/\b(?:no-store|private)\b/i.test(cacheControl);
  const putFullInEdgeCache = (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const putPromise = edgeCache!.put(
      new Request(request.url, { method: "GET" }),
      new Response(stream.pipeThrough(fixedLength(size!)), {
        status: 200,
        headers: buildEdgeCacheHeaders(headers, size!),
      }),
    );
    ctx?.waitUntil(putPromise.catch(() => {}));
    return putPromise;
  };

  const rangeHeader = request.headers.get("Range");
  const ifRange = request.headers.get("If-Range");
  const range =
    rangeHeader === null || size === null || (ifRange !== null && ifRange !== etag)
      ? null
      : parseByteRange(rangeHeader, size);

  if (size === null || range === null) {
    if (size !== null) headers.set("Content-Length", String(size));
    if (canCache) {
      const [clientStream, cacheStream] = body.tee();
      void putFullInEdgeCache(cacheStream).catch(() => {});
      return new Response(clientStream.pipeThrough(fixedLength(size)), { status: 200, headers });
    }
    return new Response(body, { status: 200, headers });
  }

  if (range === "unsatisfiable") {
    headers.delete("Content-Length");
    headers.set("Content-Range", `bytes */${size}`);
    if (canCache) {
      void putFullInEdgeCache(body).catch(() => {});
    } else {
      await body.cancel();
    }
    return new Response(null, { status: 416, headers });
  }

  const partialLength = range.end - range.start + 1;
  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  headers.set("Content-Length", String(partialLength));

  // Full-span Range (e.g. Chrome `Range: bytes=0-`) streams the entire file natively without a JS slice TransformStream.
  if (range.start === 0 && range.end === size - 1) {
    if (canCache) {
      const [clientStream, cacheStream] = body.tee();
      void putFullInEdgeCache(cacheStream).catch(() => {});
      return new Response(clientStream.pipeThrough(fixedLength(partialLength)), { status: 206, headers });
    }
    return new Response(body.pipeThrough(fixedLength(partialLength)), { status: 206, headers });
  }

  if (canCache) {
    try {
      await putFullInEdgeCache(body);
      const slicedByEdge = await edgeCache.match(request);
      if (slicedByEdge) return slicedByEdge;
    } catch {
      // Fall back to direct fetch when edgeCache.put rejects (e.g. preview environment).
    }
    const fallback = await assets.fetch(new Request(request.url, { method: "GET" }));
    if (fallback.status !== 200 || fallback.body === null) return fallback;
    return new Response(sliceBody(fallback.body, range).pipeThrough(fixedLength(partialLength)), { status: 206, headers });
  }

  const partial = sliceBody(body, range).pipeThrough(fixedLength(partialLength));
  return new Response(partial, { status: 206, headers });
}
