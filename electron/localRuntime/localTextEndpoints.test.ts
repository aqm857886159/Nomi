// 本地文本端点探测 + 能力预检的 R16 端到端单测：起**真 HTTP stub 服务器**模拟本地运行时，
// 覆盖「探到→列表」「未开服务时安静」「能力预检 支持 Agent / 仅对话 / 探不出」全路径。
// 不 mock fetch——用真 node:http server + appFetch 真的发请求，证明 wire 对得上。
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  probeLocalTextEndpoints,
  localTextBaseUrl,
  candidatesFromEnv,
  type LocalTextRuntimeCandidate,
} from "./localTextEndpoints";
import { probeLocalTextCapability } from "./localTextCapabilityProbe";
import { LOCAL_TEXT_VENDOR_SEED, LOCAL_TEXT_VENDOR_KEY } from "./localTextVendorSeed";
import { BUILTIN_VENDOR_SEEDS } from "../catalog/builtinVendorSeeds";

type StubOptions = {
  /** /v1/models 返回的模型 id（缺省一个）。null = /v1/models 返回非列表（模拟 SPA HTML）。 */
  models?: string[] | null;
  /** /v1/chat/completions 是否回 tool_calls（true=支持工具；false=只回文本）。 */
  toolCalls?: boolean;
  /** 收到的 Authorization 头（断言本地无鉴权时不发空 Bearer）。 */
  onAuthHeader?: (value: string | undefined) => void;
};

async function startStub(options: StubOptions): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    options.onAuthHeader?.(req.headers.authorization);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/models") {
      if (options.models === null) return res.end("<!doctype html><html>not a list</html>");
      const list = options.models ?? ["llama3.1"];
      return res.end(JSON.stringify({ object: "list", data: list.map((id) => ({ id, object: "model" })) }));
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      const message = options.toolCalls
        ? { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "report_ready", arguments: '{"ok":true}' } }] }
        : { role: "assistant", content: "hi" };
      return res.end(JSON.stringify({ choices: [{ index: 0, message, finish_reason: options.toolCalls ? "tool_calls" : "stop" }] }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const servers: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

function candidateFor(port: number): LocalTextRuntimeCandidate {
  return { id: "ollama", label: "Ollama", port, homepage: "https://ollama.com/download" };
}

describe("本地文本端点探测（真 HTTP stub）", () => {
  it("探到运行中的端口并拉出模型列表", async () => {
    const stub = await startStub({ models: ["llama3.1", "qwen2.5"] });
    servers.push(stub);
    const result = await probeLocalTextEndpoints({ candidates: [candidateFor(stub.port)] });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      id: "ollama",
      label: "Ollama",
      baseUrl: localTextBaseUrl("127.0.0.1", stub.port),
      models: ["llama3.1", "qwen2.5"],
    });
  });

  it("没开服务时安静返回空 hits（不报错）", async () => {
    // 用一个几乎不可能被占用的端口，且短超时。
    const result = await probeLocalTextEndpoints({
      candidates: [{ id: "ollama", label: "Ollama", port: 59_999, homepage: "x" }],
      timeoutMs: 300,
    });
    expect(result.hits).toEqual([]);
  });

  it("端口在跑但 /v1/models 回的是 HTML（SPA）→ 不算命中", async () => {
    const stub = await startStub({ models: null });
    servers.push(stub);
    const result = await probeLocalTextEndpoints({ candidates: [candidateFor(stub.port)] });
    expect(result.hits).toEqual([]);
  });

  it("探测不带 Authorization 头（本地无鉴权，避免空 Bearer 被拒）", async () => {
    let seen: string | undefined = "unset";
    const stub = await startStub({ models: ["m"], onAuthHeader: (v) => { seen = v; } });
    servers.push(stub);
    await probeLocalTextEndpoints({ candidates: [candidateFor(stub.port)] });
    expect(seen).toBeUndefined();
  });
});

describe("本地模型 vendor 种子（进内置单一清单，默认关、无鉴权）", () => {
  it("LOCAL_TEXT_VENDOR_SEED 注册在 BUILTIN_VENDOR_SEEDS 且形状正确", () => {
    const seed = BUILTIN_VENDOR_SEEDS.find((s) => s.key === LOCAL_TEXT_VENDOR_KEY);
    expect(seed).toBe(LOCAL_TEXT_VENDOR_SEED);
    // 无鉴权本地端点：authType none、默认关（用户显式连才翻 enabled）。
    expect(seed?.authType).toBe("none");
    expect(seed?.enabled).toBe(false);
    // 回环占位 baseUrl（不参与 host 别名，真实端口由卡片探测后写 baseUrlHint）。
    expect(seed?.baseUrl).toBe("local://text");
  });
});

describe("NOMI_LOCAL_TEXT_PROBE_BASE_URLS env 覆盖（走查把探测指向 stub）", () => {
  it("空/非法 → null（回落默认端口扫描）", () => {
    expect(candidatesFromEnv(undefined)).toBeNull();
    expect(candidatesFromEnv("")).toBeNull();
    expect(candidatesFromEnv("not-a-url")).toBeNull();
  });

  it("解析 http baseURL 并保留完整 origin + 补 /v1", () => {
    const parsed = candidatesFromEnv("http://127.0.0.1:59123");
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0].baseUrlOverride).toBe("http://127.0.0.1:59123/v1");
  });

  it("env 覆盖下真的探到 stub（不占用真实端口）", async () => {
    const stub = await startStub({ models: ["env-model"] });
    servers.push(stub);
    vi.stubEnv("NOMI_LOCAL_TEXT_PROBE_BASE_URLS", `http://127.0.0.1:${stub.port}/v1`);
    try {
      const result = await probeLocalTextEndpoints();
      expect(result.hits).toHaveLength(1);
      expect(result.hits[0].models).toEqual(["env-model"]);
    } finally {
      vi.stubEnv("NOMI_LOCAL_TEXT_PROBE_BASE_URLS", undefined);
    }
  });
});

describe("本地文本能力预检（真 HTTP stub）", () => {
  it("模型回 tool_calls → 判定支持 Agent", async () => {
    const stub = await startStub({ models: ["m"], toolCalls: true });
    servers.push(stub);
    const r = await probeLocalTextCapability({ baseUrl: localTextBaseUrl("127.0.0.1", stub.port), modelId: "m" });
    expect(r.verdict).toBe("agent");
  });

  it("模型只回文本 → 判定仅对话", async () => {
    const stub = await startStub({ models: ["m"], toolCalls: false });
    servers.push(stub);
    const r = await probeLocalTextCapability({ baseUrl: localTextBaseUrl("127.0.0.1", stub.port), modelId: "m" });
    expect(r.verdict).toBe("chat-only");
  });

  it("端点跑不通 → 判定探不出（unknown），不假装知道", async () => {
    const r = await probeLocalTextCapability(
      { baseUrl: localTextBaseUrl("127.0.0.1", 59_998), modelId: "m" },
      { timeoutMs: 300 },
    );
    expect(r.verdict).toBe("unknown");
    expect(r.detail).toBeTruthy();
  });

  it("能力预检不带 Authorization 头（本地无鉴权）", async () => {
    let seen: string | undefined = "unset";
    const stub = await startStub({ models: ["m"], toolCalls: true, onAuthHeader: (v) => { seen = v; } });
    servers.push(stub);
    await probeLocalTextCapability({ baseUrl: localTextBaseUrl("127.0.0.1", stub.port), modelId: "m" });
    expect(seen).toBeUndefined();
  });
});
