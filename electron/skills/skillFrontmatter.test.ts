import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripFrontmatter } from "@earendil-works/pi-coding-agent";
import { parseSkillFrontmatter, skillMarkdownWithoutFrontmatter } from "./skillFrontmatter";

/**
 * `skillMarkdownWithoutFrontmatter` 是 pi 的 `stripFrontmatter` 的一份**本地等价物**，
 * 不是第二种做法。
 *
 * 为什么不直接 import pi 的那个：正文注入的 owner 是 `electron/harness/context/agentContext.ts`，
 * 那一层刻意**不许**依赖任何 `@earendil-works/pi-*`（`agentContext.test.ts` 的
 * `FORBIDDEN_OWNER_IMPORT` 把这条钉成断言：它跑在主进程 CJS 侧，pi 是 ESM-only）。
 *
 * 于是 R29 的问题变成「怎么保证这份本地版本不漂」。答案不是写一句注释，是这条测试：
 * 拿**盘上每一份真 SKILL.md** 逐个比对两个实现的输出。pi 升级改了判据、或者有人来改我们这份，
 * 当场红。
 */
describe("skill frontmatter stripping stays pinned to pi's stripFrontmatter", () => {
  const skillsRoot = path.join(process.cwd(), "skills");
  const files = fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(skillsRoot, entry.name, "SKILL.md"))
    .filter((file) => fs.existsSync(file));

  it("has real installed Skills to compare against", () => {
    // 阳性对照：文件列表空了的话下面那条 forEach 一条都不跑，而 vitest 照样绿。
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(files.map((file) => [path.basename(path.dirname(file)), file] as const))(
    "%s: matches pi byte for byte",
    (_name, file) => {
      const raw = fs.readFileSync(file, "utf8");
      expect(skillMarkdownWithoutFrontmatter(raw)).toBe(stripFrontmatter(raw).trim());
    },
  );

  it("agrees with pi on the edge shapes too", () => {
    for (const sample of [
      "# 没有 frontmatter\n正文",
      "---\nname: x\n没闭合的 frontmatter",
      "---\nname: x\n---\n\n# 正文\n一句话。",
      "﻿---\r\nname: x\r\n---\r\n\r\n正文\r\n",
      "---\n---\n只有一对分隔符",
    ]) {
      expect(skillMarkdownWithoutFrontmatter(sample), JSON.stringify(sample))
        .toBe(stripFrontmatter(sample).trim());
    }
  });

  it("still exposes the parsed frontmatter to the callers that need it", () => {
    // 剥掉的那一半不是丢掉：技能清单、curation、coding 解锁都还要读它（同一个文件里两个出口）。
    const parsed = parseSkillFrontmatter("---\nname: x\ndescription: d\n---\n\n正文");
    expect(parsed.values).toEqual({ name: "x", description: "d" });
  });
});
