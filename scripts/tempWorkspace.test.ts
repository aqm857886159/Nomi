import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTempWorkspace } from "../tests/setup/tempWorkspace";

describe("Vitest temp workspace", () => {
  it("redirects every Node temp variable and removes the run root on teardown", () => {
    const env = { TMPDIR: "before-tmpdir", TEMP: "before-temp", TMP: "before-tmp" };
    const workspace = createTempWorkspace(env, os.tmpdir());
    try {
      expect(env.TMPDIR).toBe(workspace.root);
      expect(env.TEMP).toBe(workspace.root);
      expect(env.TMP).toBe(workspace.root);
      expect(path.dirname(workspace.root)).toBe(os.tmpdir());
      expect(fs.existsSync(workspace.root)).toBe(true);
    } finally {
      workspace.teardown();
    }
    expect(fs.existsSync(workspace.root)).toBe(false);
    expect(env).toEqual({ TMPDIR: "before-tmpdir", TEMP: "before-temp", TMP: "before-tmp" });
    workspace.teardown();
  });
});
