import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type WorkerEnv } from "../../worker";
import { parseByteRange } from "../../worker/byteRange";

// Cloudflare's asset server answers every GET with the whole file (200/304/404 only),
// so the site worker owns byte ranges for what it proxies. When `caches.default` is
// present on a custom domain, C++ edge cache answers Range requests directly with zero
// JS stream work; otherwise `Content-Length` or `MEDIA_ASSET_SIZES` supplies the exact
// byte count in O(1) without ever reading the stream to count bytes.

const FILM = "https://nomiaqm.com/assets/video/nomi-0.22-film.mp4";
const WEBM = "https://nomiaqm.com/docs-media/zh-CN/mcp-open-card.webm";
const REAL_FILM_BYTES = 7_962_929;
const REAL_WEBM_BYTES = 38_161;
const BYTES = Uint8Array.from({ length: 64 }, (_, i) => i);
const ETAG = '"film-etag"';

function assetResponse(
  etag = ETAG,
  { chunkSize = 7, bytes = BYTES, withContentLength = true }: { chunkSize?: number; bytes?: Uint8Array; withContentLength?: boolean } = {},
): Response {
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Cache-Control": "public, max-age=3600, must-revalidate",
    ETag: etag,
  };
  if (withContentLength) headers["Content-Length"] = String(bytes.length);
  return new Response(body, { status: 200, headers });
}

function envServing(response: () => Response): WorkerEnv {
  return { ASSETS: { fetch: async () => response() } };
}

async function get(headers: Record<string, string>, env = envServing(() => assetResponse()), url = FILM) {
  return worker.fetch(new Request(url, { headers }), env);
}

// The Workers runtime provides FixedLengthStream; this stand-in keeps its contract:
// it errors unless exactly `length` bytes pass through.
const NativeTransformStream = globalThis.TransformStream;
class FixedLengthStreamStandIn extends NativeTransformStream<Uint8Array, Uint8Array> {
  static lengths: number[] = [];
  constructor(length: number) {
    let seen = 0;
    super({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > length) throw new Error(`FixedLengthStream overflow: ${seen} > ${length}`);
        controller.enqueue(chunk);
      },
      flush() {
        if (seen !== length) throw new Error(`FixedLengthStream underflow: ${seen} !== ${length}`);
      },
    });
    FixedLengthStreamStandIn.lengths.push(length);
  }
}

// Faithful stand-in for Cloudflare's C++ `caches.default` (supports GET/HEAD lookup and RFC 9110 Range slicing).
function createEdgeCacheStandIn() {
  const entries = new Map<string, { bytes: Uint8Array; headers: Headers }>();
  let matches = 0;
  let puts = 0;

  return {
    entries,
    get matches() { return matches; },
    get puts() { return puts; },
    async put(request: Request, response: Response): Promise<void> {
      if (request.method !== "GET") throw new TypeError("Cache.put only accepts GET requests");
      if (response.status !== 200) throw new TypeError(`Cache.put only accepts 200 responses, got ${response.status}`);
      puts += 1;
      const cc = response.headers.get("Cache-Control") ?? "";
      if (/\b(?:no-store|private)\b/i.test(cc) || !/\b(?:s-maxage|max-age)=[1-9]\d*/i.test(cc)) return;
      const bytes = new Uint8Array(await response.arrayBuffer());
      entries.set(request.url, { bytes, headers: new Headers(response.headers) });
    },
    async match(request: Request): Promise<Response | undefined> {
      matches += 1;
      if (request.method !== "GET" && request.method !== "HEAD") return undefined;
      const cached = entries.get(request.url);
      if (!cached) return undefined;
      const headers = new Headers(cached.headers);
      headers.set("Accept-Ranges", "bytes");
      if (request.method === "HEAD") {
        headers.set("Content-Length", String(cached.bytes.byteLength));
        return new Response(null, { status: 200, headers });
      }
      const rangeHeader = request.headers.get("Range");
      const ifRange = request.headers.get("If-Range");
      const etag = headers.get("ETag");
      if (rangeHeader !== null && (ifRange === null || ifRange === etag)) {
        const range = parseByteRange(rangeHeader, cached.bytes.byteLength);
        if (range === "unsatisfiable") {
          headers.delete("Content-Length");
          headers.set("Content-Range", `bytes */${cached.bytes.byteLength}`);
          return new Response(null, { status: 416, headers });
        }
        if (range !== null) {
          const slice = cached.bytes.subarray(range.start, range.end + 1);
          headers.set("Content-Range", `bytes ${range.start}-${range.end}/${cached.bytes.byteLength}`);
          headers.set("Content-Length", String(slice.byteLength));
          return new Response(new Uint8Array(slice).buffer, { status: 206, headers });
        }
      }
      headers.set("Content-Length", String(cached.bytes.byteLength));
      return new Response(new Uint8Array(cached.bytes).buffer, { status: 200, headers });
    },
  };
}

beforeEach(() => {
  FixedLengthStreamStandIn.lengths = [];
  vi.stubGlobal("FixedLengthStream", FixedLengthStreamStandIn);
});
afterEach(() => vi.unstubAllGlobals());

