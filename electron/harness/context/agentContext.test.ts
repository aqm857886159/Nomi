import path from "node:path";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findSkillRecord, type SkillRecord } from "../../skills/skillStore";
import * as context from "./agentContext";

const FORBIDDEN_OWNER_IMPORT = /(?:from|import\s*\()\s*["'](?:ai|@ai-sdk\/[^"']*|@mariozechner\/[^"']*|@earendil-works\/pi-[^"']*|[^"']*(?:agentChatV2|agentSession|projectMemory|catalogStore))['"]/;

vi.mock("../../skills/skillStore", () => ({ findSkillRecord: vi.fn() }));

describe("Nomi agent context ownership", () => {
  beforeEach(() => {
    vi.mocked(findSkillRecord).mockReset();
    vi.mocked(findSkillRecord).mockReturnValue(null);
  });

  it("detects static and dynamic imports from every forbidden SDK prefix", () => {
    const imports = [
      "ai", "@ai-sdk/openai", "@mariozechner/pi-coding-agent",
      "@earendil-works/pi-coding-agent", "@earendil-works/pi-agent-core", "@earendil-works/pi-ai",
    ].flatMap((specifier) => [
      `import { dependency } from "${specifier}";`,
      `const dependency = await import('${specifier}');`,
    ]);
    expect(imports.filter((source) => !FORBIDDEN_OWNER_IMPORT.test(source))).toEqual([]);
  });

  it("allows Zod, Node, and the context's existing local dependencies", () => {
    const imports = [
      "zod", "node:path", "../../jsonUtils", "../../skills/skillStore", "../../ai/promptSanitize",
    ].flatMap((specifier) => [
      `import { dependency } from "${specifier}";`,
      `const dependency = await import('${specifier}');`,
    ]);
    expect(imports.filter((source) => FORBIDDEN_OWNER_IMPORT.test(source))).toEqual([]);
  });

  it("has no model, Agent runtime, or second memory-store import", () => {
    const source = readFileSync(new URL("./agentContext.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(FORBIDDEN_OWNER_IMPORT);
  });

  it("reads and trims only the canonical nested skill identity", () => {
    expect(context.readRequestedSkill({ chatContext: { skill: { key: " workbench.creation.story ", name: " Story " } }, skillKey: "ignored" }))
      .toEqual({ key: "workbench.creation.story", name: "Story" });
    expect(context.readRequestedSkill({ skillKey: "top-level" })).toEqual({ key: "", name: "" });
    expect(context.readRequestedSkill({ chatContext: { skill: { key: 7, name: null } } })).toEqual({ key: "", name: "" });
  });

  it("leaves the skill layer empty when no skill was requested", () => {
    expect(context.buildSkillSystemPrompt({})).toBe("");
    expect(findSkillRecord).not.toHaveBeenCalled();
  });

  it("preserves the honest missing-skill message", () => {
    expect(context.buildSkillSystemPrompt({ chatContext: { skill: { key: "missing-skill" } } })).toBe([
      "Nomi 桌面 Agent skill 提示：",
      "请求的 skill 未在本地 skills 目录找到：missing-skill",
      "继续按用户请求和当前上下文完成任务；不要声称已经加载不存在的 skill。",
    ].join("\n"));
  });

  it("keeps the existing skill lookup and byte-exact local skill layer", () => {
    const skill: SkillRecord = {
      name: "story-method", directoryName: "story", filePath: path.join(process.cwd(), "skills/story/SKILL.md"),
      description: "Story method", body: "# Method\nWrite, review, revise.", manifest: null, origin: "user",
    };
    vi.mocked(findSkillRecord).mockReturnValue(skill);
    expect(context.buildSkillSystemPrompt({ chatContext: { skill: { key: "workbench.creation.story", name: "Story" } } })).toBe([
      "Nomi 桌面 Agent 已加载本地 skill。以下内容是本次回复必须参考的领域方法论和输出约束。",
      "注意：本桌面运行时只把 skill 作为本地知识注入；skill 中提到的外部 CLI、HTTP 或文件工具不会自动执行，除非当前对话/界面明确提供了对应能力。",
      "skillKey: workbench.creation.story", "skillName: Story", `skillFile: ${path.join("skills", "story", "SKILL.md")}`, "", skill.body,
    ].join("\n"));
    expect(findSkillRecord).toHaveBeenCalledWith("workbench.creation.story", "Story");
  });

  it("falls back to the resolved local skill name without changing the requested lookup", () => {
    vi.mocked(findSkillRecord).mockReturnValue({
      name: "story-method", directoryName: "story", filePath: path.join(process.cwd(), "skills/story/SKILL.md"),
      description: "Story method", body: "Method", manifest: null, origin: "builtin",
    });
    const prompt = context.buildSkillSystemPrompt({ chatContext: { skill: { name: "Story" } } });
    expect(prompt).toContain("skillKey: story-method\nskillName: Story");
    expect(findSkillRecord).toHaveBeenCalledWith("", "Story");
  });

  it("composes four layers in order with memory last and no extra separators", () => {
    expect(context.composeAgentSystemPrompt({ identity: "Identity", panelSystemPrompt: "Panel", skillSystemPrompt: "Skill", memoryBlock: "Memory" }))
      .toBe("Identity\n\nPanel\n\nSkill\n\nMemory");
  });
});
