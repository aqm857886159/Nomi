import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() },
}));

import {
  appendEvents,
  projectIdFromSessionKey,
  readEvents,
  resetEventLogStateForTests,
  setEventLogProjectDirResolverForTests,
  setEventLogSecretsProvider,
} from "./eventLogRepository";
import { redactDeep } from "./redact";

let tmpRoot = "";

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-events-"));
  setEventLogProjectDirResolverForTests((projectId) => (projectId === "missing" ? null : path.join(tmpRoot, projectId)));
  setEventLogSecretsProvider(() => ["sk-test-supersecret-12345"]);
  fs.mkdirSync(path.join(tmpRoot, "p1"), { recursive: true });
});

afterEach(() => {
  resetEventLogStateForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const evt = (type: string, payload: Record<string, unknown> = {}) =>
  ({ id: `evt_${Math.random().toString(36).slice(2)}`, source: "agent" as const, type, payload });

describe("eventLogRepository", () => {
  it("append 统一编号 seq,读回按序", () => {
    appendEvents("p1", [evt("agent.turn.started"), evt("agent.tool.proposed")]);
    appendEvents("p1", [evt("agent.turn.finished")]);
    const events = readEvents("p1");
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events[0].v).toBe(1);
    expect(events[0].ts).toMatch(/^\d{4}-/);
  });

  it("重启(内存态清空)后 seq 从磁盘恢复继续递增", () => {
    appendEvents("p1", [evt("a"), evt("b")]);
    resetEventLogStateForTests();
    setEventLogProjectDirResolverForTests((projectId) => path.join(tmpRoot, projectId));
    appendEvents("p1", [evt("c")]);
    expect(readEvents("p1").map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("撕裂尾行容忍:最后半行损坏不影响读取与续写", () => {
    appendEvents("p1", [evt("a")]);
    const logPath = path.join(tmpRoot, "p1", ".nomi", "events", "log-0.jsonl");
    fs.appendFileSync(logPath, '{"v":1,"seq":2,"type":"torn'); // 模拟崩溃撕裂
    resetEventLogStateForTests();
    setEventLogProjectDirResolverForTests((projectId) => path.join(tmpRoot, projectId));
    expect(readEvents("p1")).toHaveLength(1);
    appendEvents("p1", [evt("b")]);
    expect(readEvents("p1").map((e) => e.seq)).toEqual([1, 2]);
  });

  it("API key 绝不落盘:已知密钥与 sk- 形态全部脱敏(评测安全铁律)", () => {
    appendEvents("p1", [
      evt("agent.tool.proposed", {
        url: "https://api.x.com/v1?key=sk-test-supersecret-12345",
        apiKey: "whatever-value",
        note: "auth sk-abcdefgh12345678 done",
      }),
    ]);
    const raw = fs.readFileSync(path.join(tmpRoot, "p1", ".nomi", "events", "log-0.jsonl"), "utf8");
    expect(raw).not.toContain("sk-test-supersecret-12345");
    expect(raw).not.toContain("whatever-value");
    expect(raw).not.toContain("sk-abcdefgh12345678");
  });

  it("超 4KB 的 payload 字段截断落 sidecar;readEvents 回读还原全文(重放不拿残值)", () => {
    const big = "x".repeat(10_000);
    const bigObject = { node: { id: "n1", prompt: "y".repeat(9_000) } };
    appendEvents("p1", [evt("agent.tool.completed", { resultHead: big, small: "ok" })]);
    appendEvents("p1", [evt("canvas.node.added", bigObject)]);
    // 磁盘上的 JSONL 行是截断形态(防爆炸)
    const raw = fs.readFileSync(path.join(tmpRoot, "p1", ".nomi", "events", "log-0.jsonl"), "utf8");
    expect(raw).toContain('"truncated":true');
    expect(raw.length).toBeLessThan(big.length);
    // readEvents 经 sidecar 还原:字符串原样、对象 JSON.parse 回结构
    const [first, second] = readEvents("p1");
    expect(first.payload.resultHead).toBe(big);
    expect(first.payload.small).toBe("ok");
    expect(second.payload.node).toEqual(bigObject.node);
  });

  it("项目不可解析时静默跳过(旁路绝不打断主流程)", () => {
    expect(appendEvents("missing", [evt("a")])).toEqual([]);
    expect(readEvents("missing")).toEqual([]);
  });

  it("sessionKey 解析 projectId(local 与空返回 null)", () => {
    expect(projectIdFromSessionKey("nomi:workbench:proj-42")).toBe("proj-42");
    expect(projectIdFromSessionKey("nomi:workbench:local")).toBeNull();
    expect(projectIdFromSessionKey(undefined)).toBeNull();
  });
});

describe("redactDeep", () => {
  it("递归清洗嵌套结构与敏感字段名,不改入参", () => {
    const input = { nested: { authorization: "Bearer abc12345678901234", list: ["sk-1234567890abcdef"] } };
    const out = redactDeep(input, []);
    expect(JSON.stringify(out)).not.toContain("abc12345678901234");
    expect(JSON.stringify(out)).not.toContain("sk-1234567890abcdef");
    expect(input.nested.authorization).toContain("abc12345678901234"); // 入参不被修改
  });
});
