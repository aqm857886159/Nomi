import { describe, expect, it } from "vitest";

import { parseSkillManifest, skillManifestSchema } from "./skillManifestSchema";

// 这些对象就是 SKILL.md frontmatter 里 `metadata.nomi` 那一块的解析结果。
// 线上是 kebab-case（与 frontmatter 既有习惯一致），schema 转成 camelCase 给下游。
describe("skillManifestSchema (metadata.nomi)", () => {
  it("accepts a minimal valid extension block", () => {
    const result = parseSkillManifest({
      version: "1.0.0",
      tools: ["create_canvas_nodes"],
      "required-providers": ["text"],
    });
    expect(result.ok).toBe(true);
  });

  it("maps kebab-case wire keys onto the camelCase shape consumers already read", () => {
    const result = parseSkillManifest({
      version: "1.0.0",
      "selectable-in-workbench": true,
      "requested-capabilities": [],
      tools: ["propose_storyboard_plan"],
      "required-providers": ["text", "image"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.selectableInWorkbench).toBe(true);
    expect(result.manifest.requestedCapabilities).toEqual([]);
    expect(result.manifest.requiredProviders).toEqual(["text", "image"]);
  });

  it("rejects a block that restates name or description (frontmatter owns those)", () => {
    const result = parseSkillManifest({
      name: "workbench-example",
      description: "Example skill",
      version: "1.0.0",
      tools: [],
      "required-providers": ["text"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.manifest as Record<string, unknown>).name).toBeUndefined();
      expect((result.manifest as Record<string, unknown>).description).toBeUndefined();
    }
  });

  it("rejects missing required fields", () => {
    expect(skillManifestSchema.safeParse({ version: "1.0.0" }).success).toBe(false);
  });

  it("rejects an empty version string", () => {
    const result = parseSkillManifest({ version: "", tools: [], "required-providers": [] });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown capability id in requested-capabilities", () => {
    const result = parseSkillManifest({
      version: "1.0.0",
      "requested-capabilities": ["not.a.capability"],
      tools: [],
      "required-providers": ["text"],
    });
    expect(result.ok).toBe(false);
  });

  // --- Playbook stages（向后兼容：无 stages = 单段包） ---

  it("stays valid with no stages", () => {
    const result = parseSkillManifest({
      version: "1.0.0",
      tools: ["create_canvas_nodes"],
      "required-providers": ["text", "image"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.stages).toBeUndefined();
  });

  it("accepts a multi-stage playbook with kind+family model prefs", () => {
    const result = parseSkillManifest({
      version: "1.0.0",
      author: "@nomi",
      tools: ["propose_storyboard_plan", "create_canvas_nodes", "run_generation_batch"],
      "required-providers": ["text", "image", "video"],
      stages: [
        {
          id: "storyboard",
          goal: "拆镜头",
          tools: ["propose_storyboard_plan"],
          "skill-refs": ["director-shot-translation", "director-consistency"],
          pause: true,
        },
        {
          id: "media",
          goal: "生成镜头",
          tools: ["create_canvas_nodes", "run_generation_batch"],
          "depends-on": ["storyboard"],
          "model-prefs": [{ kind: "image" }, { kind: "video", family: "seedance" }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.stages).toHaveLength(2);
    expect(result.manifest.stages?.[0].skillRefs).toEqual([
      "director-shot-translation",
      "director-consistency",
    ]);
    expect(result.manifest.stages?.[1].dependsOn).toEqual(["storyboard"]);
    expect(result.manifest.stages?.[1].modelPrefs).toEqual([
      { kind: "image" },
      { kind: "video", family: "seedance" },
    ]);
  });

  it("REJECTS vendor-specific archetypeId in model-prefs (P4: 只引 kind+family)", () => {
    const result = parseSkillManifest({
      version: "1.0.0",
      tools: [],
      "required-providers": ["video"],
      stages: [
        {
          id: "media",
          goal: "g",
          tools: ["run_generation_batch"],
          // archetypeId 是 vendor 专属，.strict() 必须拒掉（防分享绑死）
          "model-prefs": [{ kind: "video", archetypeId: "seedance-2-apimart" }],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("REJECTS hardcoded params in model-prefs (参数交模型档案)", () => {
    const result = parseSkillManifest({
      version: "1.0.0",
      tools: [],
      "required-providers": ["video"],
      stages: [
        { id: "m", goal: "g", tools: [], "model-prefs": [{ kind: "video", params: { duration: 5 } }] },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a stage missing required id/goal/tools", () => {
    const result = parseSkillManifest({
      version: "1.0.0",
      tools: [],
      "required-providers": ["text"],
      stages: [{ goal: "no id and no tools" }],
    });
    expect(result.ok).toBe(false);
  });
});
