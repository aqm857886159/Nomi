import path from "node:path";
import { describe, expect, test } from "vitest";
import { isolatedElectronLaunchOptions } from "./electronFixture.mjs";

describe("isolatedElectronLaunchOptions", () => {
  test("isolates every writable desktop path and bypasses the single-instance lock", () => {
    const options = isolatedElectronLaunchOptions("/repo", "/tmp/case", {});
    // 期望值经 path.join 派生：不变量是「路径都隔离在 tempRoot 下」，分隔符跟平台走（Windows 为 `\`）。
    expect(options.args).toContain(`--user-data-dir=${path.join("/tmp/case", "user-data")}`);
    expect(options.env).toMatchObject({
      NOMI_E2E: "1",
      NOMI_E2E_ALLOW_MULTI_INSTANCE: "1",
      NOMI_SETTINGS_DIR: path.join("/tmp/case", "settings"),
      NOMI_PROJECTS_DIR: path.join("/tmp/case", "projects"),
    });
  });
});
