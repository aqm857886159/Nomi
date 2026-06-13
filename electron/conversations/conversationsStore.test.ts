import { describe, expect, it } from "vitest";
import { normalizeToV2, sanitizeArea } from "./conversationsStore";

const NOW = 1_000;

describe("conversationsStore.normalizeToV2", () => {
  it("v1 单线程 → v2:非空消息包成一条 active 线程", () => {
    const v1 = {
      v: 1,
      creationMessages: [{ id: "u1", role: "user", content: "写个开场" }, { id: "a1", role: "assistant", content: "好的" }],
      generationMessages: [],
    };
    const out = normalizeToV2(v1, NOW);
    expect(out.v).toBe(2);
    expect(out.creation.threads).toHaveLength(1);
    expect(out.creation.activeId).toBe(out.creation.threads[0].id);
    expect(out.creation.threads[0].messages.map((m) => m.content)).toEqual(["写个开场", "好的"]);
    expect(out.creation.threads[0].title).toBe("写个开场");
    // 空 area → 无线程无 active。
    expect(out.generation).toEqual({ activeId: null, threads: [] });
  });

  it("无 v 标(更老/裸数据)按 v1 迁移", () => {
    const out = normalizeToV2({ creationMessages: [{ id: "x", role: "user", content: "hi there" }] }, NOW);
    expect(out.creation.threads).toHaveLength(1);
  });

  it("v2 透传 + 净化:丢非法线程、activeId 须指向留下的线程", () => {
    const v2 = {
      v: 2,
      creation: {
        activeId: "t1",
        threads: [
          { id: "t1", title: "甲", createdAt: 1, updatedAt: 9, messages: [] },
          { id: "", title: "坏", createdAt: 1, updatedAt: 2, messages: [] },
          { title: "无id", createdAt: 1, updatedAt: 3, messages: [] },
        ],
      },
      generation: { activeId: "ghost", threads: [{ id: "g1", title: "乙", createdAt: 1, updatedAt: 1, messages: [] }] },
    };
    const out = normalizeToV2(v2, NOW);
    expect(out.creation.threads.map((t) => t.id)).toEqual(["t1"]);
    expect(out.creation.activeId).toBe("t1");
    // activeId 指向不存在线程 → 置 null。
    expect(out.generation.activeId).toBeNull();
    expect(out.generation.threads.map((t) => t.id)).toEqual(["g1"]);
  });

  it("损坏/空内容 → 空 v2,不崩", () => {
    expect(normalizeToV2(null, NOW)).toEqual({ v: 2, creation: { activeId: null, threads: [] }, generation: { activeId: null, threads: [] }, committedProposal: null });
    expect(normalizeToV2("garbage", NOW).v).toBe(2);
  });

  it("committedProposal:有 proposalId 留,否则置 null", () => {
    expect(normalizeToV2({ v: 2, committedProposal: { proposalId: "p1", x: 1 } }, NOW).committedProposal).toEqual({ proposalId: "p1", x: 1 });
    expect(normalizeToV2({ v: 2, committedProposal: { x: 1 } }, NOW).committedProposal).toBeNull();
  });
});

describe("conversationsStore.sanitizeArea", () => {
  it("按 updatedAt 倒序裁到 30 条,保留最新", () => {
    const threads = Array.from({ length: 35 }, (_, i) => ({ id: `t${i}`, title: "", createdAt: i, updatedAt: i, messages: [] }));
    const out = sanitizeArea({ activeId: "t34", threads });
    expect(out.threads).toHaveLength(30);
    expect(out.threads[0].id).toBe("t34"); // 最新在前
    expect(out.threads.some((t) => t.id === "t0")).toBe(false); // 最旧被裁
  });
});
