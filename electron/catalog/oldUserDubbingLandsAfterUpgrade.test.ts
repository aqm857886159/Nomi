/**
 * 老用户升级后重新生成配音，配音真的存进项目（2026-11-07 配音扣了钱存不进项目，docs/fixes/2026-11-07-tts-save-expected-kind.root-cause.json）。
 *
 * 目录用的是 v0.24.0 真实落盘的那份（tests/fixtures/old-user-data/catalogs/v0.24.0-wizard-audio：向导接的 OpenAI 兼容配音
 * tts-1 / opaque-tts，路由 /v1/audio/speech、response_format mp3），不是手写形状。v0.23.2 – v0.24.1 上，这两个模型发出请求、
 * 收到音频之后在落盘关口被拒（generated_output_expected_kind_required），节点停在失败；升级后用户在同一个节点上点「重新生成」，
 * 走的就是这里这一条：同一份目录、同一个项目、再发一次。
 *
 * 只走回环：假服务监听随机端口，目录副本里的地址全部改写成它；仓库里的夹具不动，里面的 key 都不是真的。
 * 落盘关口是真的（暂存 → 解码校验 → 原子发布），不桩资产库——上一次就是桩掉资产库让这条失败一直绿着。
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
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

const FIXTURE = fileURLToPath(new URL("../../tests/fixtures/old-user-data/catalogs/v0.24.0-wizard-audio", import.meta.url));
const SAVED_ORIGIN = "http://127.0.0.1:39017";
/** 真实的 MP3 字节（能被解码校验通过），不是占位串。 */
const MP3 = fs.readFileSync(fileURLToPath(new URL("../../tests/ux/fixtures/real-narration.mp3", import.meta.url)));

const opened: Array<{ server: http.Server; root: string }> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const item of opened.splice(0)) {
    await new Promise<void>((resolve) => item.server.close(() => resolve()));
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}

async function openOldDirectory() {
  const posts: string[] = [];
  const server = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      if (request.method === "POST") posts.push(String(request.url));
      if (request.method === "POST" && String(request.url) === "/v1/audio/speech") {
        response.setHeader("content-type", "audio/mpeg");
        response.end(MP3);
        return;
      }
      response.statusCode = 404;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-old-user-dubbing-"));
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

describe("v0.24.0 向导接的配音模型：升级后在项目里重新生成，配音存进项目", () => {
  it.each(["tts-1", "opaque-tts"])("%s：发一次、成功、项目里多了一个能播的音频文件", async (modelKey) => {
    const directory = await openOldDirectory();
    const vendor = directory.catalog.readCatalog().vendors.find((row) => String(row.baseUrlHint).includes("127.0.0.1"))!;
    const projectRoot = path.join(directory.root, "project");
    const project = directory.runtime.createProject({ name: "Old dubbing", rootPath: projectRoot });
    const result = await directory.runtime.runTask({
      vendor: vendor.key,
      request: { kind: "text_to_audio", prompt: "a blue marble", extras: { projectId: project.id, modelKey, nodeId: "dub-node" } },
    } as never, { spendGate: async () => {} } as never) as { status: string; assets: Array<{ type: string; url: string }> };

    expect(directory.posts, "the regenerate sends exactly one request").toEqual(["/v1/audio/speech"]);
    expect(result.status).toBe("succeeded");
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({ type: "audio" });
    expect(result.assets[0].url).toMatch(/^nomi-local:\/\//);
    const landed = listFiles(path.join(projectRoot, "assets")).filter((file) => /\.(mp3|mpeg)$/i.test(file));
    expect(landed, "the dubbing file is inside the project folder").toHaveLength(1);
    expect(fs.readFileSync(landed[0]).equals(MP3), "the bytes on disk are the bytes the service sent").toBe(true);
  }, 120_000);
});
