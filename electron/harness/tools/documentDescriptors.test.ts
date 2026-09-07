import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { documentToolDescriptors, documentToolNames } from "./documentDescriptors";

const FORBIDDEN_OWNER_IMPORT = /(?:from|import\s*\()\s*["'](?:ai|@ai-sdk\/[^"']*|@mariozechner\/[^"']*|@earendil-works\/pi-[^"']*|[^"']*agentChatV2)["']/;

describe("Nomi document descriptors", () => {
  it("owns exactly the six active document tools", () => {
    expect(documentToolNames).toEqual(["read_full_text", "read_selection", "insert_at_cursor", "replace_selection", "append_to_end", "author_skill"]);
    expect(Object.keys(documentToolDescriptors)).toEqual(documentToolNames);
    for (const [name, descriptor] of Object.entries(documentToolDescriptors)) {
      expect(descriptor.name).toBe(name);
      expect(Object.keys(descriptor).sort()).toEqual(["description", "name", "parameters"]);
    }
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

  it("allows Zod, Node, and local pure helpers", () => {
    const imports = ["zod", "node:path", "../../jsonUtils"].flatMap((specifier) => [
      `import { dependency } from "${specifier}";`,
      `const dependency = await import('${specifier}');`,
    ]);
    expect(imports.filter((source) => FORBIDDEN_OWNER_IMPORT.test(source))).toEqual([]);
  });

  it("has no runtime or SDK dependency", () => {
    const source = readFileSync(new URL("./documentDescriptors.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(FORBIDDEN_OWNER_IMPORT);
    expect(source).not.toMatch(/\b(?:tool\s*\(|execute\s*:)/);
  });

  it("preserves every active description byte", () => {
    // 描述是模型看到的东西，改一个字节这里就红——逼人有意识地改，而不是顺手改。
    // 2026-09-07 重设：author_skill 的描述随格式收敛改写（不再要 skill.json manifest）。
    const descriptions = Object.fromEntries(Object.entries(documentToolDescriptors).map(([name, value]) => [name, value.description]));
    expect(createHash("sha256").update(JSON.stringify(descriptions)).digest("hex"))
      .toBe("15e5c98fafbe47c379d740f034c1f8cef513ff36395854f9648b3dd7a7cecedc");
  });

  it("accepts parameterless reads", () => {
    expect(documentToolDescriptors.read_full_text.parameters.parse({})).toEqual({});
    expect(documentToolDescriptors.read_selection.parameters.parse({})).toEqual({});
  });

  it.each(["insert_at_cursor", "replace_selection", "append_to_end"] as const)("%s requires nonempty content", (name) => {
    const schema = documentToolDescriptors[name].parameters;
    expect(schema.parse({ content: "## Draft\nA line" })).toEqual({ content: "## Draft\nA line" });
    expect(schema.safeParse({ content: "" }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("asks the model for one file, not a file plus a parallel manifest", () => {
    // 2026-09-07：author_skill 以前带一份 30 行的 manifest schema，那是同一份清单在模型面前的
    // 第三份定义（另两份是 skill.json 与它的 zod schema），而且它漏声明了 audience /
    // requestedCapabilities / skillRefs —— agent 写出来的技能永远声明不了那几样。
    // 现在只有 dirName + skillMarkdown：frontmatter 就是清单。
    const schema = documentToolDescriptors.author_skill.parameters;
    const payload = {
      dirName: "story-plan",
      skillMarkdown: [
        "---",
        "name: story-plan",
        "description: Plan a story, then review it.",
        "metadata:",
        "  nomi:",
        '    version: "1.0.0"',
        "---",
        "",
        "# Story plan",
      ].join("\n"),
    };
    expect(schema.parse(payload)).toEqual(payload);
    expect(schema.safeParse({ ...payload, skillMarkdown: "" }).success).toBe(false);
    expect(schema.safeParse({ ...payload, dirName: "" }).success).toBe(false);
    // 模型必须被告知 frontmatter 的形状，否则它只会写正文。
    expect(documentToolDescriptors.author_skill.description).toContain("SKILL.md");
    expect(JSON.stringify(schema.shape.skillMarkdown.description)).toContain("frontmatter");
  });
});
