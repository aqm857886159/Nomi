// 自建中转一致性台架 · 视频/配音那两条 wire（docs/plan/2026-09-03-self-hosted-relay-conformance-harness.md）。
//
// 与 relayConformance.integration.test.ts 分文件的原因是**按 kind 拆**（R9 ≤800 行，宁可拆不要削注释）：
// 那边是图像（同步单跳 + multipart 改图），这边是视频（**异步两段**：create → 轮询 → 终态）与配音
// （同步二进制音频）。两边覆盖同一条链的同一批环节，只是 kind 不同：
//   内置草稿 buildOpenAiCompatibleDraft → 真认证探针 verifyAdapterMode → 严格假中转 → 真产物校验。
//
// ★ 为什么这条非补不可：截至本文件写成前，**视频经中转从未真发过一次请求**——不管真的假的。
// 全仓关于「中转视频」的覆盖只有一条声明级断言（i2v 草稿声明了 image_url/single），而视频这条 wire
// 比图像**大**不是小：图像 create 回来即结果，视频 create 只回 task_id，产物要靠轮询到终态才拿得到。
// 「声明对了」和「异步生命周期真能走完」之间隔着整个轮询循环、状态动词归一、产物提取三段。
//
// ★ 严格性同主台架：假中转不配合。但**诚实边界必须写明**——
// 我们手上没有任何真实的视频/音频中转实测（2026-09-03 那次付费实测的中转只挂了 gpt-image-2，
// 图像那四条 REJECTION RULE 才有真机原文可转录）。因此本文件**不编造供应商拒绝规则**：
//   · 图像侧那种「真机回这句话」级别的规则，这里一条都不写——没量过就不假装量过；
//   · 只断言**代码自身保证**的东西：契约里写死的端点/键名、异步生命周期真的走完、
//     产物真的被 ffmpeg 解得开、注入的首帧真的出现在报文里。
// 覆盖率造假比覆盖率不足更贵，这段边界是有意留的，不是没做完。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/nomi-relay-conformance-av", getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
  webContents: { getAllWebContents: () => [] },
}));

import { buildOpenAiCompatibleDraft } from "./builtinOpenAiCompatibleDraft";
import { verifyAdapterMode } from "./verifier";
import { executeProfileOperation } from "../runtime";
import type { Model, Vendor } from "../catalog/types";
import type { AdapterModeDraft } from "./types";

const VENDOR_KEY = "self-hosted-relay";
const VIDEO_MODEL_KEY = "relay-video-1";
const AUDIO_MODEL_KEY = "relay-tts-1";

// 真·可解码媒体夹具（与 certificationMedia.test.ts 同一批，CI 已在跑 ffmpeg 解它们）。
// 认证末段 certifyMediaArtifact 对 video/audio 会**真的调 ffprobe + 解码**，编造的字节过不去——
// 这正是我们要的：产物必须真是视频/音频，不是「200 就算过」。
const FIXTURES = path.join(__dirname, "__fixtures__", "certification-media");
const RESULT_MP4 = fs.readFileSync(path.join(FIXTURES, "valid.mp4"));
const RESULT_WAV = fs.readFileSync(path.join(FIXTURES, "valid.wav"));

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

type RelayHit = {
  method: string;
  path: string;
  jsonBody?: Record<string, unknown>;
  contentType: string;
  byteLength: number;
  status: number;
  rejection?: string;
};

const hits: RelayHit[] = [];
let server: http.Server;
let baseUrl = "";

/** 上传到 loopback「素材中转」的字节（i2v 首帧的必经之路，见下方 ASSET RELAY 说明）。 */
let uploadedReferenceBytes: Buffer | null = null;
/** 每个 task_id 还要再轮询几次才给终态——用它逼出**真的**异步生命周期，而不是 create 即成功。 */
const pollsRemaining = new Map<string, number>();
/** 一个任务在给出终态前必须被轮询到的次数。>0 才算真的走过轮询循环。 */
const POLLS_BEFORE_TERMINAL = 2;

