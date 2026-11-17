// 落盘出口 × 上游原话（G-redact-owner 第 1 步，独立验收 V-textmigrate N3 / F2-A / F2-B）。
//
// 不变量：上游说的话（连同它回显的凭据，不论原样还是任何编码形态）**不落盘**——
//   · 项目事件 `<项目>/.nomi/events/log-*.jsonl`；
//   · 主进程日志文件（随诊断包 / 反馈包出机）；
//   · Agent 派生轨迹（`.nomi/agent-sessions/<id>.trace/`）。
// 落盘只留结构事实：类别、HTTP 状态、上游自己的码、类名、错误码、栈帧。
//
// 夹具全部是合成值，经本机假上游真实 HTTP 回显（零额度、不出网）；凭据在请求里是真头值，
// 上游按 F2-A（被当成公开头的头名）/ F2-B（小写 %xx、大写 \u）回显。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Entry } from "@earendil-works/pi-agent-core";
import { executeTextTask } from "../textTaskRunner";
import { runTaskIpcGuard } from "../tasks/taskIpcGuard";
import { appendEvents, readEvents, resetEventLogStateForTests, setEventLogProjectDirResolverForTests } from "../events/eventLogRepository";
import { traceVendorCompleted } from "../events/vendorCallTrace";
import { logError, logWarn } from "./logger";
import { dailyLogFileName } from "./logFiles";
import { VendorRequestError, type VendorErrorCategory } from "../vendor/vendorHttp";
import type { VendorFailureCategory } from "./diskSafeFailure";

// 类别表两份必须相等（diskSafeFailure 不 import vendorHttp 的理由见其文件头）：漂了这里 tsc 红。
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const categoriesMatch: Same<VendorFailureCategory, VendorErrorCategory> = true;
void categoriesMatch;
import { desktopT } from "../i18n";
import { deriveLaneTrace, LANE_TRACE_NOTE } from "../agentLane/laneTrace.mjs";
import { attachLaneTrace } from "../agentLane/laneTraceRecorder.mjs";
import { startTextUpstream, reply } from "../../tests/fixtures/textTasks/textUpstream";

type Fixture = { label: string; header: string; secret: string; echo: (value: string) => string };

const lowerPercent = (value: string) => encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());
const upperUnicode = (value: string) => JSON.stringify(value).slice(1, -1).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);

const FIXTURES: Fixture[] = [
  { label: "SDK_PREFIX", header: "X-Stainless-Relay-Token", secret: "fixture-stainless-pass-42", echo: (s) => s },
  { label: "USER_AGENT", header: "User-Agent", secret: "fixture-agent-pass-42", echo: (s) => s },
  { label: "LOWER_PERCENT", header: "X-Relay-Token", secret: "fixture/Pass+Code=42", echo: lowerPercent },
  { label: "UPPER_UNICODE", header: "X-Relay-Token", secret: "fixture-é-pass-42", echo: upperUnicode },
];

/** 一个凭据所有能想到的可逆形态——断言时一个都不许出现（不只是原值）。 */
function forms(secret: string): string[] {
  const out = new Set<string>([
    secret,
    encodeURIComponent(secret),
    lowerPercent(secret),
    JSON.stringify(secret).slice(1, -1),
    upperUnicode(secret),
    upperUnicode(secret).replace(/\\u([0-9A-F]{4})/g, (_m, hex: string) => `\\u${hex.toLowerCase()}`),
    Buffer.from(secret, "utf8").toString("base64"),
  ]);
  return [...out];
}
/** 所有夹具共有的核心片段：任何编码都不改变它（字母不被编码），出现即说明原话落了盘。 */
const CORE = /pass[-+%]|Pass/;

let projectsRoot = "";
beforeAll(() => {
  projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "disk-safe-failure-"));
  setEventLogProjectDirResolverForTests((projectId) => path.join(projectsRoot, projectId));
});
afterAll(() => {
  resetEventLogStateForTests();
  fs.rmSync(projectsRoot, { recursive: true, force: true });
});

