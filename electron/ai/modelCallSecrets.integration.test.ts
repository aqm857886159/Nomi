// 独立验收 V-textmigrate F2（10-21）：网关的自定义鉴权头（vendor.meta.extraHeaders，例如 X-Relay-Token）被上游回显时，
// 不许出现在开发诊断、错误对象、穿过 IPC 的错误标记、错误卡文案里。三条协议逐个跑，主 key 与次级凭据同时存在；
// 回显用原样、JSON 转义（\" \/ \uXXXX）、URL 编码几种写法。走真执行器 → 真 pi-ai → 真 HTTP（本机假上游，零额度）。
import { describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ dev: [] as string[], calls: [] as string[] }));
vi.mock("electron", async () => (await import("../../tests/fixtures/textTasks/textTaskCallerState")).electronMock());
vi.mock("../logging/logger", async (original) => ({
  ...(await original<typeof import("../logging/logger")>()),
  logDevDetail: (_scope: string, detail: string) => { logs.dev.push(detail); },
  logVendorCall: (summary: unknown) => { logs.calls.push(JSON.stringify(summary)); },
}));

import type { Model, Vendor } from "../catalog/types";
import { executeTextTask } from "../textTaskRunner";
import { describeAgentError } from "./agentError";
import { startTextUpstream, reply, type UpstreamProtocol, type UpstreamReply, type UpstreamRequest } from "../../tests/fixtures/textTasks/textUpstream";
import { parseVendorErrorFromMessage } from "../shared/generationFailure";
import { classifyGenerationError } from "../../src/workbench/observability/classifyError";
import { textTaskFailureText } from "../../src/workbench/api/taskApi";

const KEY = "sk-fixture-main-0123456789";
const RELAY = 'gw/"relay+é-fixture-42';

function echoForms(secret: string): string[] {
  const escaped = JSON.stringify(secret).slice(1, -1);
  const ascii = escaped.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return [secret, escaped, escaped.split("/").join("\\/"), ascii, ascii.split("/").join("\\/"), encodeURIComponent(secret)];
}

/** 上游把收到的头值用几种写法写进报文（最坏的中转站）。 */
function echoed(request: UpstreamRequest): string {
  const values = Object.values(request.headers).map(String);
  const ensureAscii = JSON.stringify(values).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).split("/").join("\\/");
  return `rejected raw=${values.join(" ")} url=${values.map(encodeURIComponent).join(" ")} json=${ensureAscii}`;
}

async function failWith(protocol: UpstreamProtocol, answer: (request: UpstreamRequest) => UpstreamReply) {
  logs.dev.length = 0;
  const server = await startTextUpstream(protocol, (request) => answer(request));
  try {
    const vendor = { key: `relay-${protocol}`, baseUrlHint: protocol === "anthropic" ? server.origin : server.baseURL, providerKind: protocol,
      authType: "bearer", meta: { extraHeaders: { "X-Relay-Token": RELAY } } } as unknown as Vendor;
    const model = { modelKey: "fixture-model", vendorKey: vendor.key, kind: "text" } as unknown as Model;
    const error = await executeTextTask({ vendor, model, apiKey: KEY, kind: "chat",
      request: { kind: "chat", prompt: "fixture", extras: { maxRetries: 0 } }, taskId: "fixture" }).then(() => null, (caught: unknown) => caught);
    expect(error, "应当失败").toBeInstanceOf(Error);
    expect(String(server.requests[0]?.headers["x-relay-token"] ?? ""), "上游真的收到了次级凭据").toContain("relay+");
    const wire = describeAgentError(error);
    const shown = [
      (error as Error).message,
      JSON.stringify((error as { structured?: unknown }).structured ?? null),
      wire,
      JSON.stringify(parseVendorErrorFromMessage(wire)),
      JSON.stringify(classifyGenerationError(wire)),
      textTaskFailureText(new Error(wire)),
      logs.dev.join("\n"),
    ].join("\n");
    return shown;
  } finally {
    await server.close();
  }
}

const PROTOCOLS: UpstreamProtocol[] = ["openai-compatible", "openai-responses", "anthropic"];

describe.each(PROTOCOLS)("%s：自定义鉴权头的凭据不进日志、错误、错误卡", (protocol) => {
  it("401 报文回显所有请求头（原样 / JSON 转义 / URL 编码）", async () => {
    const shown = await failWith(protocol, (request) => reply.http(401, { error: { message: echoed(request) } }));
    expect(shown).toContain("rejected");
    for (const secret of [KEY, RELAY]) for (const form of echoForms(secret)) expect(shown, `漏了「${form}」`).not.toContain(form);
  });
});

describe("200 里 SSE 包着的错误回显凭据（没有状态码，原话直接进错误文案）", () => {
  it("openai-compatible", async () => {
    const shown = await failWith("openai-compatible", (request) => reply.sseError(echoed(request)));
    for (const secret of [KEY, RELAY]) for (const form of echoForms(secret)) expect(shown, `漏了「${form}」`).not.toContain(form);
  });
});

// 第 3 轮收敛（协调 10-21）：「按头名猜秘密、按写法枚举变体」是类根因，转 G-redact-owner 另线；本 PR 的判据是「不新增泄漏出口」。
// 本 PR 新增的开发诊断出口（Anthropic 那条以前就没有）不再记任何正文：只记状态码、类别、主机、模型、耗时。
// 用独立验收 F2-A / F2-B 的四种夹具对准这个出口——它们在错误原话里仍可能漏（既有，另线），但开发诊断里一个字都不许有。
describe("开发诊断出口不记正文（F2-A / F2-B 四种夹具）", () => {
  const cases: Array<[string, string, string, (value: string) => string]> = [
    ["SDK_PREFIX", "X-Stainless-Relay-Token", "fixture-stainless-pass-42", (value) => value],
    ["USER_AGENT", "User-Agent", "fixture-agent-pass-42", (value) => value],
    ["LOWER_PERCENT", "X-Relay-Token", "fixture/Pass+Code=42", (value) => encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase())],
    ["UPPER_UNICODE", "X-Relay-Token", "fixture-é-pass-42", (value) => JSON.stringify(value).slice(1, -1).replace(/é/g, "\\u00E9")],
  ];
  it.each(cases)("%s", async (_label, header, secret, echo) => {
    logs.dev.length = 0;
    logs.calls.length = 0;
    const server = await startTextUpstream("anthropic", (request) =>
      reply.http(401, { error: { message: `Access denied: ${echo(String(request.headers[header.toLowerCase()]))}; contact gateway admin` } }));
    try {
      const vendor = { key: "relay-diag", baseUrlHint: server.origin, providerKind: "anthropic", authType: "bearer", meta: { extraHeaders: { [header]: secret } } } as unknown as Vendor;
      const model = { modelKey: "fixture-model", vendorKey: vendor.key, kind: "text" } as unknown as Model;
      await executeTextTask({ vendor, model, apiKey: KEY, kind: "chat", request: { kind: "chat", prompt: "fixture", extras: { maxRetries: 0 } }, taskId: "fixture" }).catch(() => undefined);
      expect(String(server.requests[0]?.headers[header.toLowerCase()] ?? "")).toBe(secret);
      const diagnostics = [...logs.dev, ...logs.calls].join(" | ");
      for (const form of [secret, echo(secret), KEY]) expect(diagnostics, `开发诊断里出现了「${form}」`).not.toContain(form);
      expect(diagnostics).not.toContain("Access denied");
      expect(logs.calls.join(" | ")).toContain("401");
    } finally {
      await server.close();
    }
  });
});
