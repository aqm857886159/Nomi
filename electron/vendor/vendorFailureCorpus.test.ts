// S4 · 上游错误归一的语料表（设计卡 docs/plan/2026-11-22-gen-chain-s4.md ★9 A 组）。
//
// 每一行都**三扇门各过一遍**：媒体请求（vendorHttp.requestJson）、模型调用（runtimeVendorError.vendorErrorFromRuntimeFacts）、
// 素材上传（localAssetFile.postWithUploadRetry）——只测归一函数会漏掉「某扇门没把响应体交进来」。
// 表本身也要能分辨对错：「什么都不做」（只按状态码，即改前）和「全拦」（4xx 一律当余额）两个替身各跑一遍，必须各有红行。
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VendorRequestError, categorizeVendorFailure, encodeVendorErrorMessage, requestJson } from "./vendorHttp";
import type { VendorErrorCategory } from "../shared/vendorFailure";
import { vendorErrorFromRuntimeFacts } from "../ai/runtimeVendorError";
import { postWithUploadRetry } from "../assets/localAssetFile";
import { decideGenerationFailure } from "../shared/generationFailure";
import { isJsonRecord, pickUpstreamCode, pickUpstreamType } from "../jsonUtils";
import type { Vendor } from "../catalog/types";

const vendor = { key: "kie", authType: "bearer", baseUrlHint: "https://api.kie.ai" } as unknown as Vendor;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 仓库里的真实样本（2026-08-26 agnes 预检，new-api 网关）：第 1 条是模型无权访问，第 2 条是余额不够预扣。 */
const PAID_RECHECK = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../outputs/agnes-gemini-preflight-20260826/paid-recheck.json"), "utf8"),
) as Array<{ http_status: number; error: string }>;

type Row = {
  readonly id: string;
  readonly source: string;
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
  readonly category: VendorErrorCategory;
  readonly retryable: boolean;
};

