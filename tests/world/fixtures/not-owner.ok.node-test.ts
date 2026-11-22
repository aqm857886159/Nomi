// 正例（不误伤）：写非主人的文件、mock 非主人模块（electron）、测试调非主人的产品函数、由产品自己去写主人文件，都放行。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => process.env.NOMI_SETTINGS_DIR ?? os.tmpdir(), getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (v: string) => Buffer.from(v), decryptString: (v: Buffer) => v.toString() },
}));

import { createCustomCallDraft } from "../../../electron/catalog/customCallDraft";

afterEach(() => {
  delete process.env.NOMI_SETTINGS_DIR;
});

it("写非主人文件", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-fixture-"));
  fs.writeFileSync(path.join(dir, "notes.json"), "{}");
  expect(fs.existsSync(path.join(dir, "notes.json"))).toBe(true);
});

it("测试调非主人的产品函数，由它去写主人文件", () => {
  process.env.NOMI_SETTINGS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-fixture-"));
  createCustomCallDraft({ vendorName: "x", baseUrl: "https://example.invalid", apiKey: "k", modelKey: "m", kind: "video" } as never);
  expect(fs.existsSync(path.join(process.env.NOMI_SETTINGS_DIR, "model-catalog.json"))).toBe(true);
});
