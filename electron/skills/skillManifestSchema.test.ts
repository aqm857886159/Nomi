import { describe, expect, it } from "vitest";

import { parseSkillManifest, skillManifestSchema } from "./skillManifestSchema";

describe("skillManifestSchema", () => {
  it("accepts a minimal valid manifest", () => {
    const result = parseSkillManifest({
      name: "workbench.example",
      version: "1.0.0",
      description: "Example skill",
      tools: ["create_canvas_nodes"],
      requiredProviders: ["text"],
      permissions: ["create"],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts optional inputs and examples", () => {
    const result = parseSkillManifest({
      name: "workbench.example",
      version: "1.0.0",
      description: "Example skill",
      tools: ["create_canvas_nodes"],
      requiredProviders: ["text", "image"],
      permissions: ["read-only", "create"],
      inputs: [{ name: "story", description: "The story text", required: true }],
      examples: [{ title: "Demo", description: "demo case" }],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts an explicit Workbench picker visibility declaration", () => {
    const result = parseSkillManifest({
      name: "workbench.storyboard.planner",
      version: "1.0.0",
      description: "Storyboard planner",
      selectableInWorkbench: true,
      tools: ["propose_storyboard_plan"],
      requiredProviders: ["text", "image"],
      permissions: ["create"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.selectableInWorkbench).toBe(true);
  });

  it("rejects unknown permission values", () => {
    const result = parseSkillManifest({
      name: "x",
      version: "1.0.0",
      description: "d",
      tools: [],
      requiredProviders: ["text"],
      permissions: ["god-mode"],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects missing required fields", () => {
    const parsed = skillManifestSchema.safeParse({ name: "x" });
    expect(parsed.success).toBe(false);
  });

  it("rejects empty name string", () => {
    const result = parseSkillManifest({
      name: "",
      version: "1.0.0",
      description: "d",
      tools: [],
      requiredProviders: [],
      permissions: [],
    });
    expect(result.ok).toBe(false);
  });

  // --- Playbook stages (S1 扩展，向后兼容) ---

  it("stays valid with no stages (legacy single-stage pack, back-compat)", () => {
    const result = parseSkillManifest({
      name: "workbench.generation",
      version: "1.0.0",
      description: "d",
      tools: ["create_canvas_nodes"],
      requiredProviders: ["text", "image"],
      permissions: ["create"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.stages).toBeUndefined();
  });

  it("accepts a multi-stage playbook with kind+family modelPrefs", () => {
    const result = parseSkillManifest({
      name: "brand.promo",
      version: "1.0.0",
      description: "做品牌宣传片：当用户要把文案/卖点做成产品宣传短片时用我",
      tools: ["propose_storyboard_plan", "create_canvas_nodes", "run_generation_batch"],
      requiredProviders: ["text", "image", "video"],
      permissions: ["create"],
      author: "@nomi",
      stages: [
        {
          id: "storyboard",
          goal: "拆镜头",
          tools: ["propose_storyboard_plan"],
          skillRefs: ["director-shot-translation", "director-consistency"],
          pause: true,
        },
        {
          id: "media",
          goal: "生成镜头",
          tools: ["create_canvas_nodes", "run_generation_batch"],
          dependsOn: ["storyboard"],
          modelPrefs: [{ kind: "image" }, { kind: "video", family: "seedance" }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.stages).toHaveLength(2);
  });

  it("accepts stage-level skill references for progressive craft loading", () => {
    const result = parseSkillManifest({
      name: "drama.short",
      version: "1.0.0",
      description: "d",
      tools: [],
      requiredProviders: ["text", "image", "video"],
      permissions: ["create"],
      stages: [{
        id: "script",
        goal: "写剧本",
        tools: [],
        pause: true,
        skillRefs: ["writer-screenwriter", "writer-dialogue"],
      }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.stages?.[0].skillRefs).toEqual(["writer-screenwriter", "writer-dialogue"]);
  });

  it("REJECTS vendor-specific archetypeId in modelPrefs (P4: 只引 kind+family)", () => {
    const result = parseSkillManifest({
      name: "bad.skill",
      version: "1.0.0",
      description: "d",
      tools: [],
      requiredProviders: ["video"],
      permissions: ["create"],
      stages: [
        {
          id: "media",
          goal: "g",
          tools: ["run_generation_batch"],
          // archetypeId 是 vendor 专属，.strict() 必须拒掉（防分享绑死）
          modelPrefs: [{ kind: "video", archetypeId: "seedance-2-apimart" }],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("REJECTS hardcoded params in modelPrefs (参数交模型档案)", () => {
    const result = parseSkillManifest({
      name: "bad.skill2",
      version: "1.0.0",
      description: "d",
      tools: [],
      requiredProviders: ["video"],
      permissions: ["create"],
      stages: [
        { id: "m", goal: "g", tools: [], modelPrefs: [{ kind: "video", params: { duration: 5 } }] },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a stage missing required id/goal/tools", () => {
    const result = parseSkillManifest({
      name: "bad.skill3",
      version: "1.0.0",
      description: "d",
      tools: [],
      requiredProviders: ["text"],
      permissions: ["create"],
      stages: [{ goal: "no id and no tools" }],
    });
    expect(result.ok).toBe(false);
  });
});
