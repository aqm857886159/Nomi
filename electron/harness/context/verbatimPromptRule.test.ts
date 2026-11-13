import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CANVAS_NODE_PROMPT_GUIDELINES } from "../../shared/agentCapabilities/canvasWrite";
import { modelFacingToolSpecs } from "../../shared/agentCapabilities/modelFacingToolRegistry";
import { NOMI_AGENT_IDENTITY } from "./agentContext";

// 「用户逐字给的提示词，Agent 照写」这一类的门岗（设计卡 docs/plan/2026-11-07-agent-verbatim-prompt.md）。
//
// 事故：用户说「提示词写：一只橘猫坐在窗台上」，落下的是多了氛围词和「写实摄影风格」的句子。
// 根因不在代码：起草工具的说明无条件要求「按骨架写、末尾加风格词」，模型当成对每个提示词的要求。
// 这一类会从哪回来：任何一处模型可见文字里，再写一句**无条件**的「加风格 / 氛围」要求。
// 所以这里不只钉那一条，而是把「模型可见文字里所有叫它加风格 / 氛围的地方」登记成表：
// 表里的必须自带适用条件（只在「由你来写」时才做），没登记的新句子进来当场红。

/** 叫模型往提示词里添风格 / 氛围的措辞。 */
const STYLE_ADDING = /style keywords?|风格关键词|风格词|氛围/i;
/** 适用条件：只在模型自己写提示词时才加。 */
const SCOPE_CONDITION = /(when you compose|由你来写|你自己写)/i;
const repoRoot = path.resolve(__dirname, "../../..");
const readSkill = (relative: string): string => readFileSync(path.join(repoRoot, relative), "utf8");

function toolTexts(): Array<{ source: string; text: string }> {
  const seen = new Map<string, string>();
  for (const profile of ["internal", "mcp"] as const) {
    for (const spec of modelFacingToolSpecs(profile)) {
      const text = [spec.description, spec.promptSnippet, ...(spec.promptGuidelines ?? [])].filter(Boolean).join("\n");
      seen.set(`tool:${profile}:${spec.name}`, text);
    }
  }
  return [...seen].map(([source, text]) => ({ source, text }));
}

describe("用户给了提示词原文，Agent 逐字落", () => {
  it("身份层有这条规则，且覆盖三种说法、不翻译", () => {
    expect(NOMI_AGENT_IDENTITY).toMatch(/提示词写/);
    expect(NOMI_AGENT_IDENTITY).toMatch(/改成/);
    expect(NOMI_AGENT_IDENTITY).toMatch(/逐字/);
    expect(NOMI_AGENT_IDENTITY).toMatch(/不翻译/);
    expect(NOMI_AGENT_IDENTITY).toMatch(/让你写、润色、扩写/);
  });

  it("规则只有身份层一个家：工具说明里没有第二份「逐字」规则正文，只有适用条件", () => {
    const guideline = CANVAS_NODE_PROMPT_GUIDELINES.join("\n");
    expect(guideline).toMatch(SCOPE_CONDITION);
    expect(guideline).not.toMatch(/提示词写|改成/);
  });

  it("起草工具的说明（内部面与对外 MCP 面）都带适用条件", () => {
    for (const profile of ["internal", "mcp"] as const) {
      const spec = modelFacingToolSpecs(profile).find((item) => item.name === "draft_shots");
      if (!spec) continue; // 对外面按契约改名，由下面的全量扫描覆盖
      expect((spec.promptGuidelines ?? []).join("\n")).toMatch(SCOPE_CONDITION);
    }
  });

  it("生成区规划技能第 6 条带条件", () => {
    const body = readSkill("skills/workbench-generation/SKILL.md");
    const line = body.split("\n").find((item) => item.startsWith("6. **提示词**"));
    expect(line).toBeTruthy();
    expect(line).toMatch(/逐字用它/);
  });

  it("类检查：模型可见文字里每一处叫它加风格 / 氛围的话，都必须自带适用条件", () => {
    const hits: Array<{ source: string; text: string }> = [];
    for (const item of toolTexts()) if (STYLE_ADDING.test(item.text)) hits.push(item);
    for (const relative of ["skills/workbench-generation/SKILL.md"]) {
      const text = readSkill(relative);
      if (STYLE_ADDING.test(text)) hits.push({ source: relative, text });
    }
    // 至少能扫到起草工具的那一处，否则这个扫描空转。
    expect(hits.some((item) => item.source.includes("draft_shots"))).toBe(true);
    const unscoped = hits.filter((item) => !SCOPE_CONDITION.test(item.text) && !/逐字用它/.test(item.text)).map((item) => item.source);
    expect(unscoped, "这些模型可见文字无条件地叫模型加风格 / 氛围：补上「由你来写时」的适用条件，或登记为只在用户让写时用的方法论").toEqual([]);
  });
});
