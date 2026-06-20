import { describe, expect, it } from "vitest";

import {
  PlaybookRun,
  extractMarkdownSection,
  orderPlaybookStages,
} from "./playbookOrchestrator";
import type { SkillStage } from "./skillManifestSchema";

const stage = (id: string, dependsOn?: string[], extra?: Partial<SkillStage>): SkillStage => ({
  id,
  goal: `goal ${id}`,
  tools: [],
  ...(dependsOn ? { dependsOn } : {}),
  ...extra,
});

describe("orderPlaybookStages", () => {
  it("orders by dependsOn (deps before dependents)", () => {
    const ordered = orderPlaybookStages([
      stage("assemble", ["media"]),
      stage("media", ["storyboard"]),
      stage("storyboard"),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(["storyboard", "media", "assemble"]);
  });

  it("keeps declaration order among independent stages (stable)", () => {
    const ordered = orderPlaybookStages([stage("a"), stage("b"), stage("c")]);
    expect(ordered.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("throws on a dependency referencing a missing stage", () => {
    expect(() => orderPlaybookStages([stage("a", ["ghost"])])).toThrow(/不存在的阶段/);
  });

  it("throws on a cycle", () => {
    expect(() => orderPlaybookStages([stage("a", ["b"]), stage("b", ["a"])])).toThrow(/循环依赖/);
  });

  it("throws on duplicate stage ids", () => {
    expect(() => orderPlaybookStages([stage("a"), stage("a")])).toThrow(/重复/);
  });
});

describe("extractMarkdownSection", () => {
  const body = [
    "## 流程规划",
    "先拆镜头再生成。",
    "",
    "## 媒体生成",
    "用 image 模型出关键帧。",
    "### 子节",
    "细节。",
    "## 视频剪辑",
    "对齐时间轴。",
  ].join("\n");

  it("extracts the body under a heading up to the next same-or-higher heading", () => {
    expect(extractMarkdownSection(body, "流程规划")).toBe("先拆镜头再生成。");
  });

  it("includes deeper sub-headings within a section", () => {
    expect(extractMarkdownSection(body, "媒体生成")).toContain("子节");
    expect(extractMarkdownSection(body, "媒体生成")).not.toContain("对齐时间轴");
  });

  it("returns empty string when heading absent", () => {
    expect(extractMarkdownSection(body, "不存在")).toBe("");
  });
});

describe("PlaybookRun", () => {
  it("pauses after each stage by default and advances on confirm", () => {
    const run = new PlaybookRun([stage("s1"), stage("s2")]);
    expect(run.current()?.id).toBe("s1");
    expect(run.current()?.pause).toBe(true);

    const r1 = run.completeCurrent();
    expect(r1).toEqual({ paused: true, done: false });
    expect(run.getStatus()).toBe("awaiting-confirm");
    // 未确认前游标不动
    expect(run.current()?.id).toBe("s1");

    run.advance();
    expect(run.current()?.id).toBe("s2");

    const r2 = run.completeCurrent();
    expect(r2).toEqual({ paused: true, done: true });
    run.advance();
    expect(run.isDone()).toBe(true);
    expect(run.current()).toBeNull();
  });

  it("auto-advances past a non-pause stage without waiting", () => {
    const run = new PlaybookRun([stage("s1", undefined, { pause: false }), stage("s2")]);
    const r1 = run.completeCurrent();
    expect(r1).toEqual({ paused: false, done: false });
    expect(run.getStatus()).toBe("running");
    expect(run.current()?.id).toBe("s2");
  });

  it("exposes per-stage tool whitelist and resolved order", () => {
    const run = new PlaybookRun([
      stage("media", ["plan"], { tools: ["run_generation_batch"] }),
      stage("plan", undefined, { tools: ["propose_storyboard_plan"] }),
    ]);
    expect(run.current()?.id).toBe("plan");
    expect(run.current()?.tools).toEqual(["propose_storyboard_plan"]);
    expect(run.current()?.total).toBe(2);
  });

  it("is immediately done with no stages", () => {
    const run = new PlaybookRun([]);
    expect(run.isDone()).toBe(true);
    expect(run.current()).toBeNull();
  });
});