function eventsOnDisk(projectId: string): string {
  const dir = path.join(projectsRoot, projectId, ".nomi", "events");
  if (!fs.existsSync(dir)) return "";
  return fs.readdirSync(dir, { recursive: true }).map(String)
    .filter((name) => name.endsWith(".jsonl") || name.endsWith(".json"))
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8")).join("\n");
}

function logLines(marker: string): string {
  const file = path.join(app.getPath("logs"), dailyLogFileName(new Date()));
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return text.split("\n").filter((line) => line.includes(marker)).join("\n");
}

function expectNoLeak(text: string, fixture: Fixture): void {
  for (const form of forms(fixture.secret)) expect(text, `${fixture.label}: ${form}`).not.toContain(form);
  expect(text).not.toMatch(CORE);
  // 上游那句人话本身也不落盘（删 > 脱敏）：不是「擦了凭据还留着原话」。
  expect(text).not.toContain("contact gateway admin");
}

async function failOneShot(fixture: Fixture, projectId: string, upstream: "http" | "sse"): Promise<unknown> {
  const server = await startTextUpstream("openai-compatible", (req) => {
    const said = `Access denied: ${fixture.echo(String(req.headers[fixture.header.toLowerCase()]))}; contact gateway admin`;
    return upstream === "http" ? reply.http(401, { error: { message: said, code: "relay_auth_denied" } }) : reply.sseError(said);
  });
  try {
    const vendor = { key: "disk-fixture", baseUrlHint: server.baseURL, providerKind: "openai-compatible", authType: "bearer",
      meta: { extraHeaders: { [fixture.header]: fixture.secret } } } as never;
    const model = { modelKey: "fixture-model", vendorKey: "disk-fixture", kind: "text" } as never;
    const request = { kind: "chat" as const, prompt: "x", extras: { projectId, nodeId: "n1", maxRetries: 0 } };
    let raw: unknown;
    await runTaskIpcGuard({ vendor: "disk-fixture", request }, () =>
      executeTextTask({ vendor, model, apiKey: "sk-disk-fixture-key", kind: "chat", request, taskId: "t" })
        .catch((error: unknown) => { raw = error; throw error; }))
      .catch(() => undefined);
    // 夹具自检：上游真的收到了这个头（否则「没泄漏」是假绿）。
    expect(server.requests[0]?.headers[fixture.header.toLowerCase()]).toBe(fixture.secret);
    return raw;
  } finally {
    await server.close();
  }
}