const CORPUS: readonly Row[] = [
  { id: "1", source: "真实样本 paid-recheck.json 第 2 条：new-api 403 + 顶层 code + 中文两数",
    status: PAID_RECHECK[1]!.http_status, body: JSON.parse(PAID_RECHECK[1]!.error), category: "balance", retryable: false },
  { id: "2", source: "new-api i18n/locales/en.yaml:30 英文两数模板 + relaykit/types/error.go:89",
    status: 403, body: { error: { message: "Not enough quota to pre-consume for this request: ＄0.004000 remaining, ＄0.015000 required", type: "new_api_error", param: "", code: "insufficient_user_quota" } },
    category: "balance", retryable: false },
  { id: "3", source: "one-api relay/controller/helper.go:76 + adaptor/openai/util.go ErrorWrapper（type one_api_error）",
    status: 403, body: { error: { message: "user quota is not enough", type: "one_api_error", code: "insufficient_user_quota" } }, category: "balance", retryable: false },
  { id: "3b", source: "one-api relay/controller/helper.go:91：令牌额度不够预扣",
    status: 403, body: { error: { message: "token quota is not enough", type: "one_api_error", code: "pre_consume_token_quota_failed" } }, category: "balance", retryable: false },
  { id: "4", source: "真实样本 paid-recheck.json 第 1 条：403 team_model_access_denied（不是余额）",
    status: PAID_RECHECK[0]!.http_status, body: JSON.parse(PAID_RECHECK[0]!.error), category: "auth", retryable: false },
  { id: "5", source: "APIMart 402 + code insufficient_user_quota",
    status: 402, body: { error: { message: "insufficient user quota", type: "new_api_error", code: "insufficient_user_quota" } }, category: "balance", retryable: false },
  { id: "6", source: "APIMart 文本接口 402 文档：type payment_required、无 code",
    status: 402, body: { error: { message: "Insufficient balance, please top up your account", type: "payment_required" } }, category: "balance", retryable: false },
  { id: "7", source: "APIMart 上传文档 402：标识在 type（uploads_images.md:198-206）",
    // 只留判定读的 type；文档里那句 message 和界面词典同字，不参与判定，略去
    status: 402, body: { error: { type: "insufficient_user_quota" } }, category: "balance", retryable: false },
  { id: "8", source: "Anthropic 错误表：402 billing_error",
    status: 402, body: { type: "error", error: { type: "billing_error", message: "Your credit balance is too low to access the API." } }, category: "balance", retryable: false },
  { id: "9", source: "方案反例 1：402 空响应体",
    status: 402, body: "", category: "balance", retryable: false },
  { id: "10", source: "方案反例 2：429 rate_limit_error + Retry-After（等待秒数没有读者，记残留）",
    status: 429, headers: { "retry-after": "12" }, body: { type: "error", error: { type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit" } },
    category: "quota", retryable: true },
  { id: "11", source: "OpenAI 429 rate_limit_exceeded",
    status: 429, body: { error: { message: "Rate limit reached for requests", type: "requests", param: null, code: "rate_limit_exceeded" } }, category: "quota", retryable: true },
  { id: "12", source: "方案反例 3：400 invalid_request_error + param size（字段没有读者，记残留）",
    status: 400, body: { error: { message: "Invalid size", type: "invalid_request_error", param: "size", code: null } }, category: "input", retryable: false },
  { id: "13", source: "401",
    status: 401, body: { error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } }, category: "auth", retryable: false },
  { id: "13a", source: "OpenAI 错误码页（2026-11-22）：429 + type insufficient_quota + code credit_balance_exhausted",
    status: 429, body: { error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", param: null, code: "credit_balance_exhausted" } },
    category: "balance", retryable: false },
  { id: "13a-spend", source: "OpenAI 错误码页：429 organization_spend_limit_exceeded（限额，归 balance，协调 h①）",
    status: 429, body: { error: { message: "Organization spend limit exceeded", type: "insufficient_quota", code: "organization_spend_limit_exceeded" } }, category: "balance", retryable: false },
  { id: "13b", source: "OpenAI 错误码页：429 rate_limit_error + code slow_down（真限流）",
    status: 429, body: { error: { message: "Please slow down", type: "rate_limit_error", code: "slow_down" } }, category: "quota", retryable: true },
  { id: "14", source: "new-api 模板，单位是 token 数（logger/logger.go:152-176；数字本刀不解析）",
    status: 403, body: { error: { message: "Not enough quota to pre-consume for this request: 120 remaining, 4096 required", type: "new_api_error", code: "insufficient_user_quota" } },
    category: "balance", retryable: false },
  { id: "billing-hard-limit", source: "OpenAI 旧形状：400 invalid_request_error + code billing_hard_limit_reached",
    status: 400, body: { error: { message: "Billing hard limit has been reached", type: "invalid_request_error", param: null, code: "billing_hard_limit_reached" } },
    category: "balance", retryable: false },
  { id: "max_tokens-4719", source: "openai/openai-python#4719 原话：400 param=max_tokens（上限给大了，是请求错，不重试）",
    status: 400, body: { error: { message: "max_tokens is too large: 59812. This model supports at most 4096 completion tokens, whereas you provided 59812.", type: null, param: "max_tokens", code: null } },
    category: "input", retryable: false },
  { id: "max_tokens-weaviate", source: "Weaviate 社区帖原话：同一句，上限超 1",
    status: 400, body: { error: { message: "max_tokens is too large: 4097. This model supports at most 4096 completion tokens, whereas you provided 4097.", type: "invalid_request_error", param: "max_tokens", code: null } },
    category: "input", retryable: false },
  { id: "anthropic-400-spend", source: "Anthropic 错误表：组织花费上限是 400 invalid_request_error（没有通用字段能分，本刀不改，记残留）",
    status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "You have reached your specified API usage limits." } }, category: "input", retryable: false },
  { id: "5xx-balance-code", source: "中转 500 + 余额码（结构先于状态码）",
    status: 500, body: { error: { message: "账户余额不足，请充值后重试", code: "insufficient_user_quota" } }, category: "balance", retryable: false },
  { id: "5xx", source: "500 无码",
    status: 500, body: { error: { message: "upstream error" } }, category: "server", retryable: true },
];

