// 根因回归：设置根必须是**绝对**目录，否则一切 path.join(getSettingsRoot(), 文件名)
// 都会退化成相对路径、静默写进 process.cwd()（开发/测试时 = 仓库根目录）。
//
// 真实事故：electron 桩的 getPath() 返回 ""，providerAdapter/onboardingRoundtrip 的真实
// 往返里 executeProfileOperation → readCatalog() 首次读不到就落一份默认 catalog，于是每跑
// 一次 `pnpm run test` 仓库根就多一个未跟踪的 model-catalog.json。修在这一层（而不是
// .gitignore、也不是给那个测试再加个 mock）才管得住整类：getSettingsRoot() 目前有十余个
// 调用点，每个都是 join 出文件名，任何一个都能把文件写到不该去的地方。
//
// 本文件**故意不 vi.mock("electron")** —— 要验的正是「其它测试默认拿到的那个桩」是否忠实。
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getSettingsRoot, SETTINGS_ROOT_ENV } from "./settingsRoot";

const previousSettingsRoot = process.env[SETTINGS_ROOT_ENV];
afterEach(() => {
  if (previousSettingsRoot === undefined) delete process.env[SETTINGS_ROOT_ENV];
  else process.env[SETTINGS_ROOT_ENV] = previousSettingsRoot;
});

describe("getSettingsRoot", () => {
  it("默认（无 env 覆盖）给出绝对目录，且不在仓库里 —— 单测不得往仓库根写文件", () => {
    delete process.env[SETTINGS_ROOT_ENV];
    const root = getSettingsRoot();

    expect(path.isAbsolute(root)).toBe(true);
    // 仓库根 = vitest 的 root = 相对路径会落到的地方。设置根落在这下面，
    // 就意味着任何一次写盘都会在 git status 里冒出未跟踪垃圾。
    const repoRoot = process.cwd();
    expect(path.relative(repoRoot, root).startsWith("..")).toBe(true);
  });

  it("env 覆盖是绝对路径时原样返回", () => {
    const absolute = path.join(path.sep, "tmp", "nomi-settings-root-test");
    process.env[SETTINGS_ROOT_ENV] = absolute;
    expect(getSettingsRoot()).toBe(absolute);
  });

  it("拿到相对路径时当场抛错，而不是静默写进 process.cwd()", () => {
    process.env[SETTINGS_ROOT_ENV] = "relative-settings-dir";
    expect(() => getSettingsRoot()).toThrow(/absolute/i);
  });
});
