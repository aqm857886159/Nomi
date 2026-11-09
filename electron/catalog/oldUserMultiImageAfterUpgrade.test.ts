/**
 * 老用户升级后一次出四张，四张都进项目（docs/engineering/direction-checks/2026-11-09-multi-result-landing.md）。
 *
 * 目录用的是 v0.24.1 真实落盘的那份（tests/fixtures/old-user-data/catalogs/v0.24.1-wizard：向导接的 OpenAI 兼容中转，
 * gpt-image-2 / opaque-image-x 两个图片模型都声明了「张数 1–4」）。这份目录不是内置的，升级时 seedBuiltins 不会改写它，
 * 存下来的结果映射原样生效——所以这里证的是「读声明的那一道」本身：张数调到 4、上游回四张，四张都落进项目文件夹。
 * 项目文件格式不变：没有迁移步骤，第一张的结果号和以前一样（任务号），第 k 张加序号。
 *
 * 只走回环：假服务监听随机端口，目录副本里的地址全部改写成它；仓库里的夹具不动，里面的 key 都不是真的。
 * 落盘关口是真的（暂存 → 解码校验 → 原子发布），不桩资产库。
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    app: { getPath: () => String(process.env.NOMI_SETTINGS_DIR), getAppPath: () => process.cwd(), isPackaged: false },
    ipcMain: { on: () => undefined, handle: () => undefined, removeHandler: () => undefined },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    },
  };
});

const FIXTURE = fileURLToPath(new URL("../../tests/fixtures/old-user-data/catalogs/v0.24.1-wizard", import.meta.url));
const SAVED_ORIGIN = "http://127.0.0.1:39017";

/** 合法 PNG（能过落盘解码校验）；每张宽度不同，字节各不相同，不会被内容去重并成一张。 */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.alloc(height * (1 + width * 4)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const opened: Array<{ server: http.Server; root: string }> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const item of opened.splice(0)) {
    await new Promise<void>((resolve) => item.server.close(() => resolve()));
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}

async function openOldDirectory() {
  const posts: Array<{ url: string; n: unknown }> = [];
  let origin = "";
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const url = String(request.url);
      if (request.method === "POST" && url === "/v1/images/generations") {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { n?: unknown };
        posts.push({ url, n: body.n });
        const count = Number(body.n) || 1;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ created: 1, data: Array.from({ length: count }, (_, i) => ({ url: `${origin}/files/out-${i}.png` })) }));
        return;
      }
      const file = url.match(/^\/files\/out-(\d+)\.png$/);
      if (request.method === "GET" && file) {
        response.setHeader("content-type", "image/png");
        response.end(png(256 + Number(file[1]), 256));
        return;
      }
      if (request.method === "POST") posts.push({ url, n: undefined });
      response.statusCode = 404;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-old-user-multi-image-"));
  opened.push({ server, root });
  const settings = path.join(root, "settings");
  fs.cpSync(FIXTURE, settings, { recursive: true });
  for (const file of fs.readdirSync(settings)) if (file.startsWith("expected")) fs.rmSync(path.join(settings, file));
  for (const file of listFiles(settings).filter((name) => name.endsWith(".json"))) {
    const text = fs.readFileSync(file, "utf8");
    if (text.includes(SAVED_ORIGIN)) fs.writeFileSync(file, text.split(SAVED_ORIGIN).join(origin));
  }
  vi.stubEnv("NOMI_SETTINGS_DIR", settings);
  vi.stubEnv("NOMI_TEST_NETWORK_GUARD", "1");
  vi.resetModules();
  const catalog = await import("./catalogStore");
  const runtime = await import("../runtime");
  return { posts, root, catalog, runtime };
}

describe("v0.24.1 向导接的图片模型：升级后张数调到 4，四张都进项目", () => {
  it.each([
    ["gpt-image-2", 4],
    ["opaque-image-x", 4],
    ["gpt-image-2", 1],
  ] as const)("%s · 张数 %i：发一次、成功、项目里多了同样张数的图片文件", async (modelKey, count) => {
    const directory = await openOldDirectory();
    const saved = directory.catalog.readCatalog();
    const vendor = saved.vendors.find((row) => String(row.baseUrlHint).includes("127.0.0.1"))!;
    // 升级后读到的就是 0.24.1 存下的那条声明：不是内置目录，不会被改写。
    expect(saved.mappings.find((row) => row.modelKey === modelKey && row.taskKind === "text_to_image")?.create.response_mapping).toEqual({ image_url: "data[*].url" });
    const projectRoot = path.join(directory.root, "project");
    const project = directory.runtime.createProject({ name: "Old relay images", rootPath: projectRoot });
    const result = await directory.runtime.runTask({
      vendor: vendor.key,
      request: { kind: "text_to_image", prompt: "a blue marble", extras: { projectId: project.id, modelKey, nodeId: "image-node", n: count } },
    } as never, { spendGate: async () => {} } as never) as { id: string; status: string; assets: Array<{ type: string; url: string }> };

    expect(directory.posts, "one paid request, carrying the count the creator chose").toEqual([{ url: "/v1/images/generations", n: count }]);
    expect(result.status).toBe("succeeded");
    expect(result.assets).toHaveLength(count);
    for (const asset of result.assets) {
      expect(asset.type).toBe("image");
      expect(asset.url).toMatch(/^nomi-local:\/\//);
    }
    expect(new Set(result.assets.map((asset) => asset.url)).size, "each image is its own file").toBe(count);
    const landed = listFiles(path.join(projectRoot, "assets")).filter((file) => /\.png$/i.test(file) && !/thumb|preview/i.test(path.basename(file)));
    expect(landed.length, "every image the service returned is inside the project folder").toBeGreaterThanOrEqual(count);
  }, 120_000);
});
