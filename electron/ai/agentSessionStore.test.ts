import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CoreMessage } from "ai";
import {
  clearAgentSession,
  hasPersistedAgentSession,
  loadAgentSession,
  saveAgentSession,
  setAgentSessionDirResolverForTests,
} from "./agentSessionStore";

const KEY = "nomi:workbench:proj-1";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-agent-session-"));
  // 每个 projectId 一个子目录,模拟项目目录。
  setAgentSessionDirResolverForTests((projectId) => path.join(tmpRoot, projectId));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const sampleMessages: CoreMessage[] = [
  { role: "user", content: "把镜头 1 主角衣服改成 #8B0000 暗红" },
  {
    role: "assistant",
    content: [
      { type: "text", text: "好的,已改写镜头 1 的提示词。" },
      { type: "tool-call", toolCallId: "tc-1", toolName: "set_node_prompt", args: { nodeId: "n1", prompt: "暗红 #8B0000 风衣" } },
    ],
  },
  { role: "tool", content: [{ type: "tool-result", toolCallId: "tc-1", toolName: "set_node_prompt", result: { nodeId: "n1" } }] },
];

describe("agentSessionStore", () => {
  it("round-trips messages (含 tool-call/tool-result 结构与逐字精确值)", () => {
    expect(loadAgentSession(KEY)).toBeNull();
    saveAgentSession(KEY, sampleMessages);
    const loaded = loadAgentSession(KEY);
    expect(loaded).toEqual(sampleMessages);
    // 精度铁律:#8B0000 逐字保留,没被任何摘要管线压成"红色"。
    expect(JSON.stringify(loaded)).toContain("#8B0000");
  });

  it("hasPersistedAgentSession reflects disk presence", () => {
    expect(hasPersistedAgentSession(KEY)).toBe(false);
    saveAgentSession(KEY, sampleMessages);
    expect(hasPersistedAgentSession(KEY)).toBe(true);
    clearAgentSession(KEY);
    expect(hasPersistedAgentSession(KEY)).toBe(false);
    expect(loadAgentSession(KEY)).toBeNull();
  });

  it("returns null when the persisted file's sessionKey does not match", () => {
    saveAgentSession(KEY, sampleMessages);
    // 手动篡改文件里的 sessionKey → 读回应判失配返回 null(防串桶)。
    const file = path.join(tmpRoot, "proj-1", ".nomi", "agent-session.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    raw.sessionKey = "nomi:workbench:other";
    fs.writeFileSync(file, JSON.stringify(raw), "utf8");
    expect(loadAgentSession(KEY)).toBeNull();
  });

  it("ignores corrupt json (损坏即弃,不抛)", () => {
    saveAgentSession(KEY, sampleMessages);
    const file = path.join(tmpRoot, "proj-1", ".nomi", "agent-session.json");
    fs.writeFileSync(file, "{not valid json", "utf8");
    expect(loadAgentSession(KEY)).toBeNull();
  });

  it("returns null for an unparseable sessionKey (无 projectId)", () => {
    expect(loadAgentSession("bogus-key")).toBeNull();
    expect(hasPersistedAgentSession("bogus-key")).toBe(false);
    // 不应抛
    saveAgentSession("bogus-key", sampleMessages);
  });

  it("writes atomically via a temp file then rename (无残留 .tmp)", () => {
    saveAgentSession(KEY, sampleMessages);
    const dir = path.join(tmpRoot, "proj-1", ".nomi");
    expect(fs.readdirSync(dir)).toEqual(["agent-session.json"]);
  });
});
