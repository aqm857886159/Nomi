// 「结果收得住」这半边的契约钉子（2026-08-12）。
//
// 背景：此前自定义调用只认资产 URL，且文本模型被 runtime 直接挡在门外（wantedKind !== "text"）——
// 等于「接不上的文本模型没有任何出路」，而用户最初踩的正是文本模型。
// 这里锁两件事：① 文本产出必须显式、不能和资产 URL 抢形状；② saveFile 没注入时要报人话。
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { VendorRequestError } from "../vendor/vendorHttp";
import { collectCustomCallAssets, collectCustomCallText, CustomCallScriptError, runCustomCallScript } from "./customCallRunner";

describe("collectCustomCallText", () => {
  it("accepts the shapes an AI would plausibly emit for text", () => {
    expect(collectCustomCallText({ text: "你好" })).toBe("你好");
    expect(collectCustomCallText({ content: "hi" })).toBe("hi");
    expect(collectCustomCallText({ output_text: "yo" })).toBe("yo");
  });

  // **关键不变量**：裸字符串是资产 URL 的既有约定。若文本也认裸字符串，
  // 图片脚本 `return 'https://…png'` 就会被当成正文渲染出来。两者绝不能抢同一形状。
  it("never treats a bare string as text — that shape belongs to asset URLs", () => {
    expect(collectCustomCallText("https://cdn.example.com/a.png")).toBeUndefined();
    expect(collectCustomCallText("just some words")).toBeUndefined();
    // 反向确认：同一个值走资产通道是认的。
    expect(collectCustomCallAssets("https://cdn.example.com/a.png")).toEqual(["https://cdn.example.com/a.png"]);
  });

  it("ignores empty or non-string text fields instead of returning junk", () => {
    expect(collectCustomCallText({ text: "" })).toBeUndefined();
    expect(collectCustomCallText({ text: "   " })).toBeUndefined();
    expect(collectCustomCallText({ text: 42 })).toBeUndefined();
    expect(collectCustomCallText(null)).toBeUndefined();
    expect(collectCustomCallText(["a"])).toBeUndefined();
  });

  // 资产形状不该被误判成文本：{url} 里没有 text/content，必须落空。
  it("does not mistake an asset object for text", () => {
    expect(collectCustomCallText({ url: "https://cdn.example.com/a.mp4" })).toBeUndefined();
    expect(collectCustomCallText({ b64_json: "AAA" })).toBeUndefined();
  });

  it("lets a test run preview a small saveFile result without writing project assets", async () => {
    const outcome = await runCustomCallScript({
      vendor: { key: "custom", baseUrlHint: "https://example.com" } as never,
      model: { modelKey: "m", kind: "video" } as never,
      apiKey: "",
      prompt: "p",
      params: {},
      taskKind: "text_to_video",
      script: "return await saveFile(new Uint8Array([1, 2, 3]), '.mp4', 'video/mp4')",
      saveFile: async (bytes, _ext, contentType) => `data:${contentType};base64,${bytes.toString('base64')}`,
    });
    expect(outcome.assets).toEqual(["data:video/mp4;base64,AQID"]);
  });
});

