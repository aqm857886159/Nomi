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
  addUserMemoryFact,
  formatMemoryForPrompt,
  getProjectMemory,
  removeMemoryFact,
  setProjectMemoryDirResolverForTests,
  updateMemoryFact,
  type MemoryFact,
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

const fact = (id: string, text: string, extra: Partial<MemoryFact> = {}): MemoryFact => ({
  id,
  text,
  kind: "character",
  origin: "auto",
  sourceSeqs: [1],
  pinned: false,
  updatedAt: "2026-06-12T00:00:00Z",
  ...extra,
});

describe("formatMemoryForPrompt — 注入段(预算 + 排序),创作区/生成区共享", () => {
  it("空记忆零注入", () => {
    expect(formatMemoryForPrompt([])).toBe("");
  });

  it("裁剪顺序:pinned > 用户纠正 > 自动 + 新近度", () => {
    const facts = [
      fact("a", "自动旧", { updatedAt: "2026-06-01T00:00:00Z" }),
      fact("b", "用户纠正的", { origin: "user" }),
      fact("c", "置顶的", { pinned: true, updatedAt: "2026-05-01T00:00:00Z" }),
      fact("d", "自动新", { updatedAt: "2026-06-12T00:00:00Z" }),
    ];
    const block = formatMemoryForPrompt(facts);
    const order = ["置顶的", "用户纠正的", "自动新", "自动旧"].map((needle) => block.indexOf(needle));
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it("超预算按序截断,不超不裁", () => {
    const facts = Array.from({ length: 50 }, (_, index) => fact(`f${index}`, `事实${index}`.padEnd(100, "。")));
    const block = formatMemoryForPrompt(facts, 500);
    expect(block.length).toBeLessThanOrEqual(500 + 40); // 标题行不计预算
    expect(block).toContain("事实0");
    expect(block).not.toContain("事实49");
  });
});

describe("addUserMemoryFact — 软偏好转正(提议态「记住」/手动加)", () => {
  it("写入一条 origin:user 的 preference 事实", () => {
    const memory = addUserMemoryFact("p1", "我喜欢冷色调，蓝灰为主");
    const fact = memory.facts.find((f) => f.text === "我喜欢冷色调，蓝灰为主");
    expect(fact).toBeTruthy();
    expect(fact!.origin).toBe("user");
    expect(fact!.kind).toBe("preference");
    expect(fact!.id.startsWith("user:")).toBe(true);
  });

  it("同文本去重（同 id，不重复堆）", () => {
    addUserMemoryFact("p1", "片头控制在 3 秒内");
    const memory = addUserMemoryFact("p1", "片头控制在 3 秒内");
    expect(memory.facts.filter((f) => f.text === "片头控制在 3 秒内")).toHaveLength(1);
  });

  it("空文本不写", () => {
    const before = getProjectMemory("p1").facts.length;
    expect(addUserMemoryFact("p1", "   ").facts.length).toBe(before);
  });

  it("可删可重建：删 memory.json 后从事件回放仍复原用户偏好", () => {
    addUserMemoryFact("p1", "整体节奏要快");
    // 删物化视图，强制从 seq 0 全量重建
    fs.rmSync(path.join(tmpRoot, "p1", ".nomi", "memory.json"), { force: true });
    const rebuilt = getProjectMemory("p1");
    expect(rebuilt.facts.some((f) => f.text === "整体节奏要快" && f.origin === "user")).toBe(true);
  });

  it("用户删除后留墓碑；同文本重加（新事件晚于墓碑）可重新记住", () => {
    let memory = addUserMemoryFact("p1", "多用特写");
    const id = memory.facts.find((f) => f.text === "多用特写")!.id;
    removeMemoryFact("p1", id);
    expect(getProjectMemory("p1").facts.some((f) => f.id === id)).toBe(false);
    memory = addUserMemoryFact("p1", "多用特写");
    expect(memory.facts.some((f) => f.text === "多用特写")).toBe(true);
  });
});
