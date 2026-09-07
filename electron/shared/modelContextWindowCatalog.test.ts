// 这张表的价值全在「每条都能追回一手出处」上。测试钉的就是这条纪律，不是某个具体数字。
import { describe, expect, it } from "vitest";
import { MODEL_CONTEXT_WINDOW_FACTS, officialModelContextWindow } from "./modelContextWindowCatalog";
import { modelContextWindow } from "./modelContextWindow";

describe("模型上下文窗口 · 一手文档表", () => {
  it("每一条都带出处和查证日期——包括 unknown 那几条", () => {
    for (const [modelKey, fact] of Object.entries(MODEL_CONTEXT_WINDOW_FACTS)) {
      expect(fact.source, modelKey).toMatch(/^https?:\/\//);
      expect(fact.checkedAt, modelKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("有数的条目必须是正整数，并说清这个数是什么", () => {
    for (const [modelKey, fact] of Object.entries(MODEL_CONTEXT_WINDOW_FACTS)) {
      if (fact.contextWindow === undefined) continue;
      expect(Number.isInteger(fact.contextWindow), modelKey).toBe(true);
      expect(fact.contextWindow, modelKey).toBeGreaterThan(0);
      expect(fact.measures, modelKey).toBeTruthy();
    }
  });

  it("换算来的数必须写清原文是什么——「不编」不等于「不许换算」，等于「换算要留痕」", () => {
    for (const [modelKey, fact] of Object.entries(MODEL_CONTEXT_WINDOW_FACTS)) {
      if (!fact.derived) continue;
      expect(fact.note, modelKey).toBeTruthy();
    }
  });

  it("unknown 的条目必须写清为什么——「查过没查到」和「没查过」是两件事", () => {
    for (const [modelKey, fact] of Object.entries(MODEL_CONTEXT_WINDOW_FACTS)) {
      if (fact.contextWindow !== undefined) continue;
      expect(fact.note, modelKey).toBeTruthy();
    }
  });

  it("一手来源自相矛盾时留 unknown，不挑一个（agnes-2.0-flash：256K vs 512K）", () => {
    expect(officialModelContextWindow("agnes-2.0-flash")).toBeUndefined();
  });

  it("表外的模型键返回 undefined，不借同族的数", () => {
    expect(officialModelContextWindow("deepseek-v9-imaginary")).toBeUndefined();
    expect(officialModelContextWindow(undefined)).toBeUndefined();
  });
});

describe("modelContextWindow：供应商报的数永远赢，表只是兜底", () => {
  it("meta 里有就用 meta 的——供应商知道自己那条链路的真实上限", () => {
    expect(modelContextWindow({ contextWindow: 65_536 }, "MiniMax-M3")).toBe(65_536);
  });

  it("meta 没有才查表——用户真实目录里 21 个对话模型的 meta 全是空的", () => {
    expect(modelContextWindow(undefined, "MiniMax-M3")).toBe(1_000_000);
    expect(modelContextWindow({}, "Qwen/Qwen3-8B")).toBe(32_768);
  });

  it("两处都没有就是 undefined——环因此画不出来，那是诚实不是缺陷", () => {
    expect(modelContextWindow(undefined, "some-self-hosted-model")).toBeUndefined();
    expect(modelContextWindow({ contextWindow: 0 }, "some-self-hosted-model")).toBeUndefined();
  });
});
