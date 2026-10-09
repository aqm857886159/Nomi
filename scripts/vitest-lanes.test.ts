import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { makeTempDir } from "./_test-temp.mjs";
import { OTHER_LANES, findOrphanTests, listTestStyleFiles } from "../vitest.config";

const repoRoot = join(__dirname, "..");

/** 从某个 package.json 脚本出发，沿 `pnpm run <name>` 引用能跑到的全部脚本名（含自己）。 */
function scriptsReachableFrom(start: string, scripts: Record<string, string>): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const name = queue.pop()!;
    if (seen.has(name) || !scripts[name]) continue;
    seen.add(name);
    for (const m of scripts[name].matchAll(/pnpm run ([\w:.-]+)/g)) queue.push(m[1]);
  }
  return seen;
}

describe("测试文件必须有车道认领（vitest.config.ts 配置期自检）", () => {
  test("当前仓库没有孤儿测试文件", () => {
    expect(findOrphanTests(listTestStyleFiles(repoRoot))).toEqual([]);
  });

  test("新建一个不被任何车道收的测试文件 → 被点名；被收的不误报", () => {
    const root = makeTempDir("nomi-lanes-");
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
    // pnpm test 经 test:node-suites 这层间接才到 agent-runtime：沿 `pnpm run X` 引用把 test 能跑到的脚本全展开再查。
    expect(scriptsReachableFrom("test", scripts)).toContain("test:agent-runtime");
  });
});