describe("site worker byte ranges (Safari/iOS media playback & <1ms CPU budget)", () => {
  it("answers Safari's two-byte probe with 206 and exactly those bytes", async () => {
    const response = await get({ Range: "bytes=0-1" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-1/64");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0, 1]);
    expect(FixedLengthStreamStandIn.lengths).toEqual([2]);
  });

  it("serves a range that starts and ends inside different chunks", async () => {
    const response = await get({ Range: "bytes=5-20" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 5-20/64");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(BYTES.slice(5, 21)));
  });

  it("serves open-ended and suffix ranges, clamping the end to the file", async () => {
    const open = await get({ Range: "bytes=60-" });
    expect(open.headers.get("content-range")).toBe("bytes 60-63/64");
    expect(Array.from(new Uint8Array(await open.arrayBuffer()))).toEqual([60, 61, 62, 63]);

    const suffix = await get({ Range: "bytes=-3" });
    expect(suffix.headers.get("content-range")).toBe("bytes 61-63/64");
    expect(Array.from(new Uint8Array(await suffix.arrayBuffer()))).toEqual([61, 62, 63]);

    const past = await get({ Range: "bytes=10-999" });
    expect(past.headers.get("content-range")).toBe("bytes 10-63/64");
    expect((await past.arrayBuffer()).byteLength).toBe(54);
  });

  it("keeps the asset's own headers on a partial response", async () => {
    const response = await get({ Range: "bytes=0-1" });
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600, must-revalidate");
    expect(response.headers.get("etag")).toBe(ETAG);
  });

  it("answers an unsatisfiable range with 416 and the full size", async () => {
    const response = await get({ Range: "bytes=64-" });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */64");
    expect(response.headers.get("content-length")).toBeNull();
    expect(await response.text()).toBe("");
  });

  it("advertises ranges on a plain GET and returns the whole file", async () => {
    const response = await get({});
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect((await response.arrayBuffer()).byteLength).toBe(64);
  });

  it("falls back to the whole file for range forms it does not serve", async () => {
    for (const range of ["bytes=0-1,4-5", "items=0-1", "bytes=9-3", "bytes=-"]) {
      const response = await get({ Range: range });
      expect(response.status, range).toBe(200);
      expect((await response.arrayBuffer()).byteLength, range).toBe(64);
    }
  });

  it("honours If-Range: a stale validator gets the whole file", async () => {
    const stale = await get({ Range: "bytes=0-1", "If-Range": '"old-etag"' });
    expect(stale.status).toBe(200);
    const fresh = await get({ Range: "bytes=0-1", "If-Range": ETAG });
    expect(fresh.status).toBe(206);
  });

  it("passes through responses it cannot slice", async () => {
    const notModified = await get(
      { Range: "bytes=0-1" },
      envServing(() => new Response(null, { status: 304, headers: { ETag: ETAG } })),
    );
    expect(notModified.status).toBe(304);

    const missing = await get({ Range: "bytes=0-1" }, envServing(() => new Response(null, { status: 404 })));
    expect(missing.status).toBe(404);

    const encoded = await get(
      { Range: "bytes=0-1" },
      envServing(() => {
        const response = assetResponse();
        response.headers.set("Content-Encoding", "br");
        return response;
      }),
    );
    expect(encoded.status).toBe(200);
    expect(encoded.headers.get("accept-ranges")).toBeNull();
  });

  it("ignores Range on HEAD but still advertises it", async () => {
    const response = await worker.fetch(
      new Request(FILM, { method: "HEAD", headers: { Range: "bytes=0-1" } }),
      envServing(() => new Response(null, { status: 200, headers: { ETag: ETAG } })),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
  });

  it("resolves marketing MP4 and WebM sizes from the static manifest with 1 fetch and 0 full-stream counting reads", async () => {
    for (const [url, totalSize, contentType] of [
      [FILM, REAL_FILM_BYTES, "video/mp4"],
      [WEBM, REAL_WEBM_BYTES, "video/webm"],
    ] as const) {
      let fetches = 0;
      let chunksPulled = 0;
      const env: WorkerEnv = {
        ASSETS: {
          fetch: async () => {
            fetches += 1;
            // Mirrors workerd's static asset response: no Content-Length header on a multi-MB chunked stream.
            const body = new ReadableStream<Uint8Array>(
              {
                pull(controller) {
                  chunksPulled += 1;
                  if (chunksPulled > 2) {
                    throw new Error(`Must not scan the whole ${totalSize}-byte stream in JS to count its length`);
                  }
                  controller.enqueue(new Uint8Array([10, 20, 30, 40]));
                },
              },
              { highWaterMark: 0 },
            );
            return new Response(body, {
              status: 200,
              headers: { "Content-Type": contentType, ETag: `"etag-${totalSize}"` },
            });
          },
        },
      };

      const response = await worker.fetch(new Request(url, { headers: { Range: "bytes=0-1" } }), env);
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe(`bytes 0-1/${totalSize}`);
      expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([10, 20]);
      expect(fetches).toBe(1);
      expect(chunksPulled).toBe(1);
    }
  });

  it("bypasses JS slice TransformStream on full-span Range: bytes=0-", async () => {
    let customTransformCount = 0;
    class CountingTransformStream<I, O> extends NativeTransformStream<I, O> {
      constructor(transformer?: Transformer<I, O>, writableStrategy?: QueuingStrategy<I>, readableStrategy?: QueuingStrategy<O>) {
        super(transformer, writableStrategy, readableStrategy);
        if (!(this instanceof FixedLengthStreamStandIn)) customTransformCount += 1;
      }
    }
    vi.stubGlobal("TransformStream", CountingTransformStream);

    const response = await get({ Range: "bytes=0-" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-63/64");
    expect((await response.arrayBuffer()).byteLength).toBe(64);
    expect(customTransformCount).toBe(0);
  });

  it("populates caches.default via waitUntil and serves subsequent Range seeks with 0 ASSETS fetches and 0 JS TransformStreams", async () => {
    const edgeCache = createEdgeCacheStandIn();
    vi.stubGlobal("caches", { default: edgeCache });

    let customTransformCount = 0;
    class CountingTransformStream<I, O> extends NativeTransformStream<I, O> {
      constructor(transformer?: Transformer<I, O>, writableStrategy?: QueuingStrategy<I>, readableStrategy?: QueuingStrategy<O>) {
        super(transformer, writableStrategy, readableStrategy);
        if (!(this instanceof FixedLengthStreamStandIn)) customTransformCount += 1;
      }
    }
    vi.stubGlobal("TransformStream", CountingTransformStream);

    let assetFetches = 0;
    const waitUntilPromises: Promise<unknown>[] = [];
    const ctx = { waitUntil: (promise: Promise<unknown>) => { waitUntilPromises.push(promise); } };
    const env: WorkerEnv = {
      ASSETS: {
        fetch: async () => {
          assetFetches += 1;
          // No Content-Length and max-age=0 from upstream: worker must supply size and cacheable Cache-Control.
          const resp = assetResponse('"edge-etag"', { withContentLength: false, bytes: BYTES });
          resp.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
          resp.headers.set("Content-Length", String(BYTES.length));
          return resp;
        },
      },
    };

    // Cold tail-range probe (moov atom at the end of MP4): populates caches.default and slices in C++ with 0 JS TransformStream.
    const coldTail = await worker.fetch(new Request(FILM, { headers: { Range: "bytes=60-63" } }), env, ctx);
    await Promise.all(waitUntilPromises);
    expect(coldTail.status).toBe(206);
    expect(coldTail.headers.get("content-range")).toBe("bytes 60-63/64");
    expect(Array.from(new Uint8Array(await coldTail.arrayBuffer()))).toEqual([60, 61, 62, 63]);
    expect(assetFetches).toBe(1);
    expect(edgeCache.puts).toBe(1);
    expect(waitUntilPromises.length).toBeGreaterThanOrEqual(1);
    expect(customTransformCount).toBe(0);

    FixedLengthStreamStandIn.lengths = [];

    // Subsequent Range probes, mid-seeks, 416, unsupported multi-range, and HEAD all hit caches.default directly.
    const probe = await worker.fetch(new Request(FILM, { headers: { Range: "bytes=0-1" } }), env, ctx);
    expect(probe.status).toBe(206);
    expect(Array.from(new Uint8Array(await probe.arrayBuffer()))).toEqual([0, 1]);

    const mid = await worker.fetch(new Request(FILM, { headers: { Range: "bytes=12-15" } }), env, ctx);
    expect(mid.status).toBe(206);
    expect(Array.from(new Uint8Array(await mid.arrayBuffer()))).toEqual([12, 13, 14, 15]);

    const outOfBounds = await worker.fetch(new Request(FILM, { headers: { Range: "bytes=64-" } }), env, ctx);
    expect(outOfBounds.status).toBe(416);
    expect(outOfBounds.headers.get("content-range")).toBe("bytes */64");

    const multi = await worker.fetch(new Request(FILM, { headers: { Range: "bytes=0-1,4-5" } }), env, ctx);
    expect(multi.status).toBe(200);
    expect((await multi.arrayBuffer()).byteLength).toBe(64);

    const head = await worker.fetch(new Request(FILM, { method: "HEAD", headers: { Range: "bytes=0-1" } }), env, ctx);
    expect(head.status).toBe(200);
    expect(head.headers.get("accept-ranges")).toBe("bytes");
    expect(await head.text()).toBe("");

    expect(assetFetches).toBe(1);
    expect(FixedLengthStreamStandIn.lengths).toEqual([]);
    expect(customTransformCount).toBe(0);
  });

  it("falls back cleanly to 200 in 1 fetch when an unmapped asset has no Content-Length", async () => {
    let fetches = 0;
    const env: WorkerEnv = {
      ASSETS: {
        fetch: async () => {
          fetches += 1;
          return assetResponse('"unmapped"', { withContentLength: false });
        },
      },
    };
    const response = await worker.fetch(
      new Request("https://nomiaqm.com/assets/unmapped-clip.mp4", { headers: { Range: "bytes=0-1" } }),
      env,
    );
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(64);
    expect(fetches).toBe(1);
  });
});
