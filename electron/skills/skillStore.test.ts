import { describe, expect, it } from "vitest";

import { findSkillRecord, isCraftSkill, normalizeSkillLookupKey, type SkillRecord } from "./skillStore";

function record(name: string, directoryName: string): SkillRecord {
  return { name, directoryName, filePath: `${directoryName}/SKILL.md`, body: "x", manifest: null, origin: "builtin" };
}

const records: SkillRecord[] = [
  record("workbench.generation", "workbench-generation"),
  record("workbench.storyboard.planner", "workbench-storyboard-planner"),
  record("brand.promo", "brand-promo"),
];

describe("normalizeSkillLookupKey", () => {
  it("normalizes camelCase / dots / underscores to kebab", () => {
    expect(normalizeSkillLookupKey("workbench.storyboard.planner")).toBe("workbench-storyboard-planner");
    expect(normalizeSkillLookupKey("brandPromo")).toBe("brand-promo");
  });
});

describe("findSkillRecord", () => {
  it("matches exact name first", () => {
    expect(findSkillRecord("brand.promo", "", records)?.name).toBe("brand.promo");
  });

  it("matches by prefix (e.g. creation mode key under a base skill name)", () => {
    expect(findSkillRecord("workbench.generation.canvas-planner", "", records)?.name).toBe(
      "workbench.generation",
    );
  });

  it("falls back to normalized directory-name match", () => {
    expect(findSkillRecord("brand-promo", "", records)?.name).toBe("brand.promo");
  });

  it("returns null when nothing matches", () => {
    expect(findSkillRecord("does.not.exist", "nope", records)).toBeNull();
  });
});

// 安全边界（2026-08-27）：决定「哪些技能会被暴露给外部 MCP 客户端」。
// 同一天我们把技能导入放开成裸 SKILL.md / zip 都能进——如果可见性还只看目录名前缀，
// 用户随手导入一本叫 director-xxx 的技能就会**自动发给外部 Claude Code / Codex 且不知情**。
// 让导入变容易的同时必须让暴露变难，这几条钉死这个解耦。
describe("isCraftSkill（对外暴露的安全边界）", () => {
  const at = (directoryName: string, origin: SkillRecord["origin"]) => ({ directoryName, origin });

  it("keeps the 23 built-in craft skills exposed (迁移不回归)", () => {
    expect(isCraftSkill(at("director-cinematography", "builtin"))).toBe(true);
    expect(isCraftSkill(at("writer-screenwriter", "builtin"))).toBe(true);
  });

  it("never exposes a user-imported skill, whatever it is named", () => {
    // 这条就是本次要堵的洞：叫什么名字都不该让它对外
    expect(isCraftSkill(at("director-cinematography", "user"))).toBe(false);
    expect(isCraftSkill(at("writer-anything", "user"))).toBe(false);
    expect(isCraftSkill(at("my-private-method", "user"))).toBe(false);
  });

  it("does not expose internal orchestration skills", () => {
    expect(isCraftSkill(at("workbench-generation", "builtin"))).toBe(false);
    expect(isCraftSkill(at("brand-promo", "builtin"))).toBe(false);
    expect(isCraftSkill(at("skill-author", "builtin"))).toBe(false);
  });
});