function wire(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

function response(row: Row): Response {
  return new Response(wire(row.body), { status: row.status, headers: { "content-type": "application/json", ...row.headers } });
}

/** 三扇门：各自拿到同一份响应，交回各自抛的结构化失败。 */
const DOORS: Record<string, (row: Row) => Promise<VendorRequestError>> = {
  "媒体请求 vendorHttp.requestJson": async (row) => {
    vi.stubGlobal("fetch", vi.fn(async () => response(row)));
    return requestJson(vendor, "k", "POST", "https://api.kie.ai/v1/task", {}, {}, { a: 1 }).then(
      () => { throw new Error("expected a failure"); },
      (caught: unknown) => caught as VendorRequestError,
    );
  },
  "模型调用 runtimeVendorError": async (row) =>
    vendorErrorFromRuntimeFacts({ kind: "http", status: row.status, body: wire(row.body), url: "https://relay.example/v1/chat/completions", message: `HTTP ${row.status}` }, "relay")!,
  "素材上传 localAssetFile": async (row) =>
    postWithUploadRetry(async () => response(row), { delayMs: 0 }).then(
      () => { throw new Error("expected a failure"); },
      (caught: unknown) => caught as VendorRequestError,
    ),
};

describe("S4 语料表 · 三扇门同一张归类表", () => {
  for (const [door, run] of Object.entries(DOORS)) {
    for (const row of CORPUS) {
      it(`${door} · #${row.id} ${row.source}`, async () => {
        const failure = await run(row);
        expect(failure).toBeInstanceOf(VendorRequestError);
        expect(failure.structured).toMatchObject({ httpStatus: row.status, category: row.category, retryable: row.retryable });
      });
    }
  }

  it("面板 / 画布那一行跟着结构走：余额码的 403 说余额不足，不说 Key 无效；无权访问的 403 仍是 Key / 权限那一类", async () => {
    for (const row of CORPUS.filter((entry) => entry.status === 403)) {
      const failure = vendorErrorFromRuntimeFacts({ kind: "http", status: row.status, body: wire(row.body), url: "", message: "" }, "relay")!;
      const kind = decideGenerationFailure({ message: encodeVendorErrorMessage(failure), locale: "zh-CN" }).kind;
      if (row.category === "balance") expect(kind, `#${row.id}`).toBe("balance");
      else expect(kind, `#${row.id}`).not.toBe("balance");
    }
  });

  it("#15 老项目里存的纯文字「余额不足」（没有结构）仍是余额不足", () => {
    expect(decideGenerationFailure({ message: "生成失败：余额不足，请充值后重试", locale: "zh-CN" }).kind).toBe("balance");
  });

  it("单独的取码：error.type 读得到，非标识形状（中文 / null / 数字）不收", () => {
    expect(pickUpstreamType({ error: { type: "payment_required" } })).toBe("payment_required");
    expect(pickUpstreamType({ error: { type: null } })).toBe("");
    expect(pickUpstreamType({ error: { type: "账户余额不够" } })).toBe("");
    expect(pickUpstreamType({ type: "error", error: { type: "billing_error" } })).toBe("billing_error");
    expect(pickUpstreamCode({ error: { code: "403" } })).toBe("");
  });
});

describe("S4 语料表能分辨对错（替身各跑一遍，都必须有红行）", () => {
  const fieldsOf = (body: unknown) => {
    const parsed: unknown = typeof body === "string" ? (body ? JSON.parse(body) : null) : body;
    const record = isJsonRecord(parsed) ? parsed : {};
    return { code: pickUpstreamCode(record), type: pickUpstreamType(record) };
  };
  const mismatches = (classify: (row: Row) => { category: VendorErrorCategory; retryable: boolean }) =>
    CORPUS.filter((row) => {
      const got = classify(row);
      return got.category !== row.category || got.retryable !== row.retryable;
    }).map((row) => row.id);

  it("改后的归类：全表一行不红", () => {
    expect(mismatches((row) => categorizeVendorFailure(row.status, undefined, fieldsOf(row.body)))).toEqual([]);
  });

  it("「什么都不做」（只按状态码 = 改前）：一族网关的 403 余额码、OpenAI 429 额度用完、500 + 余额码都红", () => {
    expect(mismatches((row) => categorizeVendorFailure(row.status))).toEqual(
      expect.arrayContaining(["1", "2", "3", "3b", "13a", "13a-spend", "14", "billing-hard-limit", "5xx-balance-code"]),
    );
  });

  it("「全拦」（4xx 一律当余额）：无权访问、限流、请求错、Key 无效都红", () => {
    const blockAll = (row: Row) => (row.status >= 400 && row.status < 500
      ? { category: "balance" as const, retryable: false }
      : categorizeVendorFailure(row.status, undefined, fieldsOf(row.body)));
    expect(mismatches(blockAll)).toEqual(expect.arrayContaining(["4", "10", "11", "12", "13", "13b", "max_tokens-4719", "max_tokens-weaviate"]));
  });
});
