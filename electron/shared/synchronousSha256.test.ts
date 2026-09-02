import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { synchronousSha256 } from "./synchronousSha256";

describe("browser-safe synchronous SHA-256", () => {
  it.each([
    ["empty", "", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["unicode", "雨夜里的 Nomi", createHash("sha256").update("雨夜里的 Nomi", "utf8").digest("hex")],
  ])("matches the %s vector", (_label, value, expected) => {
    expect(synchronousSha256(value)).toBe(expected);
  });
});
