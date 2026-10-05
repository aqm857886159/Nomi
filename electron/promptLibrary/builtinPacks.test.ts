// 内置表情包结构保证：25 条(5 族×5 级)齐、身份锁前缀在、预设图真实存在于 public/、
// withBuiltinPrompts 幂等(老磁盘缓存混入同 sourceId 条目也不重复)。
import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_SOURCE_IDS, getBuiltinPrompts, withBuiltinPrompts } from "./builtinPacks";
import type { LibraryPrompt } from "./promptLibraryTypes";
import { readSkillRecords } from "../skills/skillStore";
import { discoverSkillRecords } from "../agentLane/laneSkillCatalog.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// 策展条目从技能目录投影，目录由 pi 的加载器给（岛上、async）。单测里没有编译好的 CJS 桥，
// 所以把 `readSkillRecords` 接到岛上的真目录——喂的仍是仓内 88 个真技能，不是假记录。
// 岛本身 import 被 mock 的 skillStore，所以岛不能在 mock 工厂里 import（会和模块图互等成死锁），
// 在顶层 import、在 beforeAll 里接线。
vi.mock("../skills/skillStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../skills/skillStore")>();
  return { ...actual, readSkillRecords: vi.fn() };
});

const FAMILIES = ["joy", "anger", "sad", "surprise", "fear"] as const;
const LEVELS = [1, 2, 3, 4, 5] as const;

function externalPrompt(overrides: Partial<LibraryPrompt> = {}): LibraryPrompt {
  return {
    id: "ext-1",
    title: "外部条目",
    prompt: "some prompt",
    mediaUrl: "https://example.com/a.jpg",
    mediaType: "image",
    promptType: "image",
    origin: "public",
    source: "GPT Image 2",
    sourceId: "evolink-gpt-image-2",
    sourceUrl: "https://example.com",
    ...overrides,
  };
}

describe("builtin expression pack", () => {
  let prompts: LibraryPrompt[] = [];
  beforeAll(async () => {
    vi.mocked(readSkillRecords).mockImplementation(async () =>
      (await discoverSkillRecords([{ path: path.join(repoRoot, "skills"), origin: "builtin" }])).records);
    prompts = (await getBuiltinPrompts()).filter((p) => p.sourceId === "builtin-expressions");
  });

  it("完整 5 情绪族 × 5 强度 = 25 条，id 唯一", () => {
    expect(prompts).toHaveLength(25);
    const ids = prompts.map((p) => p.id);
    expect(new Set(ids).size).toBe(25);
    for (const family of FAMILIES) {
      for (const level of LEVELS) {
        expect(ids).toContain(`builtin-expr-${family}-${level}`);
      }
    }
  });

  it("每条结构完整：图类、public、统一来源、身份锁前缀", () => {
    for (const p of prompts) {
      expect(p.promptType).toBe("image");
      expect(p.mediaType).toBe("image");
      expect(p.origin).toBe("public");
      expect(p.source).toBe("表情预设");
      expect(p.sourceId).toBe("builtin-expressions");
      expect(p.sourceUrl.length).toBeGreaterThan(0);
      expect(p.title.length).toBeGreaterThan(0);
      // 身份锁前缀是这包的核心承诺：改表情不改人。措辞变更需连同这里一起改（防静默漂移）。
      expect(p.prompt.startsWith("保持画面中人物的身份")).toBe(true);
      expect(p.prompt).toContain("仅将面部表情改为");
    }
  });

  it("预设图为打包相对路径，且文件真实存在于 public/", () => {
    for (const p of prompts) {
      expect(p.mediaUrl.includes("://")).toBe(false);
      expect(p.mediaUrl.startsWith("prompt-media/expressions/")).toBe(true);
      const filePath = path.join(repoRoot, "public", p.mediaUrl);
      expect(fs.existsSync(filePath), `缺预设图: ${p.mediaUrl}`).toBe(true);
    }
  });

  it("内置包含 44 条策展效果，来自仓内技能目录的投影", async () => {
    const curated = (await getBuiltinPrompts()).filter((p) => p.sourceId === "builtin-curated-effects");
    expect(curated).toHaveLength(44);
  });

  it("withBuiltinPrompts 前置内置包并保持外部顺序", async () => {
    const externals = [externalPrompt({ id: "ext-1" }), externalPrompt({ id: "ext-2", sourceId: "sora-official" })];
    const builtin = await getBuiltinPrompts();
    const merged = await withBuiltinPrompts(externals);
    expect(merged).toHaveLength(builtin.length + 2);
    expect(merged.slice(0, builtin.length).every((p) => BUILTIN_SOURCE_IDS.has(p.sourceId))).toBe(true);
    expect(merged.slice(builtin.length).map((p) => p.id)).toEqual(["ext-1", "ext-2"]);
  });

  it("幂等：入参已含内置 sourceId 条目(历史缓存)时不重复", async () => {
    const stale = await withBuiltinPrompts([externalPrompt()]);
    const again = await withBuiltinPrompts(stale);
    expect(again).toHaveLength((await getBuiltinPrompts()).length + 1);
    expect(again.filter((p) => p.sourceId === "builtin-expressions")).toHaveLength(25);
  });

  it("getBuiltinPrompts 返回拷贝，调用方改动不污染后续读取", async () => {
    const first = await getBuiltinPrompts();
    first[0].title = "被改坏的标题";
    expect((await getBuiltinPrompts())[0].title).not.toBe("被改坏的标题");
  });
});
