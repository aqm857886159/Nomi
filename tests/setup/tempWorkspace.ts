import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEMP_KEYS = ["TMPDIR", "TEMP", "TMP"] as const;

export type TempWorkspace = {
  root: string;
  teardown: () => void;
};

/** Own one Vitest run's scratch space and restore the host environment after it. */
export function createTempWorkspace(
  env: NodeJS.ProcessEnv = process.env,
  tempBase = os.tmpdir(),
): TempWorkspace {
  const root = fs.mkdtempSync(path.join(tempBase, "nomi-vitest-run-"));
  const previous = new Map<string, string | undefined>(TEMP_KEYS.map((key) => [key, env[key]]));
  for (const key of TEMP_KEYS) env[key] = root;

  let tornDown = false;
  return {
    root,
    teardown() {
      if (tornDown) return;
      tornDown = true;
      fs.rmSync(root, { recursive: true, force: true });
      for (const key of TEMP_KEYS) {
        const value = previous.get(key);
        if (value === undefined) delete env[key];
        else env[key] = value;
      }
    },
  };
}

export function setup(): () => void {
  return createTempWorkspace().teardown;
}
