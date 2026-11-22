import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 项目目录一律指到临时根：盘上放一份真实形状的记忆文件，看系统提示会不会把它带进去。
const project = vi.hoisted(() => ({ dir: "" }));
vi.mock("electron", () => ({ app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() } }));
vi.mock("../../workspace/workspaceRepository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../workspace/workspaceRepository")>()),
  resolveWorkspaceProjectDir: () => project.dir,
}));

import { NOMI_AGENT_IDENTITY, buildAgentSystemPrompt, buildLanguageRule } from "./agentContext";

const SENTINEL = "SENTINEL_OLD_MEMORY_偏好冷色调";
let memoryFile = "";
let memoryBytes = "";

beforeEach(() => {
  project.dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-agent-prompt-"));
  memoryFile = path.join(project.dir, ".nomi", "memory.json");
  fs.mkdirSync(path.dirname(memoryFile), { recursive: true });
  memoryBytes = JSON.stringify({
    facts: [{ id: "note:old", text: SENTINEL, kind: "preference", origin: "user", sourceSeqs: [], pinned: true, updatedAt: "2026-01-01T00:00:00.000Z" }],
    lastDistilledSeq: 0,
    tombstones: {},
  }, null, 2);
  fs.writeFileSync(memoryFile, memoryBytes, "utf8");
});

afterEach(() => fs.rmSync(project.dir, { recursive: true, force: true }));

// 老调用方可能还会多传一个项目号；系统提示不该因此带上任何项目里的东西。
const compose = buildAgentSystemPrompt as (...args: unknown[]) => string;

describe("Agent 系统提示：只剩语言规则和 Nomi 身份，不带创作者看不见的项目记忆", () => {
  it("盘上有旧记忆文件的项目，系统提示里出现不了那几条记忆", () => {
    expect(compose("p1")).not.toContain(SENTINEL);
  });

  it("语言规则和 Nomi 身份都还在（不是把整个提示清空换来的）", () => {
    const prompt = compose("p1");
    expect(prompt).toContain(buildLanguageRule());
    expect(prompt).toContain(NOMI_AGENT_IDENTITY);
    expect(prompt).toBe([buildLanguageRule(), NOMI_AGENT_IDENTITY].join("\n\n"));
  });

  it("盘上的记忆文件一个字节都没动", () => {
    compose("p1");
    expect(fs.readFileSync(memoryFile, "utf8")).toBe(memoryBytes);
  });
});