describe("T4 / M1 / M2：一次性门的失败事件不存上游原话", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.label}：项目事件只留结构事实`, async () => {
      const projectId = `proj-${fixture.label.toLowerCase()}`;
      const raw = await failOneShot(fixture, projectId, "http");
      expect(raw).toBeInstanceOf(VendorRequestError);
      const disk = eventsOnDisk(projectId);
      expectNoLeak(disk, fixture);
      const failed = readEvents(projectId).filter((event) => event.type === "vendor.call.completed");
      expect(failed).toHaveLength(1);
      // 删的是原话，不是证据：类别、状态码、上游自己的码照留。
      expect(failed[0]!.payload.error).toEqual({ vendorKey: "disk-fixture", category: "auth", retryable: false, httpStatus: 401, upstreamCode: "relay_auth_denied" });
    });
  }
});

describe("T6 / M3 / M4 / M5 / A4：日志文件里的错误只留结构事实", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.label}：结构化供应商错误（HTTP 401）`, async () => {
      const raw = await failOneShot(fixture, `proj-log-${fixture.label.toLowerCase()}`, "http");
      const marker = `probe-vendor-${fixture.label}`;
      logError("tasks", marker, raw);
      const line = logLines(marker);
      expect(line).toContain("category=auth");
      expect(line).toContain("http=401");
      expectNoLeak(line, fixture);
    });

    it(`${fixture.label}：SSE 里的上游原话（不是结构化错误）`, async () => {
      const raw = await failOneShot(fixture, `proj-sse-${fixture.label.toLowerCase()}`, "sse");
      expect(raw).toBeInstanceOf(Error);
      const marker = `probe-sse-${fixture.label}`;
      logWarn("tasks", marker, undefined, raw);
      expectNoLeak(logLines(marker), fixture);
    });

    it(`${fixture.label}：调用方把原话拼进一个不带 cause 的新错误（转写失败那条）`, async () => {
      const raw = await failOneShot(fixture, `proj-wrap-${fixture.label.toLowerCase()}`, "http") as VendorRequestError;
      const wrapped = new Error(desktopT("transcribe.httpError", { vendor: "disk-fixture", status: 401, detail: raw.structured.upstreamMsg }));
      const marker = `probe-wrap-${fixture.label}`;
      logError("tasks", marker, wrapped);
      const line = logLines(marker);
      expectNoLeak(line, fixture);
      // 删的是原文，不是证据：类名照留，同一条原文给同一个指纹（能把重复失败归到一起）。
      expect(line).toMatch(/Error msg#[0-9a-f]{8}/);
    });
  }

  it("我们自己的错误码形 message 照留（排障不能变哑）", () => {
    logError("tasks", "probe-own-code", new Error("TASK_PROJECT_MISMATCH"));
    logError("tasks", "probe-own-code-lower", new Error("agent_lane_conversation_missing"));
    expect(logLines("probe-own-code ")).toContain("TASK_PROJECT_MISMATCH");
    expect(logLines("probe-own-code-lower")).toContain("agent_lane_conversation_missing");
  });
});

describe("A3：Agent 派生轨迹只留错误类别", () => {
  const fixture = FIXTURES[0]!;
  const said = `401 Access denied: ${fixture.secret}; contact gateway admin`;
  const usage = { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const entries = [
    { type: "message", id: "u1", parentId: null, timestamp: 1, message: { role: "user", content: "hi", timestamp: 1 } },
    { type: "message", id: "a1", parentId: "u1", timestamp: 2, message: { role: "assistant", content: [], api: "openai-completions", provider: "p", model: "m",
      usage, stopReason: "error", errorMessage: `${said} [nomi-classified: rate limit]`, timestamp: 2 } },
    { type: "message", id: "a2", parentId: "a1", timestamp: 3, message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "generate", arguments: {} }],
      api: "openai-completions", provider: "p", model: "m", usage, stopReason: "toolUse", timestamp: 3 } },
    { type: "message", id: "r1", parentId: "a2", timestamp: 4, message: { role: "toolResult", toolCallId: "c1", toolName: "generate",
      content: [{ type: "text", text: `generation failed: ${said}` }], isError: true, timestamp: 4 } },
    // 旧会话里 Nomi 自己写过的运行记录：error 是整段 JSON 原文。
    { type: "custom", id: "n1", parentId: null, timestamp: 5, customType: LANE_TRACE_NOTE, data: { runId: "r", fromTipId: null, tipId: "r1",
      startedAt: 1, endedAt: 5, status: "failed", pricing: "unpriced", error: JSON.stringify({ message: said }), model: { provider: "p", model: "m" }, tools: [] } },
  ] as unknown as Entry[];

  it("errors 与失败工具摘要里没有原话；类别照留", () => {
    const rows = deriveLaneTrace(entries, "s1");
    expectNoLeak(JSON.stringify(rows), fixture);
    expect(rows[0]!.errors).toEqual(["rate limit", "tool-failed", "run-failed"]);
    expect(rows[0]!.tools[0]!.failed).toBe(true);
  });
});

