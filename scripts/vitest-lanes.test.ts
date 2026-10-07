import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { OTHER_LANES, findOrphanTests, listTestStyleFiles } from "../vitest.config";

const repoRoot = join(__dirname, "..");

describe("测试文件必须有车道认领（vitest.config.ts 配置期自检）", () => {
  test("当前仓库没有孤儿测试文件", () => {
    expect(findOrphanTests(listTestStyleFiles(repoRoot))).toEqual([]);
  });

  test("新建一个不被任何车道收的测试文件 → 被点名；被收的不误报", () => {
    const root = mkdtempSync(join(tmpdir(), "nomi-lanes-"));
    mkdirSync(join(root, "src/x"), { recursive: true });
    mkdirSync(join(root, "docs/x"), { recursive: true });
    writeFileSync(join(root, "src/x/a.test.tsx"), "");
    writeFileSync(join(root, "docs/x/lost.test.tsx"), "");
    writeFileSync(join(root, "src/x/lost.spec.ts"), "");
    expect(findOrphanTests(listTestStyleFiles(root)).sort()).toEqual(["docs/x/lost.test.tsx", "src/x/lost.spec.ts"]);
  });

  test("OTHER_LANES 登记的 runner 在 package.json 里真的存在", () => {
    const scripts = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts as Record<string, string>;
    for (const lane of OTHER_LANES) expect(scripts[lane.script], lane.script).toBeTruthy();
  });

  test("agent-runtime 车道：tsc 的 include 与 node --test 的 glob 都覆盖 .test.mts", () => {
    const scripts = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts as Record<string, string>;
    expect(scripts["test:agent-runtime"]).toContain("tests/agent-runtime/*.test.mjs");
    expect(readFileSync(join(repoRoot, "tests/agent-runtime/tsconfig.json"), "utf8")).toContain("**/*.mts");
    expect(scripts.test).toContain("test:agent-runtime");
  });
});
