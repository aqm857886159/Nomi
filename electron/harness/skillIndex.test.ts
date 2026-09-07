// 模型看到的 Skill 目录索引：有界、确定、名字不丢。
// 2026-09-07：这条断言原来住在 `runtime/pi/nomiSkillResources.test.ts` 里，那份测试连同它测的
// 死模块一起删了；`formatNomiSkillIndex` 的活 owner 是本文件旁边的 `skillIndex.ts`
// （`electron/ai/agentChatV2.ts:147` 在用），所以断言搬到这里，语义逐字不变。
import { describe, expect, it } from "vitest";

import { formatNomiSkillIndex, type NomiSkillIndexEntry } from "./skillIndex";

describe("Nomi skill index", () => {
  it("keeps the model-facing skill index bounded, deterministic, and name-complete", () => {
    const skills: NomiSkillIndexEntry[] = Array.from({ length: 30 }, (_, index) => ({
      name: `skill.${String(index).padStart(2, "0")}`,
      description: `Description ${index}`,
    }));
    const first = formatNomiSkillIndex(skills, { limit: 3 });
    const second = formatNomiSkillIndex([...skills].reverse(), { limit: 3 });
    expect(first).toBe(second);
    expect(first).toContain("showing 3 of 30");
    expect(first).toContain("- skill.00: Description 0");
    expect(first).toContain("More skill names are available:");
    expect(first).toContain("skill.29");
  });
});
