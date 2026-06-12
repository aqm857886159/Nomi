import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { beginTurnTrace, traceChatEvent, traceToolDecision } from "./agentChatTrace";
import {
  readEvents,
  resetEventLogStateForTests,
  setEventLogProjectDirResolverForTests,
  setEventLogSecretsProvider,
} from "./eventLogRepository";

let tmpRoot = "";
const SESSION = "sess-1";
const SESSION_KEY = "nomi:workbench:p1";

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
});