function send(response: http.ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const requestPath = new URL(request.url || "/", "http://relay").pathname;
      const contentType = String(request.headers["content-type"] || "");
      const hit: RelayHit = { method: request.method || "", path: requestPath, contentType, byteLength: body.length, status: 0 };
      hits.push(hit);
      if (body.length > 0 && contentType.includes("application/json")) {
        try {
          hit.jsonBody = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
        } catch {
          hit.jsonBody = undefined;
        }
      }
      const reject = (status: number, message: string, code?: string): void => {
        hit.status = status;
        hit.rejection = message;
        send(response, status, { error: { message, ...(code ? { code } : {}) } });
      };

      // ── 素材中转（ASSET RELAY）：i2v 首帧的必经之路 ────────────────────────────────
      // 生产的 i2v 首帧是 URL-in-JSON，本地字节必须先换成供应商取得到的 URL。默认走的是
      // 线上 Cloudflare Worker（assetRelayRuntimeConfig.ts:1）——台架里必须改指到本机，
      // 否则这条用例会真的联外网上传（发现于探针；无外网的 CI 上会直接失败）。
      // 环境变量在 beforeAll 里设成本机地址，故这里收到的就是那张参考图。
      if (request.method === "POST" && requestPath === "/v1/assets") {
        uploadedReferenceBytes = body;
        hit.status = 200;
        return send(response, 200, { url: `${baseUrl}/assets/first-frame.png` });
      }
      if (request.method === "GET" && requestPath === "/assets/first-frame.png") {
        hit.status = 200;
        response.writeHead(200, { "Content-Type": "image/png" });
        response.end(PNG_MAGIC);
        return;
      }

      // ── 视频 create：异步。只回 task_id + 非终态，产物必须靠轮询拿 ──────────────────
      // 严格点在这里：**create 绝不直接给产物**。真 new-api 的视频口就是这样（transport 注释
      // newapiTransport.ts:7-10 记录的契约）。若哪天有人把视频改成 create 即结果，这条会红。
      if (request.method === "POST" && requestPath === "/v1/video/generations") {
        const model = String(hit.jsonBody?.model ?? "");
        if (!model) return reject(400, "Missing required parameter: 'model'.", "missing_required_parameter");
        if (!String(hit.jsonBody?.prompt ?? "")) {
          return reject(400, "Missing required parameter: 'prompt'.", "missing_required_parameter");
        }
        const taskId = `task-${hits.length}`;
        pollsRemaining.set(taskId, POLLS_BEFORE_TERMINAL);
        hit.status = 200;
        return send(response, 200, { task_id: taskId, status: "processing" });
      }

      // ── 视频轮询：task_id 走路径参数，状态推进到终态才给产物 ────────────────────────
      if (request.method === "GET" && requestPath.startsWith("/v1/video/generations/")) {
        const taskId = requestPath.slice("/v1/video/generations/".length);
        // 严格：路径里必须是 create 发过的那个 task_id。模板没把 providerMeta.task_id 渲染进去
        // （比如 provider_meta_mapping 断了）时，这里会收到未替换的模板串或空段，当场 404。
        if (!pollsRemaining.has(taskId)) {
          return reject(404, `unknown task_id in poll path: ${JSON.stringify(taskId)}`, "task_not_found");
        }
        const left = pollsRemaining.get(taskId) as number;
        if (left > 0) {
          pollsRemaining.set(taskId, left - 1);
          hit.status = 200;
          return send(response, 200, { task_id: taskId, status: "processing" });
        }
        hit.status = 200;
        return send(response, 200, {
          task_id: taskId,
          status: "succeeded",
          data: [{ url: `data:video/mp4;base64,${RESULT_MP4.toString("base64")}` }],
        });
      }

      // ── 配音 TTS：同步，回**二进制音频字节**（不是 JSON） ──────────────────────────
      // 契约见 newapiTransport.ts:263-279：POST /v1/audio/speech，audioResponse=binary。
      if (request.method === "POST" && requestPath === "/v1/audio/speech") {
        if (!String(hit.jsonBody?.input ?? "")) {
          return reject(400, "Missing required parameter: 'input'.", "missing_required_parameter");
        }
        hit.status = 200;
        response.writeHead(200, { "Content-Type": "audio/wav" });
        response.end(RESULT_WAV);
        return;
      }

      hit.status = 404;
      return send(response, 404, { error: { message: `no such endpoint: ${requestPath}` } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // 把素材中转钉到本机（见上方 ASSET RELAY 说明）。不设的话 i2v 会真的往公网传图。
  process.env.NOMI_ASSET_RELAY_URL = `${baseUrl}/v1/assets`;
});

afterAll(async () => {
  delete process.env.NOMI_ASSET_RELAY_URL;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  hits.length = 0;
  pollsRemaining.clear();
  uploadedReferenceBytes = null;
});

function vendor(): Vendor {
  return {
    key: VENDOR_KEY,
    name: "Self-hosted relay",
    baseUrlHint: baseUrl,
    authType: "bearer",
    authHeader: "Authorization",
    providerKind: "openai-compatible",
    enabled: true,
    createdAt: "t",
    updatedAt: "t",
  } as Vendor;
}

function model(kind: "video" | "audio"): Model {
  const modelKey = kind === "video" ? VIDEO_MODEL_KEY : AUDIO_MODEL_KEY;
  return { modelKey, vendorKey: VENDOR_KEY, labelZh: modelKey, kind, enabled: true, createdAt: "t", updatedAt: "t" } as Model;
}

/** 走**真实内置草稿**建模式（用户填 BaseURL 后 service.ts:313 走的就是这条）。 */
function modeOf(kind: "video" | "audio", taskKind: string): AdapterModeDraft {
  const modelKey = kind === "video" ? VIDEO_MODEL_KEY : AUDIO_MODEL_KEY;
  const draft = buildOpenAiCompatibleDraft({
    baseUrl,
    authType: "bearer",
    providerKind: "openai-compatible",
    models: [{ modelKey, labelZh: modelKey, kind }],
  });
  const mode = draft.models[0].modes.find((item) => item.taskKind === taskKind);
  if (!mode) throw new Error(`内置草稿没有产出 ${taskKind} 模式——接入链在建模式这一步就断了`);
  return mode;
}

/** 真认证探针（service.ts:127 的 verify 就是它，未打桩）。轮询间隔压到 1ms 只为跑得快，
 *  轮询**次数**不缩水：仍要真的转够 POLLS_BEFORE_TERMINAL 圈才拿得到产物。 */
function certify(kind: "video" | "audio", mode: AdapterModeDraft) {
  return verifyAdapterMode(
    { vendor: vendor(), model: model(kind), apiKey: "sk-relay-test", mode },
    { pollIntervalMs: 1, maxPolls: 8 },
  );
}

const hitsTo = (predicate: (hit: RelayHit) => boolean) => hits.filter(predicate);
const createVideoHits = () => hitsTo((hit) => hit.method === "POST" && hit.path === "/v1/video/generations");
const pollVideoHits = () => hitsTo((hit) => hit.method === "GET" && hit.path.startsWith("/v1/video/generations/"));

describe("自建中转一致性台架 · 视频（异步两段：create → 轮询 → 终态）", () => {
  it("文生视频：认证通过，且**真的走完了异步生命周期**（create 拿 task_id → 轮询 → 终态产物）", async () => {
    const mode = modeOf("video", "text_to_video");
    // 异步契约的前提：没有 query op 就根本没有轮询这回事，verifier 会当场判「pending 但无 query」。
    expect(mode.query, "视频模式缺 query op —— 异步任务永远停在 pending，用户看到的是永远转圈").toBeTruthy();

    const result = await certify("video", mode);
    expect(result.ok, `文生视频认证失败：${result.ok ? "" : `[${result.stage}] ${result.error}`}`).toBe(true);

    const create = createVideoHits();
    expect(create.length, "认证探针根本没打到 /v1/video/generations —— 视频 create 走错了端点").toBe(1);
    expect(create[0].status, `严格中转拒绝了这次 create：${create[0].rejection}`).toBe(200);
    expect(create[0].jsonBody?.model).toBe(VIDEO_MODEL_KEY);

    // 生命周期真的转过：轮询必须**多于一次**，且最后一次才是终态。若哪天有人把视频改成
    // create 即结果（同步化），或轮询只发一次就当成功，这两条会红。
    const polls = pollVideoHits();
    expect(
      polls.length,
      "轮询没有真的转起来 —— 异步生命周期被短路了（create 直接当成结果，或只轮询一次）",
    ).toBeGreaterThan(POLLS_BEFORE_TERMINAL - 1);
    expect(polls.every((hit) => hit.status === 200), "轮询过程中被中转拒绝（task_id 没进路径？）").toBe(true);
  }, 30_000);

  it("文生视频：终态产物是**真能解码的视频**，不是「200 就算过」", async () => {
    // certifyMediaArtifact 对 video 会真的跑 ffprobe + 解码；证据里的宽高/时长/编码来自那次真解码。
    const result = await certify("video", modeOf("video", "text_to_video"));
    expect(result.ok, `文生视频认证失败：${result.ok ? "" : `[${result.stage}] ${result.error}`}`).toBe(true);
    if (!result.ok) return;
    const evidence = result.mediaEvidence?.[0];
    expect(evidence?.kind, "产物没有被当成视频校验 —— 认证放过了一个不是视频的东西").toBe("video");
    expect(evidence?.contentType).toBe("video/mp4");
    expect(evidence?.metadata?.videoCodec, "产物解不出视频编码 —— 它不是一个真能播的视频").toBeTruthy();
    expect(Number(evidence?.metadata?.durationSeconds), "产物时长为 0 —— 不是一段真视频").toBeGreaterThan(0);
    // task_id 必须是中转发的那个（而不是本地兜底 uuid）：它是用户侧「去中转后台查这单」的唯一线索。
    expect(result.remoteTaskId, "认证没有留住中转发的 task_id —— 出事时用户无从对账").toMatch(/^task-/);
  }, 30_000);

  it("图生视频：注入的首帧**真的出现在发给中转的报文里**，键是 image（不是 image_url）", async () => {
    // ★ 这条是本文件的核心。历史上 i2v 首帧「声明了却到不了 wire」的根因正是这组名字不咬合：
    // body 的键叫 image，值读的参数叫 request.params.image_url（newapiTransport.ts:204-212），
    // 而 taskParams 只产出 image_url。任何一边改名，首帧就静默掉地——用户连了首帧却发出纯文生视频，
    // 界面上一切正常，只有产出不对。所以这里断言的是**值真的到了 body.image**，不是「键存在」。
    const mode = modeOf("video", "image_to_video");
    expect(mode.referenceParam, "i2v 漏声明 referenceParam → 探针拿零参考图去验图生视频通道").toBe("image_url");
    expect(mode.referenceShape).toBe("single");

    const result = await certify("video", mode);
    expect(result.ok, `图生视频认证失败：${result.ok ? "" : `[${result.stage}] ${result.error}`}`).toBe(true);

    const create = createVideoHits();
    expect(create.length, "认证探针根本没打到 /v1/video/generations").toBe(1);
    const sentFirstFrame = create[0].jsonBody?.image;

    // ① 首帧确实进了报文，且就在 image 这个键下（键名咬合）。
    expect(
      typeof sentFirstFrame === "string" && sentFirstFrame.length > 0,
      `i2v 首帧没进报文 body.image —— 用户连了首帧，实际发出去的是纯文生视频。实际 body: ${JSON.stringify(create[0].jsonBody)}`,
    ).toBe(true);

    // ② 行为式断言：那个值必须**就是这次注入的那张图**换来的 URL，不是任意非空串。
    // 本地字节 → 素材中转上传 → 换回 URL，是 i2v 首帧的真实生产路径；断言两端对得上。
    expect(uploadedReferenceBytes, "首帧从未被上传 —— 本地字节根本没进入素材通道").toBeTruthy();
    expect(
      uploadedReferenceBytes?.includes(PNG_MAGIC),
      "上传的首帧不是 PNG 字节（装的多半是 URL 字符串）—— 本地素材读取器被忽略了",
    ).toBe(true);
    expect(sentFirstFrame, "body.image 里不是刚上传那张首帧换来的 URL").toBe(`${baseUrl}/assets/first-frame.png`);
  }, 30_000);

  it("图生视频：与文生视频共用同一条 wire 和同一套轮询（不是各造一份形状）", async () => {
    const t2v = modeOf("video", "text_to_video");
    const i2v = modeOf("video", "image_to_video");
    expect(i2v.create.path, "i2v 走了另一个端点 —— 与 transport 契约（同一条 wire）不符").toBe(t2v.create.path);
    expect(i2v.query?.path, "i2v 没有复用同一条轮询 —— 图生视频会永远停在 pending").toBe(t2v.query?.path);
    // i2v 也必须真的走完异步生命周期，不能因为带了首帧就走另一条同步路径。
    const result = await certify("video", i2v);
    expect(result.ok, `图生视频认证失败：${result.ok ? "" : `[${result.stage}] ${result.error}`}`).toBe(true);
    expect(pollVideoHits().length, "i2v 没有走轮询").toBeGreaterThan(POLLS_BEFORE_TERMINAL - 1);
  }, 30_000);
});

describe("自建中转一致性台架 · 配音 TTS（同步二进制）", () => {
  it("配音：认证通过，打的是 /v1/audio/speech，且带上了模型真名与文本", async () => {
    const mode = modeOf("audio", "text_to_audio");
    // 同步音频这条路的开关就是 audioResponse：缺了它 verifier 会退回「异步 JSON 任务」那条路，
    // 于是拿二进制音频去 JSON.parse，报一个与真实原因毫不相干的错。
    expect(mode.create.audioResponse, "配音模式没声明 audioResponse —— 二进制音频会被当 JSON 解").toBeTruthy();
    expect(mode.query, "配音是同步的，不该有轮询 op").toBeFalsy();

    const result = await certify("audio", mode);
    expect(result.ok, `配音认证失败：${result.ok ? "" : `[${result.stage}] ${result.error}`}`).toBe(true);

    const speech = hitsTo((hit) => hit.method === "POST" && hit.path === "/v1/audio/speech");
    expect(speech.length, "认证探针根本没打到 /v1/audio/speech —— 配音走错了端点").toBe(1);
    expect(speech[0].status, `严格中转拒绝了这次配音：${speech[0].rejection}`).toBe(200);
    expect(speech[0].jsonBody?.model).toBe(AUDIO_MODEL_KEY);
    // input 是 OpenAI /v1/audio/speech 的文本键（不是 prompt）。写错键 = 中转收到空文本。
    expect(
      String(speech[0].jsonBody?.input ?? ""),
      `配音文本没进 body.input —— 实际 body: ${JSON.stringify(speech[0].jsonBody)}`,
    ).not.toBe("");
  }, 30_000);

  it("配音：回来的二进制**真被当音频消费**（解出编码/采样率），不是原样吞下", async () => {
    // 同步音频不经 JSON 解析，字节直接进 certifyMediaArtifact；证据里的 codec/sampleRate
    // 来自真解码。若运行期把音频当 JSON 或当图片处理，这里拿不到 audio 证据。
    const result = await certify("audio", modeOf("audio", "text_to_audio"));
    expect(result.ok, `配音认证失败：${result.ok ? "" : `[${result.stage}] ${result.error}`}`).toBe(true);
    if (!result.ok) return;
    const evidence = result.mediaEvidence?.[0];
    expect(evidence?.kind, "产物没有被当成音频校验").toBe("audio");
    expect(evidence?.metadata?.audioCodec, "产物解不出音频编码 —— 它不是一段真能放的音频").toBeTruthy();
    expect(Number(evidence?.metadata?.sampleRate), "产物没有采样率 —— 不是一段真音频").toBeGreaterThan(0);
    expect(evidence?.byteLength, "产物字节数与中转发的那段音频对不上").toBe(RESULT_WAV.byteLength);
  }, 30_000);
});

describe("自建中转一致性台架 · 视频生成阶段（认证之后的真实用法）", () => {
  it("带首帧的生成请求（非认证路径），首帧同样真的进了 body.image", async () => {
    // 认证只证「通道能通」；这条证「用户真拿它做图生视频时，那张首帧真的发出去了」。
    // 与主台架改图那条同构：走 executeProfileOperation（生产 runtime），不经 verifier。
    const mode = modeOf("video", "image_to_video");
    const firstFrameUrl = `${baseUrl}/assets/first-frame.png`;

    await executeProfileOperation({
      vendor: vendor(),
      model: model("video"),
      apiKey: "sk-relay-test",
      request: {
        kind: "image_to_video",
        prompt: "push in slowly on the blue square",
        extras: { modelKey: VIDEO_MODEL_KEY, referenceImages: [firstFrameUrl], duration: 5 },
      } as never,
      operation: mode.create,
    });

    const create = createVideoHits();
    expect(create.length, "生成请求没打到 /v1/video/generations").toBe(1);
    expect(create[0].status, `严格中转拒绝了这次生成：${create[0].rejection}`).toBe(200);
    // 行为式断言：断言注入的那个首帧**真的出现在渲染后的报文里**，不是断言某个键存在。
    expect(
      create[0].jsonBody?.image,
      `生成时首帧没进 body.image —— 用户以为在做图生视频，实际发的是纯文生视频。实际 body: ${JSON.stringify(create[0].jsonBody)}`,
    ).toBe(firstFrameUrl);
    expect(create[0].jsonBody?.prompt).toContain("push in slowly");
    // duration 是节点上的标量参数，必须原样以数字进 wire（字符串化会被严格端点拒）。
    expect(create[0].jsonBody?.duration).toBe(5);
  }, 30_000);
});

// ── 变体轴（快速/mini 等档位）真的换掉了发出去的 model 串 ───────────────────────────────────
//
// ★ 补这一组的原因（2026-09-03 探针实测的差距）：同一个模型名，内置 kie/apimart 能选 标准/快速/mini，
// 经用户自建中转**一个档都选不到**。根因不在 UI：中转的 op 把 model 写成字面量 `{{model.modelKey}}`，
// 于是变体轴**恒为惰性**——收窄判据 `archetypeVariantAxisIsLive` 读「wire 有没有引用 params.model」，
// 读到没有就（正确地）把整条变体栏藏起来。用户因此永远在跑默认档：每一次生成都更贵、更慢，
// 而且界面上看不出还有别的档可选。这不是「少个控件」，是**每次生成都在多花钱**。
//
// 断言纪律与本文件其余部分一致：**断 wire，不断 UI**。变体轴活没活，唯一算数的证据是
// 「切了档之后，发到中转的那个 model 字符串真的变了」——这正是下面两条在量的东西。
describe("自建中转一致性台架 · 变体轴（切档真的换掉线上的 model 串）", () => {
  /** 发一次生成，回传中转真正收到的 create body。 */
  async function createBodyWith(extras: Record<string, unknown>): Promise<Record<string, unknown>> {
    const mode = modeOf("video", "text_to_video");
    await executeProfileOperation({
      vendor: vendor(),
      model: model("video"),
      apiKey: "sk-relay-test",
      request: { kind: "text_to_video", prompt: "a cat", extras: { modelKey: VIDEO_MODEL_KEY, ...extras } } as never,
      operation: mode.create,
    });
    const create = createVideoHits();
    expect(create.length, "生成请求没打到 /v1/video/generations").toBe(1);
    expect(create[0].status, `严格中转拒绝了这次生成：${create[0].rejection}`).toBe(200);
    return create[0].jsonBody ?? {};
  }

  it("选了变体：发出去的 model **就是那个变体的串**（不是目录行的名字）", async () => {
    // 档案切变体的产物就是 params.model（buildArchetypeInputParams 末尾：变体 > mode.modelEnum）。
    // 这里直接喂那个键 = 模拟「用户在节点上点了『快速』」之后送到 runtime 的东西。
    const body = await createBodyWith({ model: `${VIDEO_MODEL_KEY}-fast` });
    expect(
      body.model,
      `切了变体，发到中转的 model 却不是变体串 —— 变体轴是死的，用户白点。实际 body: ${JSON.stringify(body)}`,
    ).toBe(`${VIDEO_MODEL_KEY}-fast`);
  }, 30_000);

  it("**没有变体**的裸模型：model 仍是目录身份，且该键绝不缺席", async () => {
    // ★ 这条是把 model 参数化的**代价闸**，也是本组最该盯的一条。
    // 模板引擎对整 token 的 undefined 是「整键丢弃」（不是留空串）：只要回落没接上，
    // 没变体的模型就会发出一个**没有 model 字段**的请求 —— 那是每一个裸中转模型 100% 失败，
    // 比原来的「变体选不了」严重得多。所以这里同时断言「键在」与「值对」。
    const body = await createBodyWith({});
    expect(
      Object.prototype.hasOwnProperty.call(body, "model"),
      `裸模型发出的请求里**根本没有 model 字段** —— 参数化把回落丢了，中转必 400。实际 body: ${JSON.stringify(body)}`,
    ).toBe(true);
    expect(body.model, `裸模型的 model 串不等于目录身份 —— 换写法改变了线上字节。实际 body: ${JSON.stringify(body)}`)
      .toBe(VIDEO_MODEL_KEY);
  }, 30_000);

  // ── 参数是否真的到得了 wire（同一组 createBodyWith，故并在本 describe 里）─────────────────
  //
  // 判据与 paramConsistency / 变体轴收窄同源（wireReferencedParamKeys）：档案声明的参数要么被
  // body 引用、要么被 paramMap 翻译、要么**显式** drop。逐参数查下来，通用中转视频这条 wire 上
  // seed 与 negative_prompt 属于「文档明写支持、我们却没给位置」——即静默丢弃，本轮补上。
  it("种子与负向词**真的进了报文**（文档明写的字段，此前静默丢弃）", async () => {
    // R5 依据：doc.newapi.pro/api/kling-jimeng/（2026-09-03）——seed 是顶层可选 integer；
    // negative_prompt 是 metadata 袋的官方示例字段。
    const body = await createBodyWith({ seed: 20231234, negative_prompt: "模糊" });
    expect(body.seed, `种子没进 wire —— 用户填了种子却拿不到可复现的结果。实际 body: ${JSON.stringify(body)}`)
      .toBe(20231234);
    // 数字必须原样是 number（字符串化会被严格端点拒，与 duration 同理）。
    expect(typeof body.seed).toBe("number");
    expect(
      body.metadata,
      `负向词没进 metadata.negative_prompt —— 用户写的负向词完全不生效且毫无迹象。实际 body: ${JSON.stringify(body)}`,
    ).toEqual({ negative_prompt: "模糊" });
  }, 30_000);

  it("什么都没填时，**绝不**多发空的 seed / metadata 字段", async () => {
    // ★ 这条守的是「加字段的代价」：模板层丢得掉 undefined 的键，却丢不掉因此变空的父对象——
    // 逐键写 metadata 时实测会发出 `"metadata":{}`。空对象/空字段进严格端点是白白的拒绝风险，
    // 而且这类回归本地看不出来（假中转不校验），只有把它钉成断言才拦得住。
    const body = await createBodyWith({});
    expect(
      Object.prototype.hasOwnProperty.call(body, "metadata"),
      `没填负向词却发出了 metadata —— 空对象凭空进了严格端点。实际 body: ${JSON.stringify(body)}`,
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(body, "seed"),
      `没填种子却发出了 seed 字段。实际 body: ${JSON.stringify(body)}`,
    ).toBe(false);
  }, 30_000);
});
