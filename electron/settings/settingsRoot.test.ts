// 根因回归：vitest 把 electron 整体 alias 到 tests/stubs/electron.ts，而该桩的 getPath() 曾返回 ""。
// 于是 getSettingsRoot() 之下的十几个存储模块（catalog / proxy / 项目位置 / prompt 库 / 下载偏好 …）
// `path.join("", 文件名)` 得到的是**相对路径**，统统落到 process.cwd()＝仓库根目录。最先被发现的
// 症状是跑完单测仓库里多出 model-catalog.json（没进 .gitignore，`git add -A` 就混进提交）。
//
// 这里钉的是**根不变量**——设置根必须是仓库之外的绝对路径——而不是某一个 store 的行为：
// 桩一旦再退回相对路径，这条立刻红，整类症状不用逐个 store 补测试，也不用逐个测试去 mock 掉 store。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { getSettingsRoot, SETTINGS_ROOT_ENV } from "./settingsRoot";
import { readCatalog } from "../catalog/catalogStore";
import { CATALOG_FILE } from "../runtimePaths";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 落在仓库里 = 会脏工作区。用 relative 判而非字符串前缀，免受 symlink/大小写拼写影响。 */
function isInsideRepo(target: string): boolean {
  const rel = path.relative(REPO_ROOT, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

const previousSettingsRoot = process.env[SETTINGS_ROOT_ENV];
afterEach(() => {
  if (previousSettingsRoot === undefined) delete process.env[SETTINGS_ROOT_ENV];
  else process.env[SETTINGS_ROOT_ENV] = previousSettingsRoot;
});

describe("设置根：单测的落盘绝不能进仓库", () => {
  it("没有环境覆盖时也是绝对路径，且在仓库之外", () => {
    delete process.env[SETTINGS_ROOT_ENV];

    const root = getSettingsRoot();

    // "" 或任何相对路径都会在这里被抓住——它正是让文件落进仓库根的那个形状。
    expect(path.isAbsolute(root)).toBe(true);
    expect(isInsideRepo(root)).toBe(false);
  });

  it("真读一次 catalog：它确实落盘了，而且落在仓库之外", () => {
    delete process.env[SETTINGS_ROOT_ENV];

    // 首次读取没有文件 → seed 一份默认 catalog 并写盘。写去哪由 getSettingsRoot() 决定，
    // 所以这条是端到端证据：不只是路径长得对，而是真写出去的那份没进仓库。
    readCatalog();
    const written = path.join(getSettingsRoot(), CATALOG_FILE);

    expect(fs.existsSync(written)).toBe(true);
    expect(isInsideRepo(written)).toBe(false);
  });

  it("NOMI_SETTINGS_DIR 覆盖仍然优先——评测/走查靠它隔离真实 userData", () => {
    const override = path.join(REPO_ROOT, "..", "nomi-settings-root-override");
    process.env[SETTINGS_ROOT_ENV] = override;

    expect(getSettingsRoot()).toBe(override);
  });
});
