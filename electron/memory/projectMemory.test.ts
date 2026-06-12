import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() },
}));

import {
  appendEvents,
  readEvents,
  resetEventLogStateForTests,
  setEventLogProjectDirResolverForTests,
} from "../events/eventLogRepository";
import {
  getProjectMemory,
  removeMemoryFact,
  setProjectMemoryDirResolverForTests,
  updateMemoryFact,
} from "./projectMemory";

let tmpRoot = "";

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-memory-"));
  const resolver = (projectId: string) => path.join(tmpRoot, projectId);
  setEventLogProjectDirResolverForTests(resolver);
  setProjectMemoryDirResolverForTests(resolver);
  fs.mkdirSync(path.join(tmpRoot, "p1"), { recursive: true });
});

afterEach(() => {
  resetEventLogStateForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const evt = (type: string, payload: Record<string, unknown>, source: "user" | "agent" | "system" = "user") =>
  ({ id: `evt_${Math.random().toString(36).slice(2)}`, source, type, payload });

const characterAdded = (id: string, title: string, prompt: string) =>
  evt("canvas.node.added", { node: { id, kind: "character", title, prompt } })

describe("projectMemory — S9 零 LLM 提炼器", () => {
  it("角色卡 → character 事实;普通镜头节点不进记忆", () => {
    appendEvents("p1", [
      characterAdded("c1", "女主角", "黑色长发,白裙,冷淡眼神"),
      evt("canvas.node.added", { node: { id: "s1", kind: "image", title: "镜头 1", prompt: "x" } }),
    ]);
    const memory = getProjectMemory("p1");
    expect(memory.facts).toHaveLength(1);
    expect(memory.facts[0]).toMatchObject({ id: "node:c1", kind: "character", origin: "auto", pinned: false });
    expect(memory.facts[0].text).toContain("女主角");
    expect(memory.facts[0].text).toContain("黑色长发");
  });

  it("锁卡 → constraint 事实(title 自含);解锁 → 移除", () => {
    appendEvents("p1", [evt("canvas.node.locked", { nodeId: "c1", title: "女主角定妆" })]);
    let memory = getProjectMemory("p1");
    expect(memory.facts.find((fact) => fact.id === "lock:c1")?.kind).toBe("constraint");
    expect(memory.facts[0].text).toContain("女主角定妆");

    appendEvents("p1", [evt("canvas.node.unlocked", { nodeId: "c1", title: "女主角定妆" })]);
    memory = getProjectMemory("p1");
    expect(memory.facts).toHaveLength(0);
  });

  it("overridesDelta → preference 事实(反复命中只更新溯源不重复)", () => {
    appendEvents("p1", [
      evt("agent.proposal.approved", { toolCallId: "t1", overridesDelta: { nodes: [] } }, "user"),
      evt("agent.proposal.approved", { toolCallId: "t2", overridesDelta: { nodes: [] } }, "user"),
    ]);
    const memory = getProjectMemory("p1");
    const prefs = memory.facts.filter((fact) => fact.kind === "preference");
    expect(prefs).toHaveLength(1);
    expect(prefs[0].sourceSeqs.length).toBeGreaterThanOrEqual(2);
  });

  it("增量游标:第二次 get 只扫新事件;提炼回执 memory.fact.* 入日志", () => {
    appendEvents("p1", [characterAdded("c1", "女主角", "v1")]);
    const first = getProjectMemory("p1");
    expect(readEvents("p1").some((event) => event.type === "memory.fact.added")).toBe(true);

    appendEvents("p1", [evt("canvas.node.prompt-changed", { nodeId: "c1", prompt: "v2 新设定" })]);
    const second = getProjectMemory("p1");
    expect(second.lastDistilledSeq).toBeGreaterThan(first.lastDistilledSeq);
    expect(second.facts[0].text).toContain("v2 新设定");
    expect(readEvents("p1").some((event) => event.type === "memory.fact.corrected")).toBe(true);
  });

  it("memory.json 删掉可全量重建,结果等价", () => {
    appendEvents("p1", [
      characterAdded("c1", "女主角", "黑发"),
      evt("canvas.node.locked", { nodeId: "c1", title: "女主角" }),
    ]);
    const before = getProjectMemory("p1");
    fs.rmSync(path.join(tmpRoot, "p1", ".nomi", "memory.json"));
    const rebuilt = getProjectMemory("p1");
    expect(rebuilt.facts.map((fact) => [fact.id, fact.text])).toEqual(before.facts.map((fact) => [fact.id, fact.text]));
  });

  it("不变量:用户纠正过的文本永不被自动提炼覆盖", () => {
    appendEvents("p1", [characterAdded("c1", "女主角", "v1")]);
    getProjectMemory("p1");
    updateMemoryFact("p1", "node:c1", { text: "女主角:用户手写的权威设定" });

    appendEvents("p1", [evt("canvas.node.prompt-changed", { nodeId: "c1", prompt: "AI 又改了" })]);
    const memory = getProjectMemory("p1");
    expect(memory.facts[0].text).toBe("女主角:用户手写的权威设定");
    expect(memory.facts[0].origin).toBe("user");

    // 缓存删掉全量重建:用户纠正从日志(memory.fact.corrected)回放,仍不被覆盖。
    fs.rmSync(path.join(tmpRoot, "p1", ".nomi", "memory.json"));
    const rebuilt = getProjectMemory("p1");
    expect(rebuilt.facts[0].text).toBe("女主角:用户手写的权威设定");
    expect(rebuilt.facts[0].origin).toBe("user");
  });

  it("墓碑:删除点之前的事件不再重提炼;之后重新上锁可再记住", () => {
    appendEvents("p1", [evt("canvas.node.locked", { nodeId: "c1", title: "定妆" })]);
    getProjectMemory("p1");
    removeMemoryFact("p1", "lock:c1");
    // 缓存删除后全量重建也不能复活(墓碑生效)
    fs.rmSync(path.join(tmpRoot, "p1", ".nomi", "memory.json"));
    let memory = getProjectMemory("p1");
    expect(memory.facts.filter((fact) => fact.id === "lock:c1")).toHaveLength(0);
    // 用户重新上锁(新事件在墓碑之后)→ 重新记住
    appendEvents("p1", [evt("canvas.node.locked", { nodeId: "c1", title: "定妆" })]);
    memory = getProjectMemory("p1");
    expect(memory.facts.filter((fact) => fact.id === "lock:c1")).toHaveLength(1);
  });

  it("节点删除 → 实体/锁事实一并移除;pin 持久", () => {
    appendEvents("p1", [characterAdded("c1", "女主角", "黑发")]);
    getProjectMemory("p1");
    updateMemoryFact("p1", "node:c1", { pinned: true });
    expect(getProjectMemory("p1").facts[0].pinned).toBe(true);

    appendEvents("p1", [evt("canvas.node.removed", { nodeId: "c1" })]);
    expect(getProjectMemory("p1").facts).toHaveLength(0);
  });
});
