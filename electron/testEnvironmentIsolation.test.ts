import { describe, expect, it, vi } from "vitest";

describe("Vitest environment fixtures", () => {
  it("allows a test to override a process environment value", () => {
    vi.stubEnv("NOMI_SETTINGS_DIR", "fixture-settings-root");
    expect(process.env.NOMI_SETTINGS_DIR).toBe("fixture-settings-root");
  });

  it("restores the process environment before the next test", () => {
    expect(process.env.NOMI_SETTINGS_DIR).toBeUndefined();
  });
});
