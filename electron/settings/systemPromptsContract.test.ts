import { describe, expect, it } from "vitest";

import {
  CUSTOM_PROMPT_ID_PREFIX,
  CUSTOM_PROMPT_MAX_COUNT,
  CUSTOM_PROMPT_NAME_MAX_LENGTH,
  isCustomPromptId,
  normalizeSystemPromptOverrides,
  SYSTEM_PROMPT_MAX_LENGTH,
} from "../shared/contracts/systemPromptsContract";

const customId = (suffix: string): string => `${CUSTOM_PROMPT_ID_PREFIX}${suffix}`;

describe("normalizeSystemPromptOverrides — 覆盖层清洗", () => {
  it("丢弃未知模式 id", () => {
    const result = normalizeSystemPromptOverrides({
      schemaVersion: 1,
      prompts: { story: "我的故事提示词", nope: "不存在的模式", __proto__: "脏值" },
    });
    expect(result.prompts).toEqual({ story: "我的故事提示词" });
  });

  it("丢弃非字符串值", () => {
    const result = normalizeSystemPromptOverrides({
      prompts: { story: 42, script: null, assets: { text: "x" }, review: ["a"], general: "有效" },
    });
    expect(result.prompts).toEqual({ general: "有效" });
  });

  it("丢弃空白串（清空 = 回默认，不是覆盖成空提示词）", () => {
    const result = normalizeSystemPromptOverrides({ prompts: { story: "   \n\t ", script: "真值" } });
    expect(result.prompts).toEqual({ script: "真值" });
  });

  it("超过上限的提示词被截断到上限长度", () => {
    const overlong = "字".repeat(SYSTEM_PROMPT_MAX_LENGTH + 500);
    const result = normalizeSystemPromptOverrides({ prompts: { story: overlong } });
    expect(result.prompts.story).toHaveLength(SYSTEM_PROMPT_MAX_LENGTH);
  });

  it("恰好等于上限的提示词原样保留", () => {
    const exact = "字".repeat(SYSTEM_PROMPT_MAX_LENGTH);
    const result = normalizeSystemPromptOverrides({ prompts: { story: exact } });
    expect(result.prompts.story).toBe(exact);
  });

  it("垃圾输入退化成空覆盖而不是抛错", () => {
    for (const value of [null, undefined, 7, "字符串", [], { prompts: "不是对象" }]) {
      expect(normalizeSystemPromptOverrides(value)).toEqual({ schemaVersion: 2, prompts: {}, custom: [] });
    }
  });

  it("总是盖上当前 schemaVersion", () => {
    expect(normalizeSystemPromptOverrides({ schemaVersion: 99, prompts: {} }).schemaVersion).toBe(2);
  });
});

describe("normalizeSystemPromptOverrides — v1 → v2 迁移", () => {
  // 回归锁：v1 文件没有 `custom` 字段。要是迁移写成「版本号不是 2 就整份丢掉」，
  // 用户上一轮改过的内置提示词会被静默抹掉——这是最贵的一种 bug（无声数据丢失）。
  it("v1 文件（没有 custom 字段）的 prompts 完整保留", () => {
    const result = normalizeSystemPromptOverrides({
      schemaVersion: 1,
      prompts: { story: "我在 v1 改过的故事提示词", review: "我在 v1 改过的审校提示词" },
    });
    expect(result.prompts).toEqual({
      story: "我在 v1 改过的故事提示词",
      review: "我在 v1 改过的审校提示词",
    });
    expect(result.custom).toEqual([]);
    expect(result.schemaVersion).toBe(2);
  });

  it("完全没有版本号的老文件也照样保住 prompts", () => {
    const result = normalizeSystemPromptOverrides({ prompts: { script: "无版本号的老覆盖" } });
    expect(result.prompts).toEqual({ script: "无版本号的老覆盖" });
    expect(result.custom).toEqual([]);
  });
});

describe("isCustomPromptId — 自定义 id 判定", () => {
  it("带前缀且有实体后缀才算自定义 id", () => {
    expect(isCustomPromptId(customId("abc"))).toBe(true);
  });

  it("光有前缀没有后缀不算（空 id 会和别的空 id 撞）", () => {
    expect(isCustomPromptId(CUSTOM_PROMPT_ID_PREFIX)).toBe(false);
  });

  it("内置模式 id 和非串一律不算", () => {
    for (const value of ["general", "story", "", 42, null, undefined, {}]) {
      expect(isCustomPromptId(value)).toBe(false);
    }
  });
});

