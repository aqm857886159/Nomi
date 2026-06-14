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

  it("单段全损(解析为空但含 seq)时按 raw 高水位恢复,不重号", () => {
    // 模拟:唯一段 log-0.jsonl 的行全部 JSON 损坏(parseLines 得空),但文本里仍含 "seq":5。
    // 旧逻辑 segments.length===1 → seq 回退 0 → 下一条 append 得 seq 1,与历史重号。
    const eventsDir = path.join(tmpRoot, "p1", ".nomi", "events");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(path.join(eventsDir, "log-0.jsonl"), '{"seq":3,"type":"x"\n{"seq":5,"type":"y","broken\n');
    resetEventLogStateForTests();
    const appended = appendEvents("p1", [evt("agent.turn.started")]);
    expect(appended[0].seq).toBe(6); // 5(高水位)+1,绝不回到 1
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

  // 回归(cdc433c 起 sessionKey 带 :area 后缀): 贪婪正则曾把 `proj:creation` 整体当 projectId,
  // 导致 trace 管线所有 agent.* 事件静默丢盘(I1/I2 破)。这里钉死「带 area 后缀必须剥离」。
  it("剥离 :creation / :generation area 后缀", () => {
    expect(projectIdFromSessionKey("nomi:workbench:proj-42:creation")).toBe("proj-42");
    expect(projectIdFromSessionKey("nomi:workbench:proj-42:generation")).toBe("proj-42");
    expect(projectIdFromSessionKey("nomi:workbench:local:creation")).toBeNull();
    expect(projectIdFromSessionKey("nomi:workbench:local:generation")).toBeNull();
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

  // 黑名单→对 query 鉴权参数补白名单:?key= / &token= 等的值,无论是否 URL 编码都脱敏
  // (此前只盖对象字段名 + sk-/Bearer 值,query 形态密钥漏网)。
  it("脱敏 URL query 里的鉴权参数值(含编码)", () => {
    const out = redactDeep(
      { url: "https://api.x.com/v1/gen?model=foo&key=secretKEY123&token=AbC%2Bd123", note: "ok" },
      [],
    );
    const s = JSON.stringify(out);
    expect(s).not.toContain("secretKEY123");
    expect(s).not.toContain("AbC%2Bd123");
    expect(s).toContain("model=foo"); // 非鉴权参数保留
    expect(s).toContain("ok");
  });
});
