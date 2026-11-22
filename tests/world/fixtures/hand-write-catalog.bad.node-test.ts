// 反例：手写主人存盘文件 model-catalog.json。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("手写 model-catalog.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-fixture-"));
  fs.writeFileSync(path.join(dir, "model-catalog.json"), JSON.stringify({ version: 1, vendors: [], models: [], mappings: [] }));
  expect(true).toBe(true);
});
