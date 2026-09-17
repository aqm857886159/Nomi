import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * 安装那一层的**失败路径**测试。
 *
 * 为什么这几条必须有：本地转写新增的整类失败（下到一半、下到别的东西、磁盘满、解包少文件）
 * 在成功路径上一个都看不见，而它们正是用户最可能撞到的那几条——574 MB 的下载在真实网络上
 * 断一次太正常了。每一条都要能说出**是哪一步、为什么**，并且**不许留下半成品**：
 * 装到一半的引擎目录比没装更糟，它会让下一次「已装」判定为真，然后在起进程那一步才炸。
 *
 * 出站被 `tests/setup/networkTransport.ts` 指向 global fetch，所以这里用一个本地 http 服务
 * 当「上游」——测的是我们自己的校验与落盘，不是别人的 CDN。
 */
import { createServer, type Server } from "node:http";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-localstt-install-test-"));
let server: Server;
let origin = "";
/** 由每条用例塞进去：路径 → 要回的字节。 */
const routes = new Map<string, Buffer>();

function zipOf(files: Record<string, Buffer>): Buffer {
  const dir = fs.mkdtempSync(path.join(root, "zip-"));
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), bytes);
  const zipPath = path.join(root, `${crypto.randomUUID().slice(0, 8)}.zip`);
  // 用系统自带的打包器造夹具：解包侧用的也是系统自带的 bsdtar，两边同一套实现才测得准。
  execFileSync("zip", ["-q", "-j", zipPath, ...Object.keys(files).map((name) => path.join(dir, name))]);
  return fs.readFileSync(zipPath);
}

const sha = (bytes: Buffer): string => crypto.createHash("sha256").update(bytes).digest("hex");

beforeEach(async () => {
  process.env.NOMI_SETTINGS_DIR = fs.mkdtempSync(path.join(root, "settings-"));
  routes.clear();
  server = createServer((request, response) => {
    const bytes = routes.get(request.url || "");
    if (!bytes) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(bytes.byteLength) });
    response.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  // **先 resetModules 再注入**：注入写的是模块级状态，重置之后那份状态会被丢掉——
  // 顺序反了就是「设了但没生效」，而它长得和「策略拒绝了」一模一样。
  vi.resetModules();
  // 出站策略默认拒绝回环地址（那正是它该做的）。夹具服务器用**同一个**注入口开精确 origin
  // ——就是实验室夹具用的那个，主进程只在未打包构建上调它。绕开策略另开一条路才是错的。
  const policy = await import("../networkOutboundPolicy");
  policy.setLabTrustedPrivateOrigins([origin]);
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const policy = await import("../networkOutboundPolicy");
  policy.setLabTrustedPrivateOrigins([]);
  vi.restoreAllMocks();
});

/** 造一份「这一平台的引擎」夹具：真的打一个 zip，真的算 sha256，真的挂到本地 http 上。 */
function engineFixture(input: { members: Record<string, Buffer>; executable: string; archiveSha?: string; memberShaOverride?: Record<string, string> }) {
  const archive = zipOf(input.members);
  const url = `/${crypto.randomUUID().slice(0, 8)}.zip`;
  routes.set(url, archive);
  return {
    platformKey: `${process.platform}-${process.arch}`,
    archive: {
      id: "engine-fixture",
      fileName: "engine-fixture.zip",
      downloadUrl: `${origin}${url}`,
      sizeBytes: archive.byteLength,
      sha256: input.archiveSha ?? sha(archive),
      license: "MIT",
      sourcePage: "https://example.invalid/fixture",
    },
    members: Object.entries(input.members).map(([fileName, bytes]) => ({
      fileName,
      sizeBytes: bytes.byteLength,
      sha256: input.memberShaOverride?.[fileName] ?? sha(bytes),
    })),
    executableFileName: input.executable,
    // 夹具按 mac 那条的形状（有 GPU 加速）——这条测试关心的是安装与校验，不是速度。
    gpuAccelerated: true,
  };
}

/**
 * VAD 模型夹具。真清单里那条指向 huggingface.co，测试的出站策略只放行本地夹具服务器——
 * 所以每条用例都要把它换成本地的一份。**不是可选件**：清单文件头④说了 VAD 常开、没有开关，
 * 少了它就该报错而不是悄悄跑一个会在静音上幻听的引擎。
 */
