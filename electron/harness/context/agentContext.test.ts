import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findSkillRecord, readSkillRecords, type SkillRecord } from "../../skills/skillStore";
import { SKILL_PACKAGE_VERSION } from "../../skills/skillPackage";
import * as context from "./agentContext";

const FORBIDDEN_OWNER_IMPORT = /(?:from|import\s*\()\s*["'](?:ai|@ai-sdk\/[^"']*|@mariozechner\/[^"']*|@earendil-works\/pi-[^"']*|[^"']*(?:agentChatV2|agentSession|projectMemory|catalogStore))['"]/;

// 目录是 async 的（pi 的加载器在岛上）：`resolveRequestedSkill` 每次都 `await readSkillRecords()` 再查。
vi.mock("../../skills/skillStore", () => ({ findSkillRecord: vi.fn(), readSkillRecords: vi.fn(async () => []) }));

const skillFixture = (): SkillRecord => ({
  name: "story-method", directoryName: "story", filePath: "/skills/story/SKILL.md", packageDir: "/skills/story",
  description: "Story method", content: "# Method", body: "---\nname: story-method\n---\n# Method", manifest: null, origin: "user",
  audience: "internal", packageVersion: SKILL_PACKAGE_VERSION, contentHash: "0".repeat(64), requiresCodingTools: false,
});

describe("Nomi agent context ownership", () => {
  beforeEach(() => {
    vi.mocked(findSkillRecord).mockReset();
    vi.mocked(findSkillRecord).mockReturnValue(null);
    vi.mocked(readSkillRecords).mockReset();
    vi.mocked(readSkillRecords).mockResolvedValue([]);
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

  // 2026-09-18：选中技能进提示词的唯一注入点搬到了岛上（`electron/agentLane/laneSkillPrompt.mts`，
  // pi 的 `formatSkillInvocation`）。这一层只剩身份 / 语言 / 合成 / 解析用户点了哪条技能，
  // 所以这里不许再长出一份手拼的 `<skill name=` 信封（S52：拼技能正文的只有一处）。
  it("no longer assembles the selected-skill prompt itself", () => {
    const source = readFileSync(new URL("./agentContext.ts", import.meta.url), "utf8");
    expect(source).not.toContain("<skill name=");
    expect(source).not.toMatch(/export function buildSelectedSkillPrompt/);
    expect((context as Record<string, unknown>).buildSelectedSkillPrompt).toBeUndefined();
  });

  it("reads and trims only the canonical nested skill identity", () => {
    expect(context.readRequestedSkill({ chatContext: { skill: { key: " workbench.creation.story ", name: " Story " } }, skillKey: "ignored" }))
      .toEqual({ key: "workbench.creation.story", name: "Story" });
    expect(context.readRequestedSkill({ skillKey: "top-level" })).toEqual({ key: "", name: "" });
    expect(context.readRequestedSkill({ chatContext: { skill: { key: 7, name: null } } })).toEqual({ key: "", name: "" });
  });

  // S41：用户刚导入的技能这一轮就找得到——目录每次现扫，不拿开 lane 时的快照。
  it("resolves the requested skill against a freshly read catalog every time", async () => {
    const record = skillFixture();
    vi.mocked(readSkillRecords).mockResolvedValue([record]);
    vi.mocked(findSkillRecord).mockReturnValue(record);
    expect(await context.resolveRequestedSkill({ chatContext: { skill: { key: "story", name: "" } } })).toBe(record);
    expect(findSkillRecord).toHaveBeenCalledWith("story", "", [record]);
    await context.resolveRequestedSkill({ chatContext: { skill: { key: "story", name: "" } } });
    expect(readSkillRecords).toHaveBeenCalledTimes(2);
    // 没点技能就不读盘：不为一个空结果扫一遍技能库。
    expect(await context.resolveRequestedSkill({})).toBeNull();
    expect(readSkillRecords).toHaveBeenCalledTimes(2);
  });

  // 回归闸：提示词主体几乎全是中文，模型会照着提示词的语言说话。只在末尾放一句英文规则时，
  // 英文界面下会退化成中英混答（2026-08-28 用户实测）。规则必须首尾各出现一次。
  // 首尾各放一次发生在 lane 拼最终系统提示的地方（`systemPromptClosing`），
  // 由 tests/agent-runtime/lane-language-rule.test.mts 走真 lane 钉死；这里只钉规则本身。
  it("the language rule opens with its header and closes with the not-a-language-signal sentence", async () => {
    const { setDesktopLocale } = await import("../../desktopLocale");
    setDesktopLocale("en");
    const rule = context.buildLanguageRule();
    expect(rule.startsWith("Response-language rule (highest priority):")).toBe(true);
    expect(rule.trimEnd().endsWith("still answer in English.")).toBe(true);
  });

  // 中英混答的直接原因：提示词是中文，模型跟着提示词的语言走。必须点破「提示词语言 ≠ 输出语言」。
  it("tells the model the Chinese prompt body is not a language signal", async () => {
    const { setDesktopLocale } = await import("../../desktopLocale");
    setDesktopLocale("en");
    const composed = context.buildLanguageRule();
    expect(composed).toContain("written in Chinese");
    expect(composed).toContain("still answer in English");
  });

  // 语言规则跟界面语言走(不是写死英文)。中文界面下曾拿到一个用英文回话的助手——
  // DEFAULT_LOCALE 还是 zh-CN,那等于让绝大多数用户对着英文提示词工作。
  it("language rule follows the desktop locale", async () => {
    const { setDesktopLocale } = await import("../../desktopLocale");
    setDesktopLocale("en");
    const en = context.buildLanguageRule();
    expect(en).toContain("Response-language rule (highest priority):");
    expect(en).toContain("Respond in English.");

    setDesktopLocale("zh-CN");
    const zh = context.buildLanguageRule();
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

it("preserves user-authored fields in both response languages", async () => {
    const { setDesktopLocale } = await import("../../desktopLocale");
    for (const locale of ["en", "zh-CN"] as const) {
      setDesktopLocale(locale);
      expect(context.buildLanguageRule()).toMatch(/保持原文|verbatim/);
    }
    setDesktopLocale("zh-CN");
  });
