// 反例：绕过 buildWorld，拿存盘原语 writeJsonFileAtomic 去写手写内容。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { writeJsonFileAtomic } from "../../../electron/jsonFile";

it("用 writeJsonFileAtomic 写 model-catalog.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-fixture-"));
  writeJsonFileAtomic(path.join(dir, "model-catalog.json"), { version: 1, vendors: [] });
  expect(true).toBe(true);
});