function vadFixture(bytes = Buffer.from("silero"), shaOverride?: string) {
  const url = `/${crypto.randomUUID().slice(0, 8)}-vad.bin`;
  routes.set(url, bytes);
  return {
    id: "fixture-vad",
    fileName: "fixture-vad.bin",
    downloadUrl: `${origin}${url}`,
    sizeBytes: bytes.byteLength,
    sha256: shaOverride ?? sha(bytes),
    license: "MIT",
    sourcePage: "https://example.invalid/fixture",
  };
}

async function loadInstall(engine: ReturnType<typeof engineFixture>, vad: ReturnType<typeof vadFixture> = vadFixture()) {
  vi.doMock("../shared/localSpeech/localSpeechAssets", async () => {
    const actual = await vi.importActual<typeof import("../shared/localSpeech/localSpeechAssets")>("../shared/localSpeech/localSpeechAssets");
    return { ...actual, localSpeechEngineForPlatform: () => engine, LOCAL_SPEECH_ENGINE_PLATFORMS: [engine], LOCAL_SPEECH_VAD_MODEL: vad };
  });
  return import("./localSpeechInstall");
}

const tierOf = (model: { downloadUrl: string; sizeBytes: number; sha256: string; fileName: string; id: string }) => ({
  id: "balanced" as const,
  model: { ...model, license: "MIT", sourcePage: "https://example.invalid/fixture" },
  measuredCer: 0.0586,
  measuredRealtimeFactor: 12.1,
  measuredCpuRealtimeFactor: 1.35,
});

function modelFixture(bytes: Buffer, shaOverride?: string) {
  const url = `/${crypto.randomUUID().slice(0, 8)}.bin`;
  routes.set(url, bytes);
  return tierOf({ id: "fixture-model", fileName: "fixture-model.bin", downloadUrl: `${origin}${url}`, sizeBytes: bytes.byteLength, sha256: shaOverride ?? sha(bytes) });
}

