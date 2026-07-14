import { describe, expect, test } from "vitest";
import { isolatedAppEnv } from "./isoApp.mjs";

describe("isolatedAppEnv", () => {
  test("always bypasses the desktop single-instance lock", () => {
    expect(isolatedAppEnv({ projectsDir: "/projects", settingsDir: "/settings", chromiumDir: "/chromium" }, {})).toMatchObject({
      NOMI_E2E: "1",
      NOMI_E2E_ALLOW_MULTI_INSTANCE: "1",
      NOMI_PROJECTS_DIR: "/projects",
      NOMI_SETTINGS_DIR: "/settings",
    });
  });
});