describe("旧数据：带 upstreamMsg 的旧事件照常读、不崩、原话不再往外传", () => {
  it("读旧日志", () => {
    const projectId = "proj-legacy";
    const dir = path.join(projectsRoot, projectId, ".nomi", "events");
    fs.mkdirSync(dir, { recursive: true });
    const legacy = { v: 1, id: "evt_old", seq: 1, ts: "2026-10-01T00:00:00.000Z", source: "runtime", type: "vendor.call.completed",
      payload: { runId: "old", status: "failed", assetCount: 0,
        error: { vendorKey: "v", method: "POST", url: "http://x/v1?key=abc", httpStatus: 401, upstreamMsg: "Access denied: fixture-stainless-pass-42", category: "auth", retryable: false } } };
    fs.writeFileSync(path.join(dir, "log-0.jsonl"), `${JSON.stringify(legacy)}\n`, "utf8");
    const [event] = readEvents(projectId);
    expect(event!.seq).toBe(1);
    expect(event!.payload.error).toEqual({ vendorKey: "v", category: "auth", retryable: false, httpStatus: 401 });
    // 旧事件之后继续写，seq 照常接上。
    traceVendorCompleted(projectId, { runId: "new", status: "succeeded", assetCount: 1 });
    expect(readEvents(projectId).map((item) => item.seq)).toEqual([1, 2]);
  });
});

describe("事件唯一写者自己的兜底（不靠 trace 层也干净；V-redact N3 mu1 / mu4）", () => {
  const secret = "fixture-writer-pass-42";

  function rawLog(projectId: string): string {
    return eventsOnDisk(projectId);
  }

  it("写入方把完整 structured 原样塞进来：盘上只剩结构事实", () => {
    const projectId = "proj-writer-guard";
    appendEvents(projectId, [{ id: "evt_w1", source: "runtime", type: "vendor.call.completed", payload: {
      runId: "w", status: "failed", assetCount: 0,
      error: { vendorKey: "relay", method: "POST", url: `https://relay.example/v1?key=${secret}`, httpStatus: 401,
        upstreamMsg: `Access denied: ${secret}; contact gateway admin`, category: "auth", retryable: false },
    } }]);
    const disk = rawLog(projectId);
    expect(disk).not.toContain(secret);
    expect(disk).not.toContain("upstreamMsg");
    expect(disk).toContain('"category":"auth"');
  });

  it("认不出类别的对象：只去掉 upstreamMsg 这个键，其余字段照留", () => {
    const projectId = "proj-writer-unknown";
    appendEvents(projectId, [{ id: "evt_w2", source: "runtime", type: "custom.probe", payload: {
      nested: [{ upstreamMsg: `Access denied: ${secret}`, category: "weird", keep: "this-stays" }],
    } }]);
    const disk = rawLog(projectId);
    expect(disk).not.toContain(secret);
    expect(disk).not.toContain("upstreamMsg");
    expect(disk).toContain("this-stays");
    expect(disk).toContain('"category":"weird"');
  });
});