describe("本地转写引擎安装", () => {
  it("装好之后可执行文件在位、带执行位，压缩包不留在缓存里", async () => {
    const engine = engineFixture({ members: { "whisper-server": Buffer.from("#!/bin/sh\nexit 0\n"), "extra.dll": Buffer.from("dll") }, executable: "whisper-server" });
    const install = await loadInstall(engine);
    const model = modelFixture(Buffer.from("weights"));

    const ready = await install.ensureLocalSpeechReady(model);

    expect(fs.existsSync(ready.executablePath)).toBe(true);
    expect(fs.statSync(ready.executablePath).mode & 0o111).toBeGreaterThan(0);
    expect(fs.existsSync(ready.modelPath)).toBe(true);
    expect(fs.existsSync(ready.vadModelPath)).toBe(true);
    expect(install.isLocalSpeechEngineInstalled(engine)).toBe(true);
    const cacheRoot = path.dirname(path.dirname(ready.executablePath));
    expect(fs.readdirSync(cacheRoot)).not.toContain("engine-fixture.zip");
  });

  it("压缩包字节被换过（sha256 对不上）→ 报校验失败，且**不留下半个引擎目录**", async () => {
    const engine = engineFixture({
      members: { "whisper-server": Buffer.from("real") },
      executable: "whisper-server",
      archiveSha: "0".repeat(64),
    });
    const install = await loadInstall(engine);
    const model = modelFixture(Buffer.from("weights"));

    await expect(install.ensureLocalSpeechReady(model)).rejects.toMatchObject({ reason: "checksum-mismatch", retryable: false });
    expect(install.isLocalSpeechEngineInstalled(engine)).toBe(false);
    expect(fs.existsSync(install.localSpeechEngineDir(engine))).toBe(false);
  });

  it("压缩包对但**里面的文件**被换过 → 一样红（包校验通过 ≠ 里面的东西没被换）", async () => {
    const engine = engineFixture({
      members: { "whisper-server": Buffer.from("real") },
      executable: "whisper-server",
      memberShaOverride: { "whisper-server": "1".repeat(64) },
    });
    const install = await loadInstall(engine);
    const model = modelFixture(Buffer.from("weights"));

    await expect(install.ensureLocalSpeechReady(model)).rejects.toMatchObject({ reason: "checksum-mismatch" });
    expect(fs.existsSync(install.localSpeechEngineDir(engine))).toBe(false);
  });

  it("清单里写了的成员包里没有（如 Windows 少一个 MSVC DLL）→ 解包即红，不等到起进程才 0xC0000135", async () => {
    const base = engineFixture({ members: { "whisper-server": Buffer.from("real") }, executable: "whisper-server" });
    const engine = { ...base, members: [...base.members, { fileName: "vcruntime140.dll", sizeBytes: 3, sha256: sha(Buffer.from("dll")) }] };
    const install = await loadInstall(engine);
    const model = modelFixture(Buffer.from("weights"));

    await expect(install.ensureLocalSpeechReady(model)).rejects.toMatchObject({ reason: "extract-failed" });
    expect(fs.existsSync(install.localSpeechEngineDir(engine))).toBe(false);
  });

  it("权重字节被换过 → 校验失败并把文件删掉（不许留一份坏权重让下次「已缓存」为真）", async () => {
    const engine = engineFixture({ members: { "whisper-server": Buffer.from("real") }, executable: "whisper-server" });
    const install = await loadInstall(engine);
    const bytes = Buffer.from("weights");
    const model = modelFixture(bytes, "2".repeat(64));

    await expect(install.ensureLocalSpeechReady(model)).rejects.toMatchObject({ reason: "checksum-mismatch" });
    const cacheRoot = path.join(process.env.NOMI_SETTINGS_DIR!, "model-cache", "local-speech");
    expect(fs.readdirSync(cacheRoot)).not.toContain("fixture-model.bin");
  });

  it("磁盘满是**它自己一档**：文案要指向腾空间，不能混进「网络不好，重试」", async () => {
    const engine = engineFixture({ members: { "whisper-server": Buffer.from("real") }, executable: "whisper-server" });
    const install = await loadInstall(engine);
    const model = modelFixture(Buffer.from("weights"));
    const realOpen = fs.promises.open;
    vi.spyOn(fs.promises, "open").mockImplementation(async (...args: Parameters<typeof realOpen>) => {
      const handle = await realOpen(...args);
      vi.spyOn(handle, "write").mockRejectedValue(Object.assign(new Error("no space left on device"), { code: "ENOSPC" }));
      return handle;
    });

    await expect(install.ensureLocalSpeechReady(model)).rejects.toMatchObject({ reason: "disk-full", retryable: false });
  });

  it("这个平台没有引擎 → 显式 unsupported，不是拿一个空路径去起进程", async () => {
    vi.doMock("../shared/localSpeech/localSpeechAssets", async () => {
      const actual = await vi.importActual<typeof import("../shared/localSpeech/localSpeechAssets")>("../shared/localSpeech/localSpeechAssets");
      return { ...actual, localSpeechEngineForPlatform: () => undefined };
    });
    const install = await import("./localSpeechInstall");
    const model = modelFixture(Buffer.from("weights"));

    await expect(install.ensureLocalSpeechReady(model)).rejects.toMatchObject({ reason: "unsupported-platform" });
  });

  it("VAD 模型字节被换过 → 整条红，不许退化成「没有 VAD 也先跑着」（那会在静音上幻听并吞掉真人讲话）", async () => {
    const engine = engineFixture({ members: { "whisper-server": Buffer.from("real") }, executable: "whisper-server" });
    const install = await loadInstall(engine, vadFixture(Buffer.from("silero"), "0".repeat(64)));
    const model = modelFixture(Buffer.from("weights"));

    await expect(install.ensureLocalSpeechReady(model)).rejects.toMatchObject({ reason: "checksum-mismatch" });
  });

  it("首次下载的分母含 VAD 模型——漏算它，进度条会在最后那几百 KB 上停在 100% 不动", async () => {
    const engine = engineFixture({ members: { "whisper-server": Buffer.from("real") }, executable: "whisper-server" });
    const vad = vadFixture(Buffer.from("silero-bytes"));
    const install = await loadInstall(engine, vad);
    const model = modelFixture(Buffer.from("weights"));

    expect(install.pendingLocalSpeechBytes(model, engine)).toBe(engine.archive.sizeBytes + model.model.sizeBytes + vad.sizeBytes);
  });

  it("已装好的引擎与权重不会被重下（存在即已校验，见下载层第 3 条规矩）", async () => {
    const engine = engineFixture({ members: { "whisper-server": Buffer.from("real") }, executable: "whisper-server" });
    const install = await loadInstall(engine);
    const model = modelFixture(Buffer.from("weights"));
    await install.ensureLocalSpeechReady(model);

    // 把「上游」整个撤掉：真去下就会 404/连接失败，只有完全不下才过得去。
    routes.clear();
    expect(install.pendingLocalSpeechBytes(model, engine)).toBe(0);
    await expect(install.ensureLocalSpeechReady(model)).resolves.toMatchObject({ modelPath: expect.stringContaining("fixture-model.bin") });
  });
});
