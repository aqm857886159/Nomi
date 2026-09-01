import path from "node:path";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findSkillRecord, type SkillRecord } from "../../skills/skillStore";
import { SKILL_PACKAGE_VERSION } from "../../skills/skillPackage";
import * as context from "./agentContext";

// Post-cutover SkillRecord gained required audience/packageVersion/contentHash fields;
// these inline fixtures declare them so the record type-checks (contentHash is any 64-hex placeholder — the prompt-composition assertions never read it).
const FIXTURE_SKILL_META = {
  audience: "internal",
  packageVersion: SKILL_PACKAGE_VERSION,
  contentHash: "0".repeat(64),
} as const satisfies Pick<SkillRecord, "audience" | "packageVersion" | "contentHash">;

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
      ...FIXTURE_SKILL_META,
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
      ...FIXTURE_SKILL_META,
    });
    const prompt = context.buildSkillSystemPrompt({ chatContext: { skill: { name: "Story" } } });
    expect(prompt).toContain("skillKey: story-method\nskillName: Story");
    expect(findSkillRecord).toHaveBeenCalledWith("", "Story");
  });

  it("composes four layers in order with memory last, wrapped by the language rule", () => {
    const composed = context.composeAgentSystemPrompt({ identity: "Identity", panelSystemPrompt: "Panel", skillSystemPrompt: "Skill", memoryBlock: "Memory" });
    // 四层顺序不变、无多余分隔；语言规则首尾各一段（primacy/recency，见合成器注释）。
    expect(composed).toMatch(/Identity\n\nPanel\n\nSkill\n\nMemory/);
  });

  // 回归闸：提示词主体几乎全是中文，模型会照着提示词的语言说话。只在末尾放一句英文规则时，
  // 英文界面下会退化成中英混答（2026-08-28 用户实测）。规则必须首尾各出现一次。
  it("states the language rule at both ends, not just the tail", async () => {
    const { setDesktopLocale } = await import("../../desktopLocale");
    setDesktopLocale("en");
    const composed = context.composeAgentSystemPrompt({
      identity: "Identity", panelSystemPrompt: "Panel", skillSystemPrompt: "Skill", memoryBlock: "Memory",
    }) ?? "";
    const occurrences = composed.split("Response-language rule (highest priority):").length - 1;
    expect(occurrences).toBe(2);
    expect(composed.startsWith("Response-language rule (highest priority):")).toBe(true);
    expect(composed.trimEnd().endsWith("still answer in English.")).toBe(true);
  });

  // 中英混答的直接原因：提示词是中文，模型跟着提示词的语言走。必须点破「提示词语言 ≠ 输出语言」。
  it("tells the model the Chinese prompt body is not a language signal", async () => {
    const { setDesktopLocale } = await import("../../desktopLocale");
    setDesktopLocale("en");
    const composed = context.composeAgentSystemPrompt({ identity: "身份", panelSystemPrompt: "", skillSystemPrompt: "", memoryBlock: "" }) ?? "";
    expect(composed).toContain("written in Chinese");
    expect(composed).toContain("still answer in English");
  });

  // 语言规则跟界面语言走(不是写死英文)。中文界面下曾拿到一个用英文回话的助手——
  // DEFAULT_LOCALE 还是 zh-CN,那等于让绝大多数用户对着英文提示词工作。
  it("language rule follows the desktop locale", async () => {
    const { setDesktopLocale } = await import("../../desktopLocale");
    const layers = { identity: "Identity", panelSystemPrompt: "", skillSystemPrompt: "", memoryBlock: "" };

    setDesktopLocale("en");
    const en = context.composeAgentSystemPrompt(layers) ?? "";
    expect(en).toContain("Response-language rule (highest priority):");
    expect(en).toContain("Respond in English.");

    setDesktopLocale("zh-CN");
    const zh = context.composeAgentSystemPrompt(layers) ?? "";
    expect(zh).toContain("回复语言铁律（最高优先级）：");
    expect(zh).toContain("默认用简体中文回复。");
    expect(zh).not.toContain("Respond in English by default.");
  });

  // 一条规则只有一个家(P1):身份层不得再自带一份语言规则,否则两份会互相打架且改一处漏一处。
  it("keeps exactly one language rule, not a copy inside the identity layer", () => {
    expect(context.NOMI_AGENT_IDENTITY).not.toMatch(/language rule/i);
    expect(context.NOMI_AGENT_IDENTITY).not.toContain("回复语言铁律");
  });
});