describe("customCall binary HTTP response → saveFile byte fidelity", () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  });

  // Deliberately includes non-UTF-8 bytes (0x80, 0xff, 0xfe), NUL (0x00), and valid 2-byte UTF-8 (0xde 0xad)
  // that UTF-8 decoding previously destroyed into U+FFFD or collapsed byte length.
  const NON_UTF8_MP4 = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x6d, 0x70, 0x34, 0x32, 0x80, 0xff, 0xfe, 0x00,
    0xde, 0xad, 0xbe, 0xef, 0xc3, 0x28, 0xa0, 0xa1,
  ]);

  async function startBinaryFixtureServer(): Promise<{ baseUrl: string; uploadedMultipartBody: () => Buffer }> {
    let lastUpload = Buffer.alloc(0);
    const server = http.createServer((req, res) => {
      if (req.url === "/json-task") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ id: "task-bin-1", download: "/video-mp4" }));
        return;
      }
      if (req.url === "/video-mp4") {
        res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": String(NON_UTF8_MP4.length) });
        res.end(NON_UTF8_MP4);
        return;
      }
      if (req.url === "/octet-multipart" && req.method === "POST") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          lastUpload = Buffer.concat(chunks);
          res.writeHead(200, { "Content-Type": "application/octet-stream" });
          res.end(NON_UTF8_MP4);
        });
        return;
      }
      if (req.url === "/logical-error") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: 401, message: "invalid api key" }));
        return;
      }
      res.writeHead(404).end();
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as { port: number };
    return { baseUrl: `http://127.0.0.1:${port}`, uploadedMultipartBody: () => lastUpload };
  }

  it("hands raw Uint8Array bytes to the script for binary Content-Type without UTF-8 corruption while keeping JSON parsing", async () => {
    const { baseUrl } = await startBinaryFixtureServer();
    let savedBytes: Buffer | null = null;
    const outcome = await runCustomCallScript({
      vendor: { key: "custom-bin", name: "Bin", baseUrlHint: baseUrl, authType: "bearer", enabled: true } as never,
      model: { vendorKey: "custom-bin", modelKey: "m1", kind: "video", enabled: true } as never,
      apiKey: "sk-test-bin",
      prompt: "pan",
      params: {},
      taskKind: "text_to_video",
      script: `
const task = await http.post('/json-task', { prompt });
if (task.id !== 'task-bin-1') throw new Error('expected parsed JSON object, got ' + typeof task);
const bytes = await http.get(task.download);
if (!(bytes instanceof Uint8Array)) throw new Error('expected Uint8Array, got ' + typeof bytes);
return await saveFile(bytes, 'mp4', 'video/mp4');
`,
      saveFile: async (bytes, ext, contentType) => {
        savedBytes = Buffer.from(bytes);
        return `nomi-local://project/assets/out.${ext}?ct=${encodeURIComponent(contentType)}`;
      },
    });

    expect(outcome.assets).toEqual(["nomi-local://project/assets/out.mp4?ct=video%2Fmp4"]);
    expect(savedBytes).not.toBeNull();
    expect(Buffer.compare(savedBytes!, NON_UTF8_MP4)).toBe(0);
    expect(outcome.transcript[1]?.responsePreview).not.toContain("\ufffd");
  });

  it("preserves raw binary bytes on FormData multipart upload responses and still catches JSON logical errors", async () => {
    const { baseUrl, uploadedMultipartBody } = await startBinaryFixtureServer();
    let savedBytes: Buffer | null = null;
    await runCustomCallScript({
      vendor: { key: "custom-bin", name: "Bin", baseUrlHint: baseUrl, authType: "bearer", enabled: true } as never,
      model: { vendorKey: "custom-bin", modelKey: "m1", kind: "video", enabled: true } as never,
      apiKey: "sk-test-bin",
      prompt: "edit",
      params: {},
      taskKind: "image_to_video",
      script: `
const fd = new FormData();
fd.append('prompt', prompt);
fd.append('file', new Uint8Array([0x80, 0xff, 0x00]), 'frame.bin');
const bytes = await request({ method: 'POST', url: '/octet-multipart', body: fd });
return await saveFile(bytes, 'mp4', 'video/mp4');
`,
      saveFile: async (bytes) => {
        savedBytes = Buffer.from(bytes);
        return "nomi-local://project/assets/form-out.mp4";
      },
    });
    expect(uploadedMultipartBody().length).toBeGreaterThan(0);
    expect(Buffer.compare(savedBytes!, NON_UTF8_MP4)).toBe(0);

    const err = await runCustomCallScript({
      vendor: { key: "custom-bin", name: "Bin", baseUrlHint: baseUrl, authType: "bearer", enabled: true } as never,
      model: { vendorKey: "custom-bin", modelKey: "m1", kind: "video", enabled: true } as never,
      apiKey: "sk-test-bin",
      prompt: "err",
      params: {},
      taskKind: "text_to_video",
      script: "return await http.get('/logical-error')",
    }).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(CustomCallScriptError);
    expect((err as CustomCallScriptError).causeError).toBeInstanceOf(VendorRequestError);
  });
});