describe("日志道绝不抛（V-redact 条件 2）", () => {
  it("message 被事后改成非字符串：照常写一行", () => {
    const numeric = new Error("x");
    (numeric as unknown as { message: unknown }).message = 42;
    const objectMessage = new Error("y");
    (objectMessage as unknown as { message: unknown }).message = { said: "fixture-object-pass-42" };
    const missing = new Error("z");
    (missing as unknown as { message: unknown }).message = undefined;
    expect(() => logError("tasks", "probe-nonstring-message", numeric)).not.toThrow();
    expect(() => logError("tasks", "probe-object-message", objectMessage)).not.toThrow();
    expect(() => logError("tasks", "probe-undefined-message", missing)).not.toThrow();
    expect(logLines("probe-nonstring-message")).toMatch(/Error msg#[0-9a-f]{8}/);
    expect(logLines("probe-object-message")).not.toContain("fixture-object-pass-42");
    expect(logLines("probe-undefined-message")).toContain("probe-undefined-message Error");
  });

  it("cause 链上读属性就抛的对象、整个错误是 Proxy：照常写一行", () => {
    const hostile = new Proxy({}, { get() { throw new Error("trap"); }, getPrototypeOf() { throw new Error("trap"); } });
    const withHostileCause = Object.assign(new Error("outer"), { cause: hostile });
    expect(() => logError("tasks", "probe-hostile-cause", withHostileCause)).not.toThrow();
    expect(() => logWarn("tasks", "probe-hostile-error", undefined, hostile)).not.toThrow();
    expect(logLines("probe-hostile-cause")).toMatch(/probe-hostile-cause Error msg#/);
    expect(logLines("probe-hostile-error")).toContain("probe-hostile-error UnreadableError");
  });
});

describe("本机错误的纯结构字段照留（协调 10-22 放宽一档）：退出码、signal、数字 errno、cause 链上的码", () => {
  it("子进程 / ffmpeg 形状的错误：exitCode、signal、errno、数字 code 落盘，stderr 原文不落", () => {
    const ffmpeg = Object.assign(new Error("ffmpeg exited 1: fixture-stderr-pass-42 Invalid data found"), { exitCode: 1, signal: "SIGTERM" });
    const spawn = Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT", errno: -4058, syscall: "spawn ffmpeg" });
    const execFile = Object.assign(new Error("Command failed: fixture-cmd-pass-42"), { code: 1, signal: null, killed: false });
    const fetchFailed = new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo ENOTFOUND relay.example"), { code: "ENOTFOUND" }) });
    logError("tasks", "probe-ffmpeg-exit", ffmpeg);
    logError("tasks", "probe-spawn-enoent", spawn);
    logError("tasks", "probe-execfile-code", execFile);
    logError("tasks", "probe-fetch-cause-code", fetchFailed);
    expect(logLines("probe-ffmpeg-exit")).toMatch(/Error msg#[0-9a-f]{8} exitCode=1 signal=SIGTERM/);
    expect(logLines("probe-spawn-enoent")).toMatch(/code=ENOENT errno=-4058/);
    expect(logLines("probe-execfile-code")).toMatch(/Error msg#[0-9a-f]{8} code=1( |$)/);
    expect(logLines("probe-fetch-cause-code")).toMatch(/TypeError msg#[0-9a-f]{8} code=ENOTFOUND/);
    for (const marker of ["probe-ffmpeg-exit", "probe-execfile-code", "probe-fetch-cause-code"]) {
      expect(logLines(marker)).not.toMatch(/pass-42|Invalid data|relay\.example/);
    }
  });
});

describe("A3：Nomi 写进 pi 会话的运行记录不带 pi 的错误对象（V-redact N3 mu13）", () => {
  it("run_end(failed) 的错误原文不进会话条目", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lane-recorder-"));
    try {
      const handlers = new Map<string, (event: Record<string, unknown>) => void>();
      const committed: { customType?: string; data?: unknown }[] = [];
      const harness = { events: { on: (name: string, listener: (event: Record<string, unknown>) => void) => { handlers.set(name, listener); return () => undefined; } } };
      const session = {
        metadata: { path: path.join(dir, "s1.jsonl"), id: "s1" },
        idGenerator: { next: () => `e${committed.length}` },
        findEntries: async () => [],
        mutate: async (work: (mutator: { commit(items: { entry: { customType?: string; data?: unknown } }[]): Promise<void> }, context: unknown) => Promise<void>, context: unknown) =>
          work({ commit: async (items) => { for (const item of items) committed.push(item.entry); } }, context),
      };
      const trace = attachLaneTrace({ harness: harness as never, session: session as never, pricing: "unpriced", secrets: [], model: { provider: "p", model: "m" } });
      handlers.get("run_start")!({ runId: "r1", startedAt: 1 });
      handlers.get("run_end")!({ runId: "r1", fromTipId: null, tipId: null, endedAt: 2, status: "failed",
        error: { message: "401 Access denied: fixture-recorder-pass-42; contact gateway admin" } });
      await trace.flush();
      const note = committed.find((entry) => entry.customType === LANE_TRACE_NOTE);
      expect(note).toBeDefined();
      expect((note!.data as { error: unknown }).error).toBe("run-failed");
      expect(JSON.stringify(committed)).not.toContain("fixture-recorder-pass-42");
      await trace.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
