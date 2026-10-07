import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverSkillRecords } from "../agentLane/laneSkillCatalog.mjs";
import type { SkillRecord } from "../skills/skillStore";
import { getCuratedPrompts } from "./curatedPrompts";
import { resolveEffectSlots } from "../shared/effectSlots";

const root = path.resolve(__dirname, "../..");
const builtin = async (): Promise<SkillRecord[]> =>
  (await discoverSkillRecords([{ path: path.join(root, "skills"), origin: "builtin" }])).records;

describe("effect templates leave the library without raw slot braces", () => {
  it("never hands a `{角色名}`-style token to the model: every projected effect prompt is brace-free for its declared slots", async () => {
    const records = await builtin();
    const prompts = getCuratedPrompts(records);
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      for (const slot of prompt.curation?.slots ?? []) {
        expect(prompt.prompt, `${prompt.id} still contains ${slot.token}`).not.toContain(slot.token);
      }
    }
  });

  it("keeps a template that has slots meaningful: character / subject / scene fall back to a generic noun", async () => {
    const records = await builtin();
    const byId = new Map(getCuratedPrompts(records).map((prompt) => [prompt.id, prompt.prompt]));
    expect(byId.get("effect-character-three-view")).toContain("以参考中的角色为唯一角色");
    expect(byId.get("effect-fill-outpaint")).toContain("为参考中的主体补齐画面外部空白");
    expect(byId.get("effect-scene-three-view")).toContain("以参考中的场景为同一空间");
  });

  it("English camera templates fall back to an English noun, not a Chinese one", async () => {
    const records = await builtin();
    const camera = getCuratedPrompts(records).find((prompt) => prompt.id === "effect-camera-01")!;
    expect(camera.prompt).not.toMatch(/\{[^{}\n]+\}/);
    expect(camera.prompt).not.toMatch(/[一-鿿]/);
  });
});

describe("resolveEffectSlots", () => {
  const slots = [{ token: "{角色名}", reference: "character" as const }];
  it("replaces with the value when one is given", () => {
    expect(resolveEffectSlots("以参考中的{角色名}为唯一角色", slots, { "{角色名}": "阿宁" })).toBe("以参考中的阿宁为唯一角色");
  });
  it("uses a generic noun when the value is missing or blank", () => {
    expect(resolveEffectSlots("以参考中的{角色名}为唯一角色", slots)).toBe("以参考中的角色为唯一角色");
    expect(resolveEffectSlots("以参考中的{角色名}为唯一角色", slots, { "{角色名}": "  " })).toBe("以参考中的角色为唯一角色");
  });
  it("replaces every occurrence and leaves undeclared braces alone", () => {
    expect(resolveEffectSlots("{角色名}和{角色名}，保留 {other}", slots)).toBe("角色和角色，保留 {other}");
  });
});
