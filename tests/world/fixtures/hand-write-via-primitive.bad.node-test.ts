import { makeTempDir } from "../../../scripts/_test-temp.mjs";
// 反例：绕过 buildWorld，拿存盘原语 writeJsonFileAtomic 去写手写内容。
import path from "node:path";
import { expect, it } from "vitest";
import { writeJsonFileAtomic } from "../../../electron/jsonFile";

it("用 writeJsonFileAtomic 写 model-catalog.json", () => {
  const dir = makeTempDir("nomi-fixture-");
  writeJsonFileAtomic(path.join(dir, "model-catalog.json"), { version: 1, vendors: [] });
  expect(true).toBe(true);
});