describe("normalizeSystemPromptOverrides — 自定义提示词清洗", () => {
  it("id 不带 custom: 前缀的被丢弃（否则会和内置模式 id 撞）", () => {
    const result = normalizeSystemPromptOverrides({
      custom: [
        { id: "general", name: "冒充内置", prompt: "正文" },
        { id: "随便一个 id", name: "没有前缀", prompt: "正文" },
        { id: customId("ok"), name: "合法的", prompt: "正文" },
      ],
    });
    expect(result.custom).toEqual([{ id: customId("ok"), name: "合法的", prompt: "正文" }]);
  });

  it("id 重复时只留第一条（后来者丢弃）", () => {
    const result = normalizeSystemPromptOverrides({
      custom: [
        { id: customId("dup"), name: "第一条", prompt: "正文 A" },
        { id: customId("dup"), name: "第二条", prompt: "正文 B" },
      ],
    });
    expect(result.custom).toEqual([{ id: customId("dup"), name: "第一条", prompt: "正文 A" }]);
  });

  it("名字去空白后为空的被丢弃", () => {
    const result = normalizeSystemPromptOverrides({
      custom: [
        { id: customId("blank-name"), name: "   \n\t ", prompt: "正文" },
        { id: customId("no-name"), name: "", prompt: "正文" },
        { id: customId("ok"), name: "有名字", prompt: "正文" },
      ],
    });
    expect(result.custom).toEqual([{ id: customId("ok"), name: "有名字", prompt: "正文" }]);
  });

  // 回归锁（2026-08-18）：这里一度写成「正文为空就丢掉」，于是「＋ 新建」出来的那条
  // （名字有了、正文还没写）一落盘就消失——用户看着 chip 出现、下次启动却没了，且毫无提示。
  // 身份靠名字立得住，空正文只是「还没写」，不是坏数据。
  it("正文为空的条目保留（新建那一刻正文本来就是空的，丢掉 = 无声数据丢失）", () => {
    const result = normalizeSystemPromptOverrides({
      custom: [
        { id: customId("fresh"), name: "新提示词", prompt: "" },
        { id: customId("blank"), name: "只有空白", prompt: "   \n " },
      ],
    });
    expect(result.custom).toEqual([
      { id: customId("fresh"), name: "新提示词", prompt: "" },
      { id: customId("blank"), name: "只有空白", prompt: "   \n " },
    ]);
  });

  it("名字为空但正文有内容的仍然丢弃（名字才是它的身份）", () => {
    const result = normalizeSystemPromptOverrides({
      custom: [{ id: customId("nameless"), name: "  ", prompt: "正文很完整" }],
    });
    expect(result.custom).toEqual([]);
  });

  it("形状不对的条目（非对象 / 缺字段 / 字段非串）被丢弃而不是抛错", () => {
    const result = normalizeSystemPromptOverrides({
      custom: [
        null,
        42,
        "字符串",
        [],
        { id: customId("a"), name: 42, prompt: "正文" },
        { id: customId("b"), name: "名字", prompt: { text: "x" } },
        { id: customId("c"), name: "名字" },
      ],
    });
    expect(result.custom).toEqual([]);
  });

  it("custom 字段本身不是数组时退化成空数组", () => {
    for (const value of [null, undefined, 7, "字符串", { 0: "x" }]) {
      expect(normalizeSystemPromptOverrides({ custom: value }).custom).toEqual([]);
    }
  });

  it("超长名字被截断到上限（截断而非整条丢弃：用户那份还在编辑框里）", () => {
    const overlong = "名".repeat(CUSTOM_PROMPT_NAME_MAX_LENGTH + 20);
    const result = normalizeSystemPromptOverrides({
      custom: [{ id: customId("long"), name: overlong, prompt: "正文" }],
    });
    expect(result.custom[0]?.name).toHaveLength(CUSTOM_PROMPT_NAME_MAX_LENGTH);
  });

  it("超长正文被截断到提示词上限", () => {
    const overlong = "字".repeat(SYSTEM_PROMPT_MAX_LENGTH + 500);
    const result = normalizeSystemPromptOverrides({
      custom: [{ id: customId("long-body"), name: "名字", prompt: overlong }],
    });
    expect(result.custom[0]?.prompt).toHaveLength(SYSTEM_PROMPT_MAX_LENGTH);
  });

  it("条数超过上限时截到上限（防写坏，不是产品限制）", () => {
    const many = Array.from({ length: CUSTOM_PROMPT_MAX_COUNT + 10 }, (_unused, index) => ({
      id: customId(`n${index}`),
      name: `第 ${index} 条`,
      prompt: "正文",
    }));
    const result = normalizeSystemPromptOverrides({ custom: many });
    expect(result.custom).toHaveLength(CUSTOM_PROMPT_MAX_COUNT);
    // 截的是尾巴：留下的是最前面那批，顺序不乱。
    expect(result.custom[0]?.id).toBe(customId("n0"));
    expect(result.custom[CUSTOM_PROMPT_MAX_COUNT - 1]?.id).toBe(customId(`n${CUSTOM_PROMPT_MAX_COUNT - 1}`));
  });

  it("名字前后空白被去掉，正文原样保留（正文的缩进可能有意义）", () => {
    const result = normalizeSystemPromptOverrides({
      custom: [{ id: customId("trim"), name: "  口播带货体  ", prompt: "  有缩进的正文  " }],
    });
    expect(result.custom[0]?.name).toBe("口播带货体");
    expect(result.custom[0]?.prompt).toBe("  有缩进的正文  ");
  });

  it("内置覆盖和自定义条目互不干扰，一起保留", () => {
    const result = normalizeSystemPromptOverrides({
      schemaVersion: 2,
      prompts: { story: "改过的故事" },
      custom: [{ id: customId("mine"), name: "我的", prompt: "我的正文" }],
    });
    expect(result.prompts).toEqual({ story: "改过的故事" });
    expect(result.custom).toEqual([{ id: customId("mine"), name: "我的", prompt: "我的正文" }]);
  });
});
