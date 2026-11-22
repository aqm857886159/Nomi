// 反例：测试越过 buildWorld，直接调主人的写口（目录主人 catalogStore）造世界。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { mutateCatalog } from "../../../electron/catalog/catalogStore";

afterEach(() => {
  delete process.env.NOMI_SETTINGS_DIR;
});

it("直接 mutateCatalog", () => {
  process.env.NOMI_SETTINGS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-fixture-"));
  mutateCatalog((tx) => {
    tx.upsertVendor({ key: "hand-made", name: "hand-made", providerKind: "openai-compatible" });
  });
  expect(true).toBe(true);
});
