import { describe, expect, test } from "vitest";
import { isolatedElectronLaunchOptions } from "./electronFixture.mjs";

describe("isolatedElectronLaunchOptions", () => {
  test("isolates every writable desktop path and bypasses the single-instance lock", () => {
    const options = isolatedElectronLaunchOptions("/repo", "/tmp/case", {});
    expect(options.args).toContain("--user-data-dir=/tmp/case/user-data");
    expect(options.env).toMatchObject({
      NOMI_E2E: "1",
      NOMI_E2E_ALLOW_MULTI_INSTANCE: "1",
      NOMI_SETTINGS_DIR: "/tmp/case/settings",
      NOMI_PROJECTS_DIR: "/tmp/case/projects",
    });
  });
});
