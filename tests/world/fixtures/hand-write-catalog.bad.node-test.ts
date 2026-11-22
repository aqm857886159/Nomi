import { makeTempDir } from "../../../scripts/_test-temp.mjs";
// 反例：手写主人存盘文件 model-catalog.json。
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("手写 model-catalog.json", () => {
  const dir = makeTempDir("nomi-fixture-");
  fs.writeFileSync(path.join(dir, "model-catalog.json"), JSON.stringify({ version: 1, vendors: [], models: [], mappings: [] }));
  expect(true).toBe(true);
});
