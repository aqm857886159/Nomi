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
    // Captured from documentTools at b4a3f466 before extraction.
    const descriptions = Object.fromEntries(Object.entries(documentToolDescriptors).map(([name, value]) => [name, value.description]));
    expect(createHash("sha256").update(JSON.stringify(descriptions)).digest("hex"))
      .toBe("be3e674cf57c9cfd100d46af2313f6764a42913d46ed22ddf4de5e2aec9a04cb");
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

  it("preserves author_skill manifest and generic model preference contracts", () => {
    const payload = {
      dirName: "story-plan",
      skillMarkdown: "# Story plan\nPlan then review.",
      manifest: {
        name: "story.plan", version: "1.0.0", label: "Story plan", description: "Plan a story",
        tools: ["read_full_text", "propose_storyboard_plan"], requiredProviders: ["text", "image"], permissions: ["read-only", "create"],
        stages: [{ id: "plan", goal: "Draft", tools: ["read_full_text"], modelPrefs: [{ kind: "text", family: "reasoning" }] }],
      },
    };
    const schema = documentToolDescriptors.author_skill.parameters;
    expect(schema.parse(payload)).toEqual(payload);
    expect(schema.safeParse({ ...payload, manifest: { ...payload.manifest, requiredProviders: ["audio"] } }).success).toBe(false);
    expect(schema.safeParse({ ...payload, manifest: { ...payload.manifest, permissions: ["admin"] } }).success).toBe(false);
    expect(schema.safeParse({ ...payload, skillMarkdown: "" }).success).toBe(false);
  });
});
