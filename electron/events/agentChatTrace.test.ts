import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() },
}));

import { beginTurnTrace, traceChatEvent, traceGateDenied, traceToolDecision } from "./agentChatTrace";
import {
  readEvents,
  resetEventLogStateForTests,
  setEventLogProjectDirResolverForTests,
  setEventLogSecretsProvider,
} from "./eventLogRepository";

let tmpRoot = "";
const SESSION = "sess-1";
// 用渲染层真实格式(带 :area 后缀,cdc433c 起)——曾用无后缀的 `nomi:workbench:p1` 掩盖了 trace 全丢的回归。
const SESSION_KEY = "nomi:workbench:p1:generation";

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-trace-"));
  setEventLogProjectDirResolverForTests((projectId) => path.join(tmpRoot, projectId));
  setEventLogSecretsProvider(() => []);
  fs.mkdirSync(path.join(tmpRoot, "p1"), { recursive: true });
});

afterEach(() => {
  resetEventLogStateForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("agentChatTrace — S6-0 对账的米", () => {
  it("approved 携 effectiveArgs/overridesDelta,causeId 回指 proposed", () => {
    beginTurnTrace(SESSION, { sessionKey: SESSION_KEY, skillKey: "canvas", prompt: "拆镜头" });
    traceChatEvent(SESSION, {
      type: "tool-call",
      toolCallId: "tc-1",
      toolName: "set_node_prompt",
      args: { nodeId: "n1", prompt: "AI 原始提议" },
    });
    traceToolDecision(SESSION, "tc-1", {
      ok: true,
      effectiveArgs: { nodeId: "n1", prompt: "用户改后的提示词" },
      overridesDelta: { prompt: "用户改后的提示词" },
      proposalId: "prop_abc123",
    });

    const events = readEvents("p1");
    const proposed = events.find((e) => e.type === "agent.tool.proposed");
    const approved = events.find((e) => e.type === "agent.proposal.approved");
    expect(proposed).toBeTruthy();
    expect(approved).toBeTruthy();
    // 因果链:approved 回指 proposed 事件 id。
    expect(approved!.causeId).toBe(proposed!.id);
    // 对账的米:合并后全量快照落盘。
    expect(approved!.payload.effectiveArgs).toEqual({ nodeId: "n1", prompt: "用户改后的提示词" });
    // 偏好增量:只记用户实际改动的字段。
    expect(approved!.payload.overridesDelta).toEqual({ prompt: "用户改后的提示词" });
    // S6-2:proposalId/txnId 落事件级字段(与画布事件/txn.committed 同键 join)。
    expect(approved!.proposalId).toBe("prop_abc123");
    expect(approved!.txnId).toBe("txn_prop_abc123");
  });

  it("无 override 时不写空 overridesDelta(空对象不进日志)", () => {
    beginTurnTrace(SESSION, { sessionKey: SESSION_KEY, skillKey: "canvas", prompt: "建节点" });
    traceChatEvent(SESSION, { type: "tool-call", toolCallId: "tc-2", toolName: "create_canvas_nodes", args: { nodes: [] } });
    traceToolDecision(SESSION, "tc-2", { ok: true, effectiveArgs: { nodes: [] } });

    const approved = readEvents("p1").find((e) => e.type === "agent.proposal.approved");
    expect(approved!.payload.effectiveArgs).toEqual({ nodes: [] });
    expect("overridesDelta" in approved!.payload).toBe(false);
  });

  it("rejected 只记 message,不混入对账字段", () => {
    beginTurnTrace(SESSION, { sessionKey: SESSION_KEY, skillKey: "canvas", prompt: "删节点" });
    traceChatEvent(SESSION, { type: "tool-call", toolCallId: "tc-3", toolName: "delete_canvas_nodes", args: { nodeIds: ["n9"] } });
    traceToolDecision(SESSION, "tc-3", { ok: false, message: "用户拒绝" });

    const rejected = readEvents("p1").find((e) => e.type === "agent.proposal.rejected");
    expect(rejected!.payload.message).toBe("用户拒绝");
    expect("effectiveArgs" in rejected!.payload).toBe(false);
  });

  it("S6-1 gate.denied:reason 人话落盘,causeId 回指 proposed(intent 可反走还原)", () => {
    beginTurnTrace(SESSION, { sessionKey: SESSION_KEY, skillKey: "canvas", prompt: "动作" });
    traceChatEvent(SESSION, { type: "tool-call", toolCallId: "tc-4", toolName: "rm_rf", args: {} });
    traceGateDenied(SESSION, "tc-4", "不支持的操作「rm_rf」");

    const events = readEvents("p1");
    const proposed = events.find((e) => e.type === "agent.tool.proposed");
    const denied = events.find((e) => e.type === "agent.gate.denied");
    expect(denied!.source).toBe("system");
    expect(denied!.payload.reason).toBe("不支持的操作「rm_rf」");
    expect(denied!.causeId).toBe(proposed!.id);
    // gate.denied 不是 proposal.rejected(两类语义分开)。
    expect(events.some((e) => e.type === "agent.proposal.rejected")).toBe(false);
  });
});
